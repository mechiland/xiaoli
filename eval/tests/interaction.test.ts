// Interaction metrics (ARCHITECTURE §7.3 loops/conversations, §7.4). Hand-built goldVersion-2 gold + predictions
// with fakeJudge: loop TP/FP/FN, kind mismatch reported not penalised, close recall, false close, conversation
// span overlap at exactly 50 %, topic coverage — and the regression guard that a goldVersion-1 file still scores
// exactly as it did before goldVersion 2 existed.
import { describe, expect, it } from 'vitest'
import { CONVERSATION_OVERLAP, goldOverlapRatio, groupRunSegments, matchConversations, spanOverlap, topicCoverage } from '../src/conversations'
import { GoldFileSchema, parseGold } from '../src/gold-schema'
import { fakeJudge } from '../src/judge'
import { gatesPassed, metricsFromCounts, sourceGates, THRESHOLDS } from '../src/metrics'
import { scoreZip } from '../src/score'
import { usageBucket, zeroUsageByBucket } from '../src/usage'
import { baseGold, basePred, claim, close, loop, scoreMessages, segment } from './helpers'

// 0..9 morning, 10..19 evening (> 3 h later), 20..29 two days later
const messages = Array.from({ length: 30 }, (_, i) => {
  const at = i < 10 ? `2026-09-01 09:${String(i).padStart(2, '0')}` : i < 20 ? `2026-09-01 20:${String(i - 10).padStart(2, '0')}` : `2026-09-03 09:${String(i - 20).padStart(2, '0')}`
  return { idx: i, senderName: ['小满', '阿青', '老周'][i % 3], sentAt: at, body: `消息${i}` }
})

const gold = baseGold({
  goldVersion: 2,
  messageCount: 30,
  sensitiveValues: ['13900001111'],
  loops: [
    { id: 'l1', person: 'a', direction: 'mine', kind: 'promise', text: '答应帮忙订饭店', evidence: [1], closedBy: 6, closedReason: 'done' },
    { id: 'l2', person: 'a', direction: 'theirs', kind: 'question', text: '问了小满地址，没有人回', evidence: [3] },
    { id: 'l3', person: 'b', direction: 'mutual', kind: 'plan', text: '约好周六去爬山', dueAt: '2026-09-05', evidence: [11], closedBy: 18, closedReason: 'done' },
    { id: 'l4', person: 'b', direction: 'theirs', kind: 'promise', text: '答应寄茶叶', evidence: [12] },
    { id: 'l5', person: 'a', direction: 'mine', kind: 'promise', text: '答应把照片发过去', evidence: [4], optional: true },
  ],
  conversations: [
    { id: 'v1', startIdx: 0, endIdx: 9, topics: ['搬家', '学区'] },
    { id: 'v2', startIdx: 10, endIdx: 19, topics: ['婚礼', '份子钱'] },
    { id: 'v3', startIdx: 20, endIdx: 29, topics: ['出差'] },
  ],
})

const pred = basePred({
  loops: [
    loop('a', 'promise', 'mine', '答应帮忙订饭店', [1], 0, { idx: 6 }), // TP l1, close at the gold idx
    loop('a', 'promise', 'mine', '问了小满地址，没有人回', [3]), // TP l2 with kind AND direction mismatch
    loop('b', 'plan', 'mutual', '约好周六去爬山', [11], 1, { idx: 19 }), // TP l3, but closed at the wrong idx (gold 18)
    loop('b', 'promise', 'theirs', '答应下周去看房', [13], 1, { idx: 17 }), // FP; its close sits on an unmatched loop
    loop('a', 'promise', 'mine', '答应把照片发过去', [4], 0, { idx: 8 }), // TP l5 (optional) — gold never closes it → false close
  ],
  segments: [
    // the first one carries the run's own MsgTime span, the rest let the harness fall back to the messages
    segment(0, 9, '聊了搬家和孩子择校的事', ['搬家', '学区房'], [0, 9], 0, ['2026-09-01 09:00', '2026-09-01 09:09']), // conv [0,9] = v1, both topics
    segment(15, 19, '聊了婚礼', ['婚礼'], [15, 19], 1), // conv [15,19] vs v2 [10,19] = exactly 50 % → match, 1 of 2 topics
    segment(20, 21, '出差前的安排', [], [20, 21], 1), // groups with the next one (2 min apart)
    segment(22, 23, '继续说安排', [], [22, 23], 1), // → conv [20,23] vs v3 [20,29] = 40 % → missed
    segment(22, 23, '把手机号13900001111发过去了', [], [40], 1), // invalid evidence + sensitive value in a summary
  ],
  // the close EVENTS. The first four are mechanically fine (after the opening message, in a window that had the
  // loop); the last three could only exist if validateOutput or the harness were broken.
  closes: [
    close(0, [6], 0),
    close(2, [19], 1),
    close(3, [17], 1),
    close(4, [8], 0), // closes a loop gold leaves open — a MODEL mistake, scored as loop precision, not here
    close(9, [5], 0), // impossible: there is no loop 9
    close(1, [2], 0), // impossible: evidence idx 2 is not after the opening idx 3
    close(2, [12], 0), // impossible: window 0 closed a loop first produced in window 1
  ],
  windows: [
    { index: 0, startIdx: 0, endIdx: 9, outcome: 'done', attempts: 1, attemptMs: [1000], latencyMs: 1000, rawItemCount: 10, droppedInvalidEvidence: 0, rawOutputs: [] },
    { index: 1, startIdx: 10, endIdx: 29, outcome: 'done', attempts: 1, attemptMs: [1000], latencyMs: 1000, rawItemCount: 10, droppedInvalidEvidence: 0, rawOutputs: [] },
  ],
})

const judgeTable = {
  matches: {
    答应帮忙订饭店: { gold: 'l1', verdict: 'same' as const },
    '问了小满地址，没有人回': { gold: 'l2', verdict: 'same' as const },
    约好周六去爬山: { gold: 'l3', verdict: 'same' as const },
    答应把照片发过去: { gold: 'l5', verdict: 'same' as const },
  },
  labels: { 'promise/theirs: 答应下周去看房': { label: 'over_inference' as const } },
}

describe('loops (§7.3): judge step A over text, kind mismatch reported, closes deterministic', async () => {
  const judge = fakeJudge(judgeTable)
  const { counts, details } = await scoreZip({ zipLabel: 'mini.zip', messages, gold, pred, judge })
  const m = metricsFromCounts(counts)

  it('TP / FP / FN exactly like claims, optional gold does not lower recall', () => {
    expect(m.loops).toMatchObject({ predicted: 5, tpStrict: 4, tpLenient: 4, fp: 1, goldRequired: 4, goldMatchedStrict: 3, fn: 1 })
    expect(m.loops.precisionLenient).toBe(0.8)
    expect(m.loops.recallStrict).toBe(0.75)
    expect(details.fn.filter((f) => f.type === 'loops').map((f) => f.goldId)).toEqual(['l4'])
    expect(m.errors.loops).toMatchObject({ over_inference: 1 })
  })

  it('a kind/direction mismatch on a matched pair is reported, never a miss', () => {
    expect(m.interaction.loopKindMismatch).toBe(1)
    expect(details.interaction.loopKindMismatch).toEqual([{ goldId: 'l2', predIndex: 1, gold: 'question/theirs', pred: 'promise/mine' }])
    // the pair still counts as a strict TP: only the text decides
    expect(details.tp.find((t) => t.type === 'loops' && t.goldId === 'l2')).toMatchObject({ verdict: 'same' })
  })

  it('loopCloseRecall reads the loop`s resolved closedIdx and needs the gold idx exactly', () => {
    expect(m.interaction).toMatchObject({ goldCloses: 2, goldClosesMatched: 1, predictedCloses: 4 })
    expect(m.interaction.loopCloseRecall).toBe(0.5)
    expect(details.interaction.closes).toEqual([
      { goldId: 'l1', closedBy: 6, predClosedByIdx: 6, matched: true },
      { goldId: 'l3', closedBy: 18, predClosedByIdx: 19, matched: false }, // closed, but at the wrong message
    ])
  })

  it('loopFalseClose counts ONLY mechanically impossible closes (DECISIONS I13), never a model misjudgement', () => {
    // loop 4 closes something gold leaves open: that is a model mistake and must NOT land here — it costs precision.
    expect(details.interaction.falseCloses.map((f) => f.predIndex)).toEqual([9, 1, 2])
    expect(m.interaction.loopFalseClose).toBe(3)
    expect(details.interaction.falseCloses.map((f) => f.reason)).toEqual([
      'closes[].loopIndex 9 is not a loop of this run',
      'close evidence idx 2 is not after the opening message idx 3',
      'window 0 closed a loop first produced in window 1: it was never shown to that window',
    ])
  })

  it('the judge sees one match call per person with gold loops, keyed apart from that person`s claim call', () => {
    expect(judge.inputs.match.map((i) => i.person.key)).toEqual(['loops:a', 'loops:b'])
    expect(judge.inputs.match[0].gold.map((g) => g.id)).toEqual(['l1', 'l2', 'l5'])
    // loop FPs are classified in their own batch, never mixed into the round-1 types' batches
    expect(judge.inputs.fp).toHaveLength(1)
    expect(judge.inputs.fp[0].items.map((i) => i.type)).toEqual(['loop'])
  })

  it('conversations: grouping by the 3 h rule, ≥ 50 % span overlap, topic coverage, warnings', () => {
    expect(m.interaction).toMatchObject({ segments: 5, conversationsPredicted: 3, conversationsGold: 3, conversationsMatched: 2 })
    expect(m.interaction.conversationCoverage).toBe(0.6667)
    // v1 covers both topics, v2 only 「婚礼」 → mean 0.75
    expect(m.interaction.topicCoverage).toBe(0.75)
    const conv = details.interaction.conversations!
    expect(conv.matches.map((x) => [x.goldId, x.overlap])).toEqual([['v1', 1], ['v2', 0.5]])
    expect(conv.matches[1].missingTopics).toEqual(['份子钱'])
    expect(conv.missed).toEqual([{ goldId: 'v3', bestOverlap: 0.4 }])
  })

  it('segmentInvalidEvidence and the sensitive check cover segments and loop text', () => {
    expect(m.interaction.segmentInvalidEvidence).toBe(1)
    expect(m.sensitiveInStatement).toBe(1)
    // loops keep their own counter: invalidEvidencePost stays a claims/handles/relations/dates/events number
    expect(m.invalidEvidencePost).toBe(0)
  })

  it('gates: loops precision is gated at 0.80 (this run sits exactly on it), recall is not gated at all', () => {
    const gates = sourceGates({ source: 'synthetic', evaluated: true, metrics: m, zipsWithGold: 1, scoredZips: 1, problemZips: 0, gold: [{ frozen: true, changeRecorded: null, lockAppendOnly: null }], judgeFallback: false, p95WindowMs: 1000, p95Enforced: false })
    const byName = Object.fromEntries(gates.map((g) => [g.name, g]))
    expect(byName['loops.precisionLenient']).toMatchObject({ value: 0.8, threshold: THRESHOLDS.loopsPrecisionLenient, passed: true })
    expect(gates.some((g) => g.name.startsWith('loops.recall'))).toBe(false)
    expect(byName.loopFalseClose).toMatchObject({ value: 3, passed: false })
    expect(byName.segmentInvalidEvidence).toMatchObject({ value: 1, passed: false })
    expect(gatesPassed(gates)).toBe(false)
  })
})

describe('conversation grouping and span matching (pure, no judge)', () => {
  const msgs = messages
  it('groups segments less than SESSION_GAP_HOURS apart and splits on a longer gap', () => {
    const g = groupRunSegments([segment(0, 4, 'a', [], [0]), segment(5, 9, 'b', [], [5]), segment(10, 14, 'c', [], [10])], msgs)
    expect(g.map((c) => [c.startIdx, c.endIdx])).toEqual([[0, 9], [10, 14]])
    expect(g[0].summary).toBe('a b')
  })

  it('an out-of-range segment is dropped instead of corrupting a conversation', () => {
    expect(groupRunSegments([segment(0, 4, 'a', [], [0]), segment(28, 99, 'bad', [], [28])], msgs).map((c) => c.endIdx)).toEqual([4])
  })

  it('exactly 50 % of the gold span matches; just under does not', () => {
    const goldConv = { id: 'g', startIdx: 0, endIdx: 9, topics: ['x'] }
    expect(spanOverlap(goldConv, { startIdx: 5, endIdx: 14 })).toBe(5)
    expect(goldOverlapRatio(goldConv, { startIdx: 5, endIdx: 14 })).toBe(CONVERSATION_OVERLAP)
    expect(matchConversations([goldConv], [{ startIdx: 5, endIdx: 14, segments: [0], summary: 'x', topics: [] }]).matches).toHaveLength(1)
    expect(goldOverlapRatio(goldConv, { startIdx: 6, endIdx: 14 })).toBe(0.4)
    expect(matchConversations([goldConv], [{ startIdx: 6, endIdx: 14, segments: [0], summary: 'x', topics: [] }]).missed).toEqual([{ goldId: 'g', bestOverlap: 0.4 }])
  })

  it('topic coverage is a normalized substring test over summary + topics', () => {
    expect(topicCoverage(['搬家', '学区'], { summary: '聊了搬家和孩子择校', topics: ['学区房'] })).toBe(1)
    expect(topicCoverage(['搬家', '学区'], { summary: '聊了搬家', topics: [] })).toBe(0.5)
    expect(topicCoverage(['A B'], { summary: 'talked about a  b today', topics: [] })).toBe(1)
    expect(topicCoverage([], { summary: '', topics: [] })).toBe(1)
  })

  it('one prediction can only satisfy one gold conversation (one-to-one, gold order)', () => {
    const golds = [
      { id: 'g1', startIdx: 0, endIdx: 9, topics: ['x'] },
      { id: 'g2', startIdx: 4, endIdx: 13, topics: ['x'] },
    ]
    const r = matchConversations(golds, [{ startIdx: 0, endIdx: 13, segments: [0], summary: 'x', topics: [] }])
    expect(r.matches.map((x) => x.goldId)).toEqual(['g1'])
    expect(r.missed.map((x) => x.goldId)).toEqual(['g2'])
  })
})

// ---------------------------------------------------------------- regression guard (the rule that matters most)
describe('REGRESSION GUARD: a goldVersion-1 file scores exactly as before goldVersion 2 existed', async () => {
  const v1Gold = baseGold({
    messageCount: 20,
    claims: [
      { id: 'c1', person: 'a', statement: '在云杉医院当护士', category: 'work', sensitive: false, evidence: [1] },
      { id: 'c2', person: 'b', statement: '开编程培训班', category: 'work', sensitive: false, evidence: [3] },
    ],
    handles: [{ id: 'h1', person: 'a', kind: 'mentioned', value: '青姐', evidence: [6] }],
    negatives: [{ id: 'n1', kind: 'coordination', evidence: [13], description: '我在门口' }],
  })
  const msgs20 = scoreMessages(20)
  const table = {
    matches: { 在云杉医院当护士: { gold: 'c1', verdict: 'same' as const }, 开编程培训班: { gold: 'c2', verdict: 'same' as const } },
    labels: { 在门口等人: { label: 'should_ignore' as const, subLabel: 'coordination' as const, negativeId: 'n1' } },
  }
  const claims = [claim('a', '在云杉医院当护士', 'work', [1]), claim('b', '开编程培训班', 'work', [3]), claim('a', '在门口等人', 'other', [13])]
  const handles = [{ person: 'a', kind: 'mentioned', value: '青姐', evidence: [6], windowIndex: 0 }]

  const noInteraction = await scoreZip({ zipLabel: 'mini.zip', messages: msgs20, gold: v1Gold, pred: basePred({ claims, handles }), judge: fakeJudge(table) })
  // the same v1 gold, but the pipeline is now extract.v9 and does emit loops and segments
  const judgeWithInteraction = fakeJudge(table)
  const withInteraction = await scoreZip({
    zipLabel: 'mini.zip',
    messages: msgs20,
    gold: v1Gold,
    pred: basePred({
      claims,
      handles,
      loops: [loop('a', 'promise', 'mine', '答应帮忙订饭店', [1], 0, { idx: 6 }), loop('b', 'question', 'theirs', '问了没人回', [3])],
      segments: [segment(0, 9, '聊了上班和培训班', ['工作'], [0, 9]), segment(10, 19, '闲聊', [], [10, 19])],
    }),
    judge: judgeWithInteraction,
  })

  it('the pre-goldVersion-2 numbers are unchanged, literally', () => {
    const m = metricsFromCounts(noInteraction.counts)
    expect(m.claims).toMatchObject({ predicted: 3, tpStrict: 2, tpLenient: 2, fp: 1, goldRequired: 2, goldMatchedStrict: 2, fn: 0 })
    expect(m.claims.precisionLenient).toBe(0.6667)
    expect(m.claims.recallStrict).toBe(1)
    expect(m.handles).toMatchObject({ predicted: 1, tpLenient: 1, precisionLenient: 1, recallStrict: 1 })
    expect(m.errors.claims).toMatchObject({ should_ignore: 1 })
    expect(m.subLabels.coordination).toBe(1)
    expect(m.transactionalAsClaimRatio).toBe(0.3333)
    expect(m.sensitiveInStatement).toBe(0)
    expect(m.invalidEvidencePost).toBe(0)
    expect(m.yieldPer100Total).toBe(20)
  })

  it('predicted loops and segments against a v1 gold change nothing: no loop metric, no extra FP, same gates', () => {
    const a = metricsFromCounts(noInteraction.counts)
    const b = metricsFromCounts(withInteraction.counts)
    for (const t of ['claims', 'relations', 'handles', 'dates', 'events'] as const) expect(b[t]).toEqual(a[t])
    for (const k of ['transactionalAsClaimRatio', 'sensitiveInStatement', 'invalidEvidencePost', 'evidenceOverlap', 'categoryMismatch', 'kindMismatch'] as const) expect(b[k]).toEqual(a[k])
    expect(b.errors).toEqual(a.errors)
    expect(b.subLabels).toEqual(a.subLabels)
    // The one number that DOES move, and should: `yieldPer100Total` counts everything the pipeline emitted per 100
    // messages, and this pipeline emitted 2 loops more. It moved the same way for an annotated v2 gold before this
    // fix; now it moves the same way whether or not the annotator got there, which is the point (I16).
    expect([a.yieldPer100Total, b.yieldPer100Total]).toEqual([20, 30])
    // "contributes nothing rather than scoring 0" is about the MATCH metrics: no TP, no FP, no FN, null ratios.
    // The count is not a match metric — the run produced 2 loops and the report says 2 (DECISIONS I16).
    expect(b.loops).toMatchObject({ predicted: 2, scored: 0, tpLenient: 0, fp: 0, goldRequired: 0, fn: 0 })
    expect(b.loops.precisionLenient).toBeNull()
    expect(b.loops.recallStrict).toBeNull()
    expect(b.interaction.loopCloseRecall).toBeNull()
    expect(b.interaction.conversationCoverage).toBeNull()
    expect(b.interaction.topicCoverage).toBeNull()
    expect(b.interaction).toMatchObject({ loopsAnnotated: 0, conversationsAnnotated: 0, goldCloses: 0, conversationsGold: 0, conversationsMatched: 0, falseCloses: 0 })
    // the two segments are 10 min apart → one conversation; reported although gold annotates none (I16)
    expect(b.interaction.conversationsPredicted).toBe(1)
    // the mechanical checks still run over the predicted segments/loops (gate = 0 either way)
    expect(b.interaction.segments).toBe(2)
    expect(b.interaction.segmentInvalidEvidence).toBe(0)
    // and the judge was asked exactly the same questions
    expect(judgeWithInteraction.inputs.match.map((i) => i.person.key)).toEqual(['a', 'b'])
    expect(judgeWithInteraction.inputs.fp).toHaveLength(1)
    expect(judgeWithInteraction.inputs.fp[0].items.map((i) => i.fpId)).toEqual(['claims#2'])
  })

  it('the gates of a v1 gold run are the round-1 gates plus three interaction gates that pass on null', () => {
    const base = { source: 'synthetic' as const, evaluated: true, zipsWithGold: 1, scoredZips: 1, problemZips: 0, gold: [{ frozen: true, changeRecorded: null, lockAppendOnly: null }], judgeFallback: false, p95WindowMs: 100, p95Enforced: false }
    const ga = sourceGates({ ...base, metrics: metricsFromCounts(noInteraction.counts) })
    const gb = sourceGates({ ...base, metrics: metricsFromCounts(withInteraction.counts) })
    const strip = (g: typeof ga) => g.filter((x) => !['loops.precisionLenient', 'loopFalseClose', 'segmentInvalidEvidence'].includes(x.name))
    expect(strip(gb)).toEqual(strip(ga))
    for (const name of ['loops.precisionLenient', 'loopFalseClose', 'segmentInvalidEvidence']) {
      expect(gb.find((g) => g.name === name)!.passed, name).toBe(true)
    }
  })

  it('the schema accepts both versions; loops/conversations stay optional', () => {
    expect(parseGold(baseGold()).ok).toBe(true)
    expect(parseGold(baseGold({ goldVersion: 2 })).ok).toBe(true)
    expect(GoldFileSchema.safeParse({ ...baseGold(), goldVersion: 3 }).success).toBe(false)
    const withLoops = parseGold(baseGold({ goldVersion: 2, loops: [{ id: 'l1', person: 'a', direction: 'mine', kind: 'promise', text: '答应寄茶叶', evidence: [1] }] }))
    expect(withLoops.ok).toBe(true)
    if (withLoops.ok) expect(withLoops.gold.conversations).toBeUndefined()
    // a v1 file has no loops key at all — that is what "not annotated" means
    const plain = parseGold(baseGold())
    expect(plain.ok && plain.gold.loops).toBeUndefined()
  })
})

// ---------------------------------------------------------------- the two reporting defects (DECISIONS I16)
//
// The live extract.v9 run (eval/reports/synthetic/20260916-070918.json) reported `loops.predicted = 0` and
// `conversationsPredicted = 0` for a run that produced 12 loops on one zip and 22 segments across four. Both
// numbers lied in the SAME direction — "the model produced nothing" — which is the direction that makes a broken
// feature look measured and fine. These tests are the executable version of the rule: a prediction is reported
// whether or not gold can score it; only the RATIOS go null when there is nothing to match against.
describe('DEFECT GUARD (I16): predictions are reported even when gold cannot score them', async () => {
  const v1Gold = baseGold({
    messageCount: 30,
    claims: [{ id: 'c1', person: 'a', statement: '在云杉医院当护士', category: 'work', sensitive: false, evidence: [1] }],
  })
  const judge = fakeJudge({ matches: { 在云杉医院当护士: { gold: 'c1', verdict: 'same' as const } } })
  const predWithInteraction = basePred({
    claims: [claim('a', '在云杉医院当护士', 'work', [1])],
    loops: [
      loop('a', 'promise', 'mine', '答应帮忙订饭店', [1], 0, { idx: 6 }),
      loop('a', 'question', 'theirs', '问了地址没人回', [3]),
      loop('b', 'plan', 'mutual', '约好周六去爬山', [11], 1),
    ],
    // 0..9 and 10..19 are more than 3 h apart, 20..29 is two days later → three conversations
    segments: [segment(0, 9, '聊了上班', ['上班'], [0, 9], 0), segment(10, 19, '聊了婚礼', ['婚礼'], [10, 19], 1), segment(20, 29, '出差', [], [20, 29], 1)],
    closes: [close(0, [6], 0)],
    windows: [
      { index: 0, startIdx: 0, endIdx: 9, outcome: 'done', attempts: 1, attemptMs: [1], latencyMs: 1, rawItemCount: 4, droppedInvalidEvidence: 0, rawOutputs: [] },
      { index: 1, startIdx: 10, endIdx: 29, outcome: 'done', attempts: 1, attemptMs: [1], latencyMs: 1, rawItemCount: 4, droppedInvalidEvidence: 0, rawOutputs: [] },
    ],
  })
  const { counts } = await scoreZip({ zipLabel: 'mini.zip', messages, gold: v1Gold, pred: predWithInteraction, judge })
  const m = metricsFromCounts(counts)

  it('loops.predicted is the number the pipeline produced, not 0 (the first defect)', () => {
    expect(m.loops.predicted).toBe(3)
    expect(m.interaction.predictedCloses).toBe(1)
  })

  it('conversationsPredicted is what groupSegments makes of this run`s own segments, not 0 (the second defect)', () => {
    expect(m.interaction.segments).toBe(3)
    expect(m.interaction.conversationsPredicted).toBe(3)
    expect(m.interaction.conversationsGold).toBe(0)
  })

  it('…and every ratio that has no gold behind it is null, never 0', () => {
    expect(m.loops.precisionLenient).toBeNull()
    expect(m.loops.precisionStrict).toBeNull()
    expect(m.loops.recallStrict).toBeNull()
    expect(m.loops.recallLenient).toBeNull()
    expect(m.interaction.conversationCoverage).toBeNull()
    expect(m.interaction.topicCoverage).toBeNull()
    expect(m.interaction.loopCloseRecall).toBeNull()
    // unscored ≠ wrong: no FP, no FN, no error taxonomy entry, and no judge call was spent on them
    expect(m.loops).toMatchObject({ scored: 0, tpLenient: 0, fp: 0, fn: 0 })
    expect(Object.values(m.errors.loops).every((v) => v === 0)).toBe(true)
    expect(judge.inputs.match.some((i) => i.person.key.startsWith('loops:'))).toBe(false)
    expect(judge.inputs.fp.flatMap((i) => i.items).some((i) => i.type === 'loop')).toBe(false)
  })

  it('the loops gate passes on null and says why, instead of failing on a 0 nobody measured', () => {
    const gates = sourceGates({ source: 'synthetic', evaluated: true, metrics: m, zipsWithGold: 1, scoredZips: 1, problemZips: 0, gold: [{ frozen: true, changeRecorded: null, lockAppendOnly: null }], judgeFallback: false, p95WindowMs: 1, p95Enforced: false })
    const g = gates.find((x) => x.name === 'loops.precisionLenient')!
    expect(g).toMatchObject({ value: null, passed: true })
    expect(g.note).toContain('3 loops predicted, none scored')
  })

  it('the console summary prints the count and names the reason the ratios are blank', async () => {
    const { summaryLines } = await import('../src/report')
    const text = summaryLines({
      reportVersion: 1,
      runId: 'r',
      createdAt: '2026-09-16T00:00:00.000Z',
      promptVersion: 'extract.v8',
      interactionPromptVersion: 'interaction.v1',
      model: 'deepseek-flash',
      mode: 'replay',
      deadlinePolicy: 'app',
      parserVersion: 'fake-parser-1',
      judgePromptVersions: { match: 'judge-match.v1', fp: 'judge-fp.v1' },
      judgeFallback: false,
      aborted: null,
      usage: { inputTokens: 10, outputTokens: 2, calls: 3, byCall: { extract: { inputTokens: 8, outputTokens: 1, calls: 2, failedCalls: 0 }, interaction: { inputTokens: 2, outputTokens: 1, calls: 1, failedCalls: 0 }, dedup: { inputTokens: 0, outputTokens: 0, calls: 0, failedCalls: 0 }, other: { inputTokens: 0, outputTokens: 0, calls: 0, failedCalls: 0 } }, judgeInputTokens: 0, judgeOutputTokens: 0, judgeCalls: 0, judgeCacheHits: 0, judgeFallbacks: 0 },
      gold: [],
      p95WindowMs: { synthetic: 1, real: null },
      p95Valid: true,
      sources: { synthetic: { ...m, zips: 1 }, real: null },
      gates: [],
      passed: true,
      passedBySource: { synthetic: true, real: false },
      zips: [{ zip: 'mini.zip', source: 'synthetic', status: 'scored', messageCount: 30, windows: null, metrics: null, errors: null }],
      warnings: [],
    }).join('\n')
    expect(text).toContain('n=3')
    expect(text).toContain('no gold zip annotates loops')
    expect(text).toContain('conversations 3 pred')
    // the split's cost is legible: both prompt versions and both call budgets
    expect(text).toContain('interaction interaction.v1')
    expect(text).toContain('extract in 8 out 1 (2 calls) · interaction in 2 out 1 (1 calls)')
  })
})

describe('usage is bucketed by which model call made it (DECISIONS I17 cost side)', () => {
  it('the interaction call is recognised by its own prompt version, whatever purpose it carries', () => {
    expect(usageBucket({ purpose: 'extract', promptVersion: 'extract.v8' })).toBe('extract')
    expect(usageBucket({ purpose: 'extract', promptVersion: 'interaction.v1' })).toBe('interaction')
    expect(usageBucket({ purpose: 'interaction', promptVersion: 'whatever' })).toBe('interaction')
    expect(usageBucket({ purpose: 'extract', promptVersion: 'segments.v1' }, 'segments.v1')).toBe('interaction')
    expect(usageBucket({ purpose: 'dedup', promptVersion: 'dedup.v2' })).toBe('dedup')
    // extract.v9 did the interaction layer INSIDE the extraction call: one call, one bucket, which is the honest
    // accounting for it — there was no second call to charge (DECISIONS I15).
    expect(usageBucket({ purpose: 'extract', promptVersion: 'extract.v9' })).toBe('extract')
  })

  it('tallyingClient counts calls and tokens per bucket, failures included', async () => {
    const { tallyingClient } = await import('../src/usage')
    const seen: string[] = []
    const inner = {
      async completeJson(req: { promptVersion: string }) {
        seen.push(req.promptVersion)
        if (req.promptVersion === 'interaction.v1' && seen.length > 2) return { ok: false as const, code: 'timeout' as const, message: 'x', raw: null, retryable: true, latencyMs: 1 }
        return { ok: true as const, json: {}, raw: '{}', usage: { inputTokens: 100, outputTokens: 10, cacheHitTokens: null }, latencyMs: 1, model: 'deepseek-flash', finishReason: 'stop', fromCassette: true }
      },
    }
    const c = tallyingClient(inner, 'interaction.v1')
    const req = (promptVersion: string, purpose: 'extract' | 'dedup') => ({ purpose, promptVersion, model: 'deepseek-flash', messages: [], maxTokens: 10 })
    await c.completeJson(req('extract.v8', 'extract'))
    await c.completeJson(req('interaction.v1', 'extract'))
    await c.completeJson(req('interaction.v1', 'extract'))
    await c.completeJson(req('dedup.v2', 'dedup'))
    expect(c.usage.extract).toEqual({ inputTokens: 100, outputTokens: 10, calls: 1, failedCalls: 0 })
    expect(c.usage.interaction).toEqual({ inputTokens: 100, outputTokens: 10, calls: 2, failedCalls: 1 })
    expect(c.usage.dedup).toEqual({ inputTokens: 100, outputTokens: 10, calls: 1, failedCalls: 0 })
    expect(c.promptVersions.interaction).toEqual(['interaction.v1'])
  })
})

// ---------------------------------------------------------------- v8 → v9 comparison (§7.5, task: make the claim shift visible)
describe('--compare puts claims and interaction side by side without inventing a routing story', async () => {
  const msgs = messages
  const judge = () =>
    fakeJudge({
      matches: {
        在云杉医院当护士: { gold: 'c1', verdict: 'same' as const },
        开编程培训班: { gold: 'c2', verdict: 'same' as const },
        约好周六去爬山: { gold: 'l3', verdict: 'same' as const },
      },
      labels: { 在门口等人: { label: 'should_ignore' as const, subLabel: 'coordination' as const } },
    })
  const g = baseGold({
    goldVersion: 2,
    messageCount: 30,
    claims: [
      { id: 'c1', person: 'a', statement: '在云杉医院当护士', category: 'work', sensitive: false, evidence: [1] },
      { id: 'c2', person: 'b', statement: '开编程培训班', category: 'work', sensitive: false, evidence: [3] },
    ],
    loops: [{ id: 'l3', person: 'b', direction: 'mutual', kind: 'plan', text: '约好周六去爬山', evidence: [11] }],
    conversations: [{ id: 'v1', startIdx: 0, endIdx: 9, topics: ['上班'] }],
  })
  const windows = [
    { index: 0, startIdx: 0, endIdx: 9, outcome: 'done' as const, attempts: 1, attemptMs: [1], latencyMs: 1, rawItemCount: 3, droppedInvalidEvidence: 0, rawOutputs: [] },
    { index: 1, startIdx: 10, endIdx: 29, outcome: 'done' as const, attempts: 1, attemptMs: [1], latencyMs: 1, rawItemCount: 3, droppedInvalidEvidence: 0, rawOutputs: [] },
  ]
  // v8: the coordination line still becomes a claim. v9: it becomes a loop + a segment instead.
  const v8 = await scoreZip({
    zipLabel: 'z', messages: msgs, gold: g, judge: judge(),
    pred: basePred({ windows, claims: [claim('a', '在云杉医院当护士', 'work', [1]), claim('b', '开编程培训班', 'work', [3]), claim('b', '在门口等人', 'other', [11], 1)] }),
  })
  const v9 = await scoreZip({
    zipLabel: 'z', messages: msgs, gold: g, judge: judge(),
    pred: basePred({
      windows,
      claims: [claim('a', '在云杉医院当护士', 'work', [1])],
      loops: [loop('b', 'plan', 'mutual', '约好周六去爬山', [11], 1)],
      segments: [segment(0, 9, '聊了上班的事', ['上班'], [0, 9])],
    }),
  })

  const report = (counts: Parameters<typeof metricsFromCounts>[0], promptVersion: string, interactionPromptVersion: string | null = null) => ({
    reportVersion: 1 as const,
    runId: promptVersion,
    createdAt: '2026-09-16T00:00:00.000Z',
    promptVersion,
    interactionPromptVersion,
    model: 'deepseek-flash',
    mode: 'replay' as const,
    deadlinePolicy: 'app' as const,
    parserVersion: 'fake-parser-1',
    judgePromptVersions: { match: 'judge-match.v1', fp: 'judge-fp.v1' },
    judgeFallback: false,
    aborted: null,
    usage: { inputTokens: 0, outputTokens: 0, calls: 0, byCall: zeroUsageByBucket(), judgeInputTokens: 0, judgeOutputTokens: 0, judgeCalls: 0, judgeCacheHits: 0, judgeFallbacks: 0 },
    gold: [],
    p95WindowMs: { synthetic: 1, real: null },
    p95Valid: true,
    sources: { synthetic: { ...metricsFromCounts(counts), zips: 1 }, real: null },
    gates: [],
    passed: false,
    passedBySource: { synthetic: false, real: false },
    zips: [],
    warnings: [],
  })

  it('the block reports the claim movement and the interaction numbers without claiming one explains the other', async () => {
    const { compareLines, compareReports, CLAIMS_VS_INTERACTION_NOTE } = await import('../src/report')
    const cmp = compareReports(report(v8.counts, 'extract.v8'), report(v9.counts, 'extract.v9'), '2026-09-16T00:00:00.000Z')
    const t = cmp.claimsVsInteraction.synthetic
    expect(t.claimsPredicted).toEqual([3, 1, -2])
    expect(t.claimsRecallStrict).toEqual([1, 0.5, -0.5]) // gold c2 became a loop instead of a claim
    expect(t.claimsFn).toEqual([0, 1, 1])
    expect(t.loopsPredicted).toEqual([0, 1, 1])
    expect(t.segments).toEqual([0, 1, 1])
    expect(t.note).toBe(CLAIMS_VS_INTERACTION_NOTE)
    expect(cmp.sources.synthetic.delta['loops.predicted']).toBe(1)
    expect(cmp.sources.synthetic.delta['interaction.conversationCoverage']).toBe(1)

    const text = compareLines(cmp).join('\n')
    expect(text).toContain('claims ↔ interaction (two independent calls): claims n 3 → 1')
    expect(text).toContain('loops R (strict, REPORTED not gated)')
    expect(text).toContain('claims R (strict)')
    expect(text).toContain('cost Δ:')
  })

  // DECISIONS I15: the block used to say "claims n down + segments/loops up = the routing rule working". The live
  // run went the other way (claims n 50 → 55 AND precision down) and that sentence would have excused it. Whatever
  // else the note says, it must not tell the reader to discount a claims change because of the loop numbers.
  it('the note never excuses a claims regression with the interaction numbers', async () => {
    const { CLAIMS_VS_INTERACTION_NOTE } = await import('../src/report')
    expect(CLAIMS_VS_INTERACTION_NOTE).toContain('两次独立的模型调用')
    expect(CLAIMS_VS_INTERACTION_NOTE).toContain('没有分流')
    for (const excuse of ['是规则在起作用', 'the rule working', 'not a regression']) expect(CLAIMS_VS_INTERACTION_NOTE).not.toContain(excuse)
  })

  it('refuses a comparison whose two runs used different interaction prompts, and flags a null↔version one', async () => {
    const { compareLines, compareReports } = await import('../src/report')
    const a = report(v8.counts, 'extract.v8', 'interaction.v1')
    const b = report(v9.counts, 'extract.v8', 'interaction.v2')
    expect(() => compareReports(a, b, '2026-09-16T00:00:00.000Z')).toThrow(/different interaction prompt versions/)
    // the split itself (no interaction call → interaction.v1) is a legitimate comparison, so it is flagged, not refused
    const cmp = compareReports(report(v8.counts, 'extract.v9'), report(v9.counts, 'extract.v8', 'interaction.v1'), '2026-09-16T00:00:00.000Z')
    expect(cmp.warnings.join(' ')).toContain('interaction prompt version differs')
    expect(compareLines(cmp).join('\n')).toContain('⚠ interaction prompt version differs')
  })
})
