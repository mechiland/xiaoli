// Harness proof on hand-built mini gold + predictions with fakeJudge (ARCHITECTURE §7.4 required unit test).
// Covers every ErrorCode, every subLabel, strict vs lenient, optional gold, unmatched new persons, windows/p95.
import { describe, expect, it } from 'vitest'
import { fakeJudge } from '../src/judge'
import { gatesPassed, metricsFromCounts, p95, sourceGates } from '../src/metrics'
import { scoreZip } from '../src/score'
import { baseGold, basePred, claim, scoreMessages } from './helpers'

const messages = scoreMessages(20)

const gold = baseGold({
  persons: [
    { key: 'me', label: '小满', inChat: true },
    { key: 'a', label: '阿青', aliases: ['青姐'], inChat: true },
    { key: 'b', label: '老周', inChat: true },
    { key: 'kid', label: '豆豆', inChat: false },
  ],
  claims: [
    { id: 'c1', person: 'a', statement: '在云杉医院当护士', category: 'work', sensitive: false, evidence: [1] },
    { id: 'c2', person: 'a', statement: '住在青禾区', category: 'location', sensitive: false, evidence: [2] },
    { id: 'c3', person: 'b', statement: '开编程培训班', category: 'work', sensitive: false, evidence: [3] },
    { id: 'c4', person: 'b', statement: '喜欢钓鱼', category: 'preference', sensitive: false, evidence: [4], optional: true },
    { id: 'c5', person: 'kid', statement: '读三年级', category: 'education', sensitive: false, evidence: [5] },
  ],
  handles: [
    { id: 'h1', person: 'a', kind: 'mentioned', value: '青姐', evidence: [6] },
    { id: 'h2', person: 'b', kind: 'real_name', value: '周明', evidence: [7] },
  ],
  relations: [
    { id: 'r1', from: 'b', to: 'kid', type: 'parent', evidence: [8] },
    { id: 'r2', from: 'a', to: 'me', type: 'friend', evidence: [9] },
  ],
  dates: [{ id: 'd1', person: 'a', kind: 'birthday', month: 3, day: 15, calendar: 'lunar', evidence: [10] }],
  events: [{ id: 'e1', summary: '周六聚餐', participants: ['a', 'b'], evidence: [11], optional: true }],
  negatives: [
    { id: 'n1', kind: 'transactional', evidence: [12], description: '报价' },
    { id: 'n2', kind: 'coordination', evidence: [13], description: '我在门口' },
    { id: 'n3', kind: 'inference_trap', evidence: [14], description: '你儿子不 care' },
    { id: 'n4', kind: 'sensitive', evidence: [15], description: '手机号' },
    { id: 'n5', kind: 'invisible_content', evidence: [16], description: '转账' },
  ],
  sensitiveValues: ['13900001111'],
})

const W0 = 0
const W1 = 1
const pred = basePred({
  persons: [
    { key: 'me', label: '小满', isSelf: true },
    { key: 'a', label: '阿青', isSelf: false },
    { key: 'b', label: '老周', isSelf: false },
    { key: 'new:豆豆', label: '豆豆', isSelf: false },
    { key: 'new:王老师', label: '王老师', isSelf: false },
  ],
  claims: [
    claim('a', '在云杉医院当护士', 'work', [1]), // TP same c1
    claim('a', '住在云杉', 'location', [2]), // TP less_specific c2
    claim('b', '开了编程培训班', 'other', [3]), // TP same c3 (category mismatch)
    claim('b', '喜欢钓鱼', 'preference', [4]), // TP same c4 (optional)
    claim('new:豆豆', '读三年级', 'education', [5]), // TP same c5 via new-person label match
    claim('a', '在门口等人', 'other', [13], W1), // should_ignore/coordination
    claim('a', '有一个儿子', 'family', [14], W1), // over_inference
    claim('a', '手机号13900001111', 'other', [15], W1), // sensitive_leak (deterministic)
    claim('a', '转账500元', 'other', [16], W1), // should_ignore/invisible_content
    claim('b', '在云杉医院当护士', 'work', [1]), // wrong_person (judge)
    claim('a', '在青禾区医院当医生', 'work', [1]), // factual_error
    claim('new:王老师', '教语文', 'work', [5]), // unmatched new person → other
    claim('a', '住在青禾区', 'location', [25]), // invalid_evidence (out of range)
    claim('a', '爱吃辣', 'preference', [12], W0), // invalid_evidence (outside its window)
    claim('b', '报价1680元', 'other', [12], W1), // should_ignore/transactional
    claim('a', '是护士', 'work', [1]), // duplicate of c1 → FP other
    claim('me', '今天天气很好', 'other', [0]), // should_ignore/not_about_person
  ],
  handles: [
    { person: 'a', kind: 'mentioned', value: '青姐', evidence: [6], windowIndex: W0 },
    { person: 'b', kind: 'mentioned', value: '周明', evidence: [7], windowIndex: W0 }, // TP, kind mismatch
    { person: 'b', kind: 'mentioned', value: '青姐', evidence: [6], windowIndex: W0 }, // wrong_person
    { person: 'me', kind: 'address_term', value: '13900001111', evidence: [15], windowIndex: W1 }, // sensitive_leak
  ],
  relations: [
    { from: 'new:豆豆', to: 'b', type: 'child', evidence: [8], windowIndex: W0 }, // TP (inverse of r1)
    { from: 'me', to: 'a', type: 'friend', evidence: [9], windowIndex: W0 }, // TP (symmetric swap of r2)
    { from: 'a', to: 'new:豆豆', type: 'parent', evidence: [14], windowIndex: W1 }, // wrong_person (deterministic)
    { from: 'a', to: 'b', type: 'colleague', evidence: [9], windowIndex: W0 }, // over_inference (judge)
  ],
  dates: [
    { person: 'a', kind: 'birthday', month: 3, day: 15, calendar: 'lunar', evidence: [10], windowIndex: W1 }, // TP
    { person: 'b', kind: 'birthday', month: 3, day: 15, calendar: 'lunar', evidence: [10], windowIndex: W1 }, // wrong_person
    { person: 'a', kind: 'birthday', month: 3, day: 15, calendar: 'solar', evidence: [10], windowIndex: W1 }, // factual_error
  ],
  events: [
    { summary: '周六一起聚餐', participants: ['a', 'b'], evidence: [11], windowIndex: W1 }, // TP optional
    { summary: '报价会', participants: ['b'], evidence: [12], windowIndex: W1 }, // should_ignore/transactional
  ],
  windows: [
    { index: 0, startIdx: 0, endIdx: 9, outcome: 'done', attempts: 1, attemptMs: [1000], latencyMs: 1000, rawItemCount: 20, droppedInvalidEvidence: 1, dedup: 'skipped_deadline', rawOutputs: [] },
    { index: 1, startIdx: 10, endIdx: 19, outcome: 'done', attempts: 2, attemptMs: [2000, 31000], latencyMs: 33000, rawItemCount: 0, droppedInvalidEvidence: 0, dedup: 'ran', rawOutputs: [] },
    { index: 2, startIdx: 15, endIdx: 19, outcome: 'fatal_error', code: 'invalid_json', attempts: 3, attemptMs: [500, 500, 500], latencyMs: 1500, rawItemCount: 0, droppedInvalidEvidence: 0, rawOutputs: [] },
  ],
})

const judgeTable = {
  matches: {
    在云杉医院当护士: { gold: 'c1', verdict: 'same' as const },
    住在云杉: { gold: 'c2', verdict: 'less_specific' as const },
    开了编程培训班: { gold: 'c3', verdict: 'same' as const },
    喜欢钓鱼: { gold: 'c4', verdict: 'same' as const },
    读三年级: { gold: 'c5', verdict: 'same' as const },
    是护士: { gold: 'c1', verdict: 'same' as const },
    周六一起聚餐: { gold: 'e1', verdict: 'same' as const },
  },
  labels: {
    在门口等人: { label: 'should_ignore' as const, subLabel: 'coordination' as const, negativeId: 'n2' },
    有一个儿子: { label: 'over_inference' as const, negativeId: 'n3' },
    转账500元: { label: 'should_ignore' as const, subLabel: 'invisible_content' as const, negativeId: 'n5' },
    在云杉医院当护士: { label: 'wrong_person' as const, goldId: 'c1' },
    在青禾区医院当医生: { label: 'factual_error' as const },
    报价1680元: { label: 'should_ignore' as const, subLabel: 'transactional' as const, negativeId: 'n1' },
    今天天气很好: { label: 'should_ignore' as const, subLabel: 'not_about_person' as const },
    '阿青 —colleague→ 老周': { label: 'over_inference' as const },
    'birthday 3-15 solar': { label: 'factual_error' as const },
    报价会: { label: 'should_ignore' as const, subLabel: 'transactional' as const },
  },
}

describe('scoreZip + metrics on a hand-built mini gold', async () => {
  const judge = fakeJudge(judgeTable)
  const { counts, details } = await scoreZip({ zipLabel: 'mini.zip', messages, gold, pred, judge })
  const m = metricsFromCounts(counts)

  it('claims: strict vs lenient precision and recall, optional gold', () => {
    expect(m.claims).toMatchObject({ predicted: 17, tpStrict: 4, tpLenient: 5, goldRequired: 4, goldMatchedStrict: 3, goldMatchedLenient: 4, fp: 12, fn: 0 })
    expect(m.claims.precisionLenient).toBe(0.2941)
    expect(m.claims.precisionStrict).toBe(0.2353)
    expect(m.claims.recallStrict).toBe(0.75)
    expect(m.claims.recallLenient).toBe(1)
    expect(m.claims.yieldPer100).toBe(85)
    expect(details.fn).toEqual([{ type: 'claims', goldId: 'c2', text: '住在青禾区', lessSpecificMatch: true }])
  })

  it('deterministic types: handles, relations (inverse + symmetric), dates; events via judge', () => {
    expect(m.handles).toMatchObject({ predicted: 4, tpLenient: 2, precisionLenient: 0.5, recallStrict: 1 })
    expect(m.relations).toMatchObject({ predicted: 4, tpLenient: 2, precisionLenient: 0.5, recallStrict: 1 })
    expect(m.dates).toMatchObject({ predicted: 3, tpLenient: 1, precisionLenient: 0.3333, recallStrict: 1 })
    expect(m.events).toMatchObject({ predicted: 2, tpStrict: 1, tpLenient: 1, goldRequired: 0, precisionLenient: 0.5, recallStrict: null })
    expect(m.kindMismatch).toBe(1)
    expect(m.categoryMismatch).toBe(1)
    expect(m.yieldPer100Total).toBe(150)
  })

  it('classifies every false positive into every ErrorCode', () => {
    expect(m.errors.claims).toEqual({ factual_error: 1, wrong_person: 1, over_inference: 1, should_ignore: 4, sensitive_leak: 1, invalid_evidence: 2, other: 2 })
    expect(m.errors.handles).toMatchObject({ wrong_person: 1, sensitive_leak: 1 })
    expect(m.errors.relations).toMatchObject({ wrong_person: 1, over_inference: 1 })
    expect(m.errors.dates).toMatchObject({ wrong_person: 1, factual_error: 1 })
    expect(m.errors.events).toMatchObject({ should_ignore: 1 })
    expect(m.subLabels).toEqual({ transactional: 2, coordination: 1, invisible_content: 1, not_about_person: 1 })
  })

  it('gate inputs: transactional ratio, sensitive, invalid evidence, overlap, unmatched new persons', () => {
    expect(m.transactionalClaims).toBe(2)
    expect(m.transactionalAsClaimRatio).toBe(0.1176)
    expect(m.sensitiveInStatement).toBe(2)
    expect(m.invalidEvidencePost).toBe(2)
    expect(m.invalidEvidencePreRate).toBe(0.05)
    expect(m.evidenceOverlap).toBe(1)
    expect(m.unmatchedNewPersons).toBe(1)
    expect(details.unmatchedNewPersons).toEqual(['new:王老师'])
  })

  it('window stats and nearest-rank p95 over all attempts', () => {
    expect(counts.windows).toMatchObject({ total: 3, failed: 1, dedupSkipped: 1, failedCodes: { invalid_json: 1 } })
    expect(p95(counts.windows.attemptMs)).toBe(31000)
    expect(p95([])).toBeNull()
    expect(p95(Array.from({ length: 20 }, (_, i) => i + 1))).toBe(19)
  })

  it('judge sees batches of ≤10 FPs with evidence windows (±2, capped) and unknown persons', () => {
    expect(judge.inputs.match).toHaveLength(4) // persons a, b, kid + events
    expect(judge.inputs.fp.map((i) => i.items.length)).toEqual([10, 2])
    const all = judge.inputs.fp.flatMap((i) => i.items)
    expect(all.every((it) => it.evidenceWindow.length <= 30 && it.evidenceWindow.some((w) => w.isEvidence))).toBe(true)
    const unknown = all.find((it) => it.text === '教语文')!
    expect(unknown.person).toBe('unknown')
    expect(unknown.evidenceWindow.map((w) => w.idx)).toEqual([3, 4, 5, 6, 7])
    expect(judge.inputs.fp[0].negatives).toHaveLength(5)
  })

  it('gates fail on these numbers; precision/recall gate reading is lenient/strict', () => {
    const gates = sourceGates({ source: 'synthetic', evaluated: true, metrics: m, zipsWithGold: 1, scoredZips: 1, problemZips: 0, gold: [{ frozen: true, changeRecorded: null, lockAppendOnly: null }], judgeFallback: false, p95WindowMs: 31000, p95Enforced: false })
    const byName = Object.fromEntries(gates.map((g) => [g.name, g]))
    expect(byName['claims.precisionLenient']).toMatchObject({ value: 0.2941, passed: false })
    expect(byName['claims.recallStrict']).toMatchObject({ value: 0.75, passed: true })
    expect(byName['handles.precisionLenient'].passed).toBe(false)
    expect(byName.sensitiveInStatement.passed).toBe(false)
    expect(byName.invalidEvidencePost.passed).toBe(false)
    expect(byName.transactionalAsClaimRatio.passed).toBe(false)
    expect(byName.p95WindowMs).toMatchObject({ informational: true })
    expect(gatesPassed(gates)).toBe(false)
  })
})

describe('perfect predictions pass every gate', async () => {
  const perfect = basePred({
    claims: gold.claims.map((c) => claim(c.person, c.statement, c.category, c.evidence, c.evidence[0] >= 10 ? 1 : 0)),
    handles: gold.handles.map((h) => ({ person: h.person, kind: h.kind, value: h.value, evidence: h.evidence, windowIndex: 0 })),
    relations: gold.relations.map((r) => ({ from: r.from, to: r.to, type: r.type, evidence: r.evidence, windowIndex: 0 })),
    dates: gold.dates.map((d) => ({ person: d.person, kind: d.kind, month: d.month, day: d.day, calendar: d.calendar, evidence: d.evidence, windowIndex: 1 })),
    windows: [
      { index: 0, startIdx: 0, endIdx: 9, outcome: 'done', attempts: 1, attemptMs: [8000], latencyMs: 8000, rawItemCount: 9, droppedInvalidEvidence: 0, rawOutputs: [] },
      { index: 1, startIdx: 10, endIdx: 19, outcome: 'done', attempts: 1, attemptMs: [9000], latencyMs: 9000, rawItemCount: 1, droppedInvalidEvidence: 0, rawOutputs: [] },
    ],
  })
  const judge = fakeJudge({ matches: Object.fromEntries(gold.claims.map((c) => [c.statement, { gold: c.id, verdict: 'same' as const }])) })
  const { counts } = await scoreZip({ zipLabel: 'mini.zip', messages, gold, pred: perfect, judge })
  const m = metricsFromCounts(counts)

  it('scores 1.0 and passes gates (p95 enforced in record mode)', () => {
    expect(m.claims.precisionLenient).toBe(1)
    expect(m.claims.recallStrict).toBe(1)
    const gates = sourceGates({ source: 'synthetic', evaluated: true, metrics: m, zipsWithGold: 1, scoredZips: 1, problemZips: 0, gold: [{ frozen: true, changeRecorded: true, lockAppendOnly: true }], judgeFallback: false, p95WindowMs: p95(counts.windows.attemptMs), p95Enforced: true })
    expect(gates.filter((g) => !g.passed)).toEqual([])
    expect(gatesPassed(gates)).toBe(true)
    expect(judge.inputs.fp).toHaveLength(0)
  })

  it('preconditions fail the source: not frozen, judge fallback, unscored zips, unevaluated source', () => {
    const base = { source: 'synthetic' as const, evaluated: true, metrics: m, zipsWithGold: 1, scoredZips: 1, problemZips: 0, gold: [{ frozen: true, changeRecorded: null, lockAppendOnly: null }], judgeFallback: false, p95WindowMs: null, p95Enforced: false }
    expect(gatesPassed(sourceGates(base))).toBe(true)
    expect(gatesPassed(sourceGates({ ...base, gold: [{ frozen: false, changeRecorded: null, lockAppendOnly: null }] }))).toBe(false)
    expect(gatesPassed(sourceGates({ ...base, judgeFallback: true }))).toBe(false)
    expect(gatesPassed(sourceGates({ ...base, problemZips: 1 }))).toBe(false)
    expect(gatesPassed(sourceGates({ ...base, evaluated: false }))).toBe(false)
    expect(gatesPassed(sourceGates({ ...base, metrics: null, scoredZips: 0 }))).toBe(false)
    expect(gatesPassed(sourceGates({ ...base, p95WindowMs: 40000, p95Enforced: true }))).toBe(false)
  })
})
