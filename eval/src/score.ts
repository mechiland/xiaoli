// Scoring of one ZIP: person mapping, matching (§7.3), FP classification, raw counts (§7.4).
import { groupRunSegments, matchConversations, type ConversationScore, type PredConversation } from './conversations'
import type { OfflineExtractionResult } from './entries'
import type { GoldFile } from './gold-schema'
import type { FpClassifyInput, FpSubLabel, JudgeClient, MatchOutput, Verdict } from './judge'
import { normKey, sensitiveHits } from './text'

/** `loops` is appended last so the five round-1 types keep their order in reports and FP batches (§7.4). */
export const TYPES = ['claims', 'relations', 'handles', 'dates', 'events', 'loops'] as const
export type TypeName = (typeof TYPES)[number]
export const ERROR_CODES = ['factual_error', 'wrong_person', 'over_inference', 'should_ignore', 'sensitive_leak', 'invalid_evidence', 'other'] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
export const SUB_LABELS = ['transactional', 'coordination', 'invisible_content', 'not_about_person'] as const
export const UNKNOWN_PERSON = 'unknown'
/** Person value of items owned by a `new:` person whose name is a sender's label/alias: `duplicate:<sender key>`. */
export const DUPLICATE_PREFIX = 'duplicate:'
const isPhantom = (person: string) => person === UNKNOWN_PERSON || person.startsWith(DUPLICATE_PREFIX)
const SINGULAR = { claims: 'claim', relations: 'relation', handles: 'handle', dates: 'date', events: 'event', loops: 'loop' } as const
const SYMMETRIC = new Set(['spouse', 'sibling', 'friend', 'colleague', 'classmate', 'relative'])
const INVERSE: Record<string, string> = { parent: 'child', child: 'parent' }

export interface ScoreMessage {
  idx: number
  senderName: string
  sentAt: string
  body: string
}

export interface TypeCounts {
  /** everything the run produced — reported whether or not gold can score it (DECISIONS I16) */
  predicted: number
  /**
   * the subset of `predicted` that gold could actually be matched against, i.e. the denominator of precision.
   * Equal to `predicted` for every type except `loops` on a zip whose gold has no `loops` key: there the run's
   * loops are reported (`predicted`) but not scored (`scored` = 0 → precision/recall are null, not 0).
   */
  scored: number
  tpStrict: number
  tpLenient: number
  goldRequired: number
  goldMatchedStrict: number
  goldMatchedLenient: number
}
export interface ZipCounts {
  messages: number
  types: Record<TypeName, TypeCounts>
  errors: Record<TypeName, Record<ErrorCode, number>>
  subLabels: Record<FpSubLabel, number>
  transactionalClaims: number
  sensitiveInStatement: number
  invalidEvidencePost: number
  droppedInvalidEvidence: number
  rawItemCount: number
  evidenceOverlapCount: number
  unmatchedNewPersons: number
  /** `new:` persons whose label equals a sender person's gold label/alias (in-app: a duplicate of that sender) */
  duplicateSenderPersons: number
  kindMismatch: number
  categoryMismatch: number
  /** interaction layer (§7.4). `*Annotated` is 0/1 per zip: a gold file without the key is left out entirely. */
  interaction: InteractionCounts
  /**
   * `interactionFailed` / `interactionSkipped`: windows whose interaction call did not produce anything. Without
   * them "0 loops" is ambiguous between "the model found none" and "the call never landed" (DECISIONS I17 failure
   * isolation — an interaction failure leaves the window `done` and the claims in place).
   */
  windows: { total: number; failed: number; dedupSkipped: number; interactionFailed: number; interactionSkipped: number; attemptMs: number[]; failedCodes: Record<string, number> }
}

export interface InteractionCounts {
  /** gold has a `loops` key (goldVersion 2) — otherwise loops are not scored for this zip at all */
  loopsAnnotated: number
  /** gold has a `conversations` key */
  conversationsAnnotated: number
  /** matched loop pairs whose kind or direction differs — reported, never a miss (§7.3) */
  loopKindMismatch: number
  /** non-optional gold loops with `closedBy` */
  goldCloses: number
  /** …of which the run closed at that idx */
  goldClosesMatched: number
  /** mechanically impossible closes: loop never shown to that window, or close not after the open (§7.4, I13) */
  falseCloses: number
  /** predicted loops whose resolved `closedIdx` is set */
  predictedCloses: number
  segments: number
  conversationsPredicted: number
  conversationsGold: number
  conversationsMatched: number
  /** Σ per-conversation topic coverage over matched conversations (optional ones included) */
  topicCoverageSum: number
  /** matched conversations the sum above runs over */
  topicCoverageN: number
  topicsGold: number
  topicsCovered: number
  /** segments + loops whose evidence is out of range or outside its window (mechanical, gate = 0) */
  segmentInvalidEvidence: number
}

export interface TpDetail { type: TypeName; predIndex: number; goldId: string; verdict: Verdict; text: string; goldText: string; evidenceOverlap: boolean }
export interface FpDetail { type: TypeName; fpId: string; predIndex: number; person: string; text: string; evidence: number[]; label: ErrorCode; subLabel: FpSubLabel | null; goldId: string | null; negativeId: string | null; reason: string }
export interface FnDetail { type: TypeName; goldId: string; text: string; lessSpecificMatch: boolean }
export interface LoopCloseDetail { goldId: string; closedBy: number; predClosedByIdx: number | null; matched: boolean }
export interface InteractionDetails {
  loopKindMismatch: { goldId: string; predIndex: number; gold: string; pred: string }[]
  closes: LoopCloseDetail[]
  /** mechanically impossible closes (§7.4): `predIndex` is the loop, `reason` says what makes it impossible */
  falseCloses: { predIndex: number; closedIdx: number | null; reason: string }[]
  conversations: ConversationScore | null
}
export interface ZipDetails {
  tp: TpDetail[]
  fp: FpDetail[]
  fn: FnDetail[]
  unmatchedNewPersons: string[]
  duplicatePersons: { key: string; person: string }[]
  interaction: InteractionDetails
}
export interface ZipScore { counts: ZipCounts; details: ZipDetails }

const zeroErrors = (): Record<ErrorCode, number> => Object.fromEntries(ERROR_CODES.map((c) => [c, 0])) as Record<ErrorCode, number>
const zeroType = (): TypeCounts => ({ predicted: 0, scored: 0, tpStrict: 0, tpLenient: 0, goldRequired: 0, goldMatchedStrict: 0, goldMatchedLenient: 0 })
export const INTERACTION_KEYS = [
  'loopsAnnotated', 'conversationsAnnotated', 'loopKindMismatch', 'goldCloses', 'goldClosesMatched', 'falseCloses', 'predictedCloses',
  'segments', 'conversationsPredicted', 'conversationsGold', 'conversationsMatched', 'topicCoverageSum', 'topicCoverageN', 'topicsGold', 'topicsCovered',
  'segmentInvalidEvidence',
] as const
const zeroInteraction = (): InteractionCounts => Object.fromEntries(INTERACTION_KEYS.map((k) => [k, 0])) as unknown as InteractionCounts

export function emptyCounts(): ZipCounts {
  return {
    messages: 0,
    types: Object.fromEntries(TYPES.map((t) => [t, zeroType()])) as Record<TypeName, TypeCounts>,
    errors: Object.fromEntries(TYPES.map((t) => [t, zeroErrors()])) as Record<TypeName, Record<ErrorCode, number>>,
    subLabels: Object.fromEntries(SUB_LABELS.map((s) => [s, 0])) as Record<FpSubLabel, number>,
    transactionalClaims: 0,
    sensitiveInStatement: 0,
    invalidEvidencePost: 0,
    droppedInvalidEvidence: 0,
    rawItemCount: 0,
    evidenceOverlapCount: 0,
    unmatchedNewPersons: 0,
    duplicateSenderPersons: 0,
    kindMismatch: 0,
    categoryMismatch: 0,
    interaction: zeroInteraction(),
    windows: { total: 0, failed: 0, dedupSkipped: 0, interactionFailed: 0, interactionSkipped: 0, attemptMs: [], failedCodes: {} },
  }
}

/** Micro-average building block: sums every counter. */
export function addCounts(a: ZipCounts, b: ZipCounts): ZipCounts {
  const r = emptyCounts()
  const scalar = ['messages', 'transactionalClaims', 'sensitiveInStatement', 'invalidEvidencePost', 'droppedInvalidEvidence', 'rawItemCount', 'evidenceOverlapCount', 'unmatchedNewPersons', 'duplicateSenderPersons', 'kindMismatch', 'categoryMismatch'] as const
  for (const k of scalar) r[k] = a[k] + b[k]
  for (const t of TYPES) {
    for (const k of Object.keys(r.types[t]) as (keyof TypeCounts)[]) r.types[t][k] = a.types[t][k] + b.types[t][k]
    for (const e of ERROR_CODES) r.errors[t][e] = a.errors[t][e] + b.errors[t][e]
  }
  for (const s of SUB_LABELS) r.subLabels[s] = a.subLabels[s] + b.subLabels[s]
  for (const k of INTERACTION_KEYS) r.interaction[k] = a.interaction[k] + b.interaction[k]
  r.windows = {
    total: a.windows.total + b.windows.total,
    failed: a.windows.failed + b.windows.failed,
    dedupSkipped: a.windows.dedupSkipped + b.windows.dedupSkipped,
    interactionFailed: a.windows.interactionFailed + b.windows.interactionFailed,
    interactionSkipped: a.windows.interactionSkipped + b.windows.interactionSkipped,
    attemptMs: [...a.windows.attemptMs, ...b.windows.attemptMs],
    failedCodes: { ...a.windows.failedCodes },
  }
  for (const [k, v] of Object.entries(b.windows.failedCodes)) r.windows.failedCodes[k] = (r.windows.failedCodes[k] ?? 0) + v
  return r
}

interface PredItem {
  type: TypeName
  index: number
  person: string
  text: string
  sensitiveText: string | null
  evidence: number[]
  windowIndex: number
}

export async function scoreZip(args: { zipLabel: string; messages: ScoreMessage[]; gold: GoldFile; pred: OfflineExtractionResult; judge: JudgeClient }): Promise<ZipScore> {
  const { gold, pred, judge } = args
  const n = args.messages.length
  const counts = emptyCounts()
  counts.messages = n
  const details: ZipDetails = {
    tp: [],
    fp: [],
    fn: [],
    unmatchedNewPersons: [],
    duplicatePersons: [],
    interaction: { loopKindMismatch: [], closes: [], falseCloses: [], conversations: null },
  }
  // Interaction (§7.2/§7.4): a gold file without the key was never annotated for that type, so the zip contributes
  // nothing to those *match* metrics — no TP, no FP, no FN, and precision/recall stay null. A goldVersion-1 file
  // therefore scores exactly as before. What it does NOT mean is that the run produced nothing: `predicted`,
  // `segments` and `conversationsPredicted` always report what the pipeline actually emitted (DECISIONS I16 — the
  // live extract.v9 run reported `loops.predicted = 0` on a run that produced 12 loops, and 0 conversations on 22
  // segments; both lies pointed the same way, at "the feature is dead").
  const loopsAnnotated = gold.loops !== undefined
  const conversationsAnnotated = gold.conversations !== undefined
  const goldLoops = gold.loops ?? []
  const predLoops = pred.loops ?? []
  counts.interaction.loopsAnnotated = loopsAnnotated ? 1 : 0
  counts.interaction.conversationsAnnotated = conversationsAnnotated ? 1 : 0

  // ---- persons
  const goldKeys = new Set(gold.persons.map((p) => p.key))
  for (const s of gold.mapping.senders) if (s.person) goldKeys.add(s.person)
  const labelToKey = new Map<string, string>()
  for (const p of gold.persons) for (const name of [p.label, ...(p.aliases ?? [])]) if (!labelToKey.has(normKey(name))) labelToKey.set(normKey(name), p.key)
  const predLabels = new Map(pred.persons.map((p) => [p.key, p.label]))
  // A sender is always a known person in the pipeline, so a created person carrying a sender's name is a duplicate
  // of that sender in the app (not the sender itself): its items are FPs labelled wrong_person, never TPs.
  const senderKeys = new Set([gold.mapping.self, ...gold.mapping.senders.map((s) => s.person)].filter(Boolean))
  const unmatched = new Set<string>()
  const duplicates = new Map<string, string>()
  const mapPerson = (key: string): string => {
    if (goldKeys.has(key)) return key
    const label = predLabels.get(key) ?? (key.startsWith('new:') ? key.slice(4) : null)
    const names = [label, key.startsWith('new:') ? key.slice(4) : null].filter((x): x is string => x !== null)
    const hits = names.map((x) => labelToKey.get(normKey(x))).filter((x): x is string => x !== undefined)
    const sender = hits.find((h) => senderKeys.has(h))
    if (sender) {
      duplicates.set(key, sender)
      return DUPLICATE_PREFIX + sender
    }
    if (hits[0]) return hits[0]
    if (key.startsWith('new:') || predLabels.has(key)) unmatched.add(key)
    return UNKNOWN_PERSON
  }
  for (const p of pred.persons) mapPerson(p.key)
  const labelOf = (mapped: string, raw: string) => (isPhantom(mapped) ? predLabels.get(raw) ?? raw : gold.persons.find((p) => p.key === mapped)?.label ?? mapped)

  // ---- evidence validity (independent of the pipeline's own filter)
  const windows = new Map(pred.windows.map((w) => [w.index, w]))
  const invalidEvidence = (ev: number[], wi: number) => {
    const w = windows.get(wi)
    return !ev.length || !w || ev.some((e) => !Number.isInteger(e) || e < 0 || e >= n || e < w.startIdx || e > w.endIdx)
  }

  // ---- normalized prediction items
  const items: Record<TypeName, PredItem[]> = {
    claims: pred.claims.map((c, i) => ({ type: 'claims', index: i, person: mapPerson(c.person), text: c.statement, sensitiveText: c.statement, evidence: c.evidence, windowIndex: c.windowIndex })),
    handles: pred.handles.map((h, i) => ({ type: 'handles', index: i, person: mapPerson(h.person), text: `${h.kind}:${h.value}`, sensitiveText: h.value, evidence: h.evidence, windowIndex: h.windowIndex })),
    relations: pred.relations.map((r, i) => {
      const from = mapPerson(r.from)
      const to = mapPerson(r.to)
      return { type: 'relations', index: i, person: from, text: `${labelOf(from, r.from)} —${r.type}${r.label ? `/${r.label}` : ''}→ ${labelOf(to, r.to)}`, sensitiveText: r.label ?? null, evidence: r.evidence, windowIndex: r.windowIndex }
    }),
    dates: pred.dates.map((d, i) => ({ type: 'dates', index: i, person: mapPerson(d.person), text: `${d.kind} ${d.month ?? '?'}-${d.day ?? '?'} ${d.calendar}${d.isLeapMonth ? ' leap' : ''}`, sensitiveText: null, evidence: d.evidence, windowIndex: d.windowIndex })),
    events: pred.events.map((e, i) => ({ type: 'events', index: i, person: e.participants.map(mapPerson)[0] ?? UNKNOWN_PERSON, text: e.summary, sensitiveText: e.summary, evidence: e.evidence, windowIndex: e.windowIndex })),
    // loop text is checked for sensitive content with the segments below (mechanical, independent of gold)
    loops: predLoops.map((l, i) => ({ type: 'loops', index: i, person: mapPerson(l.person), text: `${l.kind}/${l.direction}: ${l.text}`, sensitiveText: l.text, evidence: l.evidence, windowIndex: l.windowIndex })),
  }
  const relEnds = pred.relations.map((r) => ({ from: mapPerson(r.from), to: mapPerson(r.to), type: r.type }))
  /** the item names a duplicate-of-sender person (any relation end / event participant) */
  const duplicateOf = (it: PredItem): string | null => {
    const ps = it.type === 'relations' ? [relEnds[it.index].from, relEnds[it.index].to] : it.type === 'events' ? pred.events[it.index].participants.map(mapPerson) : [it.person]
    const d = ps.find((x) => x.startsWith(DUPLICATE_PREFIX))
    return d ? d.slice(DUPLICATE_PREFIX.length) : null
  }

  // ---- matching: predIndex → match, per type
  const tp: Record<TypeName, Map<number, { goldId: string; verdict: Verdict }>> = { claims: new Map(), relations: new Map(), handles: new Map(), dates: new Map(), events: new Map(), loops: new Map() }
  const goldText: Record<TypeName, Map<string, { text: string; evidence: number[]; optional: boolean }>> = {
    claims: new Map(gold.claims.map((g) => [g.id, { text: g.statement, evidence: g.evidence, optional: !!g.optional }])),
    handles: new Map(gold.handles.map((g) => [g.id, { text: `${g.kind}:${g.value}`, evidence: g.evidence, optional: !!g.optional }])),
    relations: new Map(gold.relations.map((g) => [g.id, { text: `${g.from} —${g.type}${g.label ? `/${g.label}` : ''}→ ${g.to}`, evidence: g.evidence, optional: !!g.optional }])),
    dates: new Map(gold.dates.map((g) => [g.id, { text: `${g.kind} ${g.month ?? '?'}-${g.day ?? '?'} ${g.calendar}`, evidence: g.evidence, optional: !!g.optional }])),
    events: new Map(gold.events.map((g) => [g.id, { text: g.summary, evidence: g.evidence, optional: !!g.optional }])),
    loops: new Map(goldLoops.map((g) => [g.id, { text: `${g.kind}/${g.direction}: ${g.text}`, evidence: g.evidence, optional: !!g.optional }])),
  }

  /** deterministic one-to-one: predictions in order, required gold preferred over optional */
  function matchDeterministic<G extends { id: string; optional?: boolean }>(type: TypeName, goldList: G[], ok: (predIndex: number, g: G) => boolean) {
    const used = new Set<string>()
    const ordered = [...goldList.filter((g) => !g.optional), ...goldList.filter((g) => g.optional)]
    for (const it of items[type]) {
      if (isPhantom(it.person)) continue
      const g = ordered.find((x) => !used.has(x.id) && ok(it.index, x))
      if (g) {
        used.add(g.id)
        tp[type].set(it.index, { goldId: g.id, verdict: 'same' })
      }
    }
  }
  const relTypes = (g: GoldFile['relations'][number]) => new Set([g.type, ...(g.acceptTypes ?? [])])
  const relMatches = (p: { from: string; to: string; type: string }, g: GoldFile['relations'][number]) => {
    const types = relTypes(g)
    if (p.from === g.from && p.to === g.to && types.has(p.type)) return true
    if (p.from === g.to && p.to === g.from) {
      if (SYMMETRIC.has(p.type) && types.has(p.type)) return true
      const inv = INVERSE[p.type]
      if (inv && types.has(inv)) return true
    }
    return false
  }
  const dateMatches = (p: OfflineExtractionResult['dates'][number], person: string, g: GoldFile['dates'][number]) =>
    g.person === person && normKey(p.kind) === normKey(g.kind) && p.calendar === g.calendar && (g.month === undefined || p.month === g.month) && (g.day === undefined || p.day === g.day)

  matchDeterministic('handles', gold.handles, (i, g) => g.person === items.handles[i].person && normKey(g.value) === normKey(pred.handles[i].value))
  for (const [i, m] of tp.handles) if (gold.handles.find((g) => g.id === m.goldId)!.kind !== pred.handles[i].kind) counts.kindMismatch++
  matchDeterministic('relations', gold.relations, (i, g) => !isPhantom(relEnds[i].to) && relMatches(relEnds[i], g))
  matchDeterministic('dates', gold.dates, (i, g) => dateMatches(pred.dates[i], items.dates[i].person, g))

  /** judge verdicts → one-to-one: pass 1 `same` by gold order, pass 2 `less_specific` */
  function assignJudged(type: TypeName, goldIds: string[], out: MatchOutput) {
    const takenPred = new Set<number>()
    const takenGold = new Set<string>()
    for (const verdict of ['same', 'less_specific'] as const) {
      for (const gid of goldIds) {
        if (takenGold.has(gid)) continue
        const cand = out.matches.filter((m) => m.gold === gid && m.verdict === verdict && !takenPred.has(m.pred)).sort((a, b) => a.pred - b.pred)[0]
        if (!cand) continue
        takenPred.add(cand.pred)
        takenGold.add(gid)
        tp[type].set(cand.pred, { goldId: gid, verdict })
      }
    }
  }
  const claimPersons = [...new Set(gold.claims.map((c) => c.person))]
  for (const key of claimPersons) {
    const goldList = gold.claims.filter((c) => c.person === key)
    const predList = items.claims.filter((c) => c.person === key)
    if (!predList.length) continue
    const out = await judge.matchClaims({
      person: { key, label: labelOf(key, key) },
      gold: goldList.map((g) => ({ id: g.id, statement: g.statement, category: g.category })),
      pred: predList.map((p) => ({ index: p.index, statement: p.text, category: pred.claims[p.index].category })),
    })
    assignJudged('claims', goldList.map((g) => g.id), out)
  }
  for (const [i, m] of tp.claims) {
    const g = gold.claims.find((c) => c.id === m.goldId)!
    if (![g.category, ...(g.acceptCategories ?? [])].includes(pred.claims[i].category)) counts.categoryMismatch++
  }
  const matchableEvents = items.events.filter((e) => duplicateOf(e) === null)
  if (gold.events.length && matchableEvents.length) {
    const out = await judge.matchClaims({
      person: { key: '__events__', label: '事件' },
      gold: gold.events.map((g) => ({ id: g.id, statement: g.summary, category: 'other' as const })),
      pred: matchableEvents.map((p) => ({ index: p.index, statement: p.text, category: 'other' as const })),
    })
    assignJudged('events', gold.events.map((g) => g.id), out)
  }

  // ---- loops (§7.3): same person key AND judge step A over `text`, one-to-one greedy. Same prompt and client as
  // claims; the person key is prefixed so a loop call can never collide with that person's claim call in the cache.
  const loopPersons = [...new Set(goldLoops.map((l) => l.person))]
  for (const key of loopPersons) {
    const goldList = goldLoops.filter((l) => l.person === key)
    const predList = items.loops.filter((l) => l.person === key)
    if (!predList.length) continue
    const out = await judge.matchClaims({
      person: { key: `loops:${key}`, label: `${labelOf(key, key)}·未结事项` },
      gold: goldList.map((g) => ({ id: g.id, statement: g.text, category: 'other' as const })),
      pred: predList.map((p) => ({ index: p.index, statement: predLoops[p.index].text, category: 'other' as const })),
    })
    assignJudged('loops', goldList.map((g) => g.id), out)
  }
  for (const [i, m] of tp.loops) {
    const g = goldLoops.find((l) => l.id === m.goldId)!
    const p = predLoops[i]
    if (g.kind !== p.kind || g.direction !== p.direction) {
      counts.interaction.loopKindMismatch++
      details.interaction.loopKindMismatch.push({ goldId: g.id, predIndex: i, gold: `${g.kind}/${g.direction}`, pred: `${p.kind}/${p.direction}` })
    }
  }

  // ---- loop closes. `loopCloseRecall` reads the loop's own resolved `closedIdx`, not the `closes[]` events: that
  // field is the state the app would store (`loops.closed_message_id`) after every window's closes were applied and
  // the invalid ones dropped, so the harness scores what a user would see. `closes[]` is the raw event list — it can
  // hold several closes for one loop — and is used only for the mechanical check below, which is about the event.
  if (loopsAnnotated) {
    const predByGold = new Map([...tp.loops].map(([i, m]) => [m.goldId, i]))
    for (const g of goldLoops) {
      if (g.closedBy === undefined || g.optional) continue
      counts.interaction.goldCloses++
      const i = predByGold.get(g.id)
      const predClosedByIdx = i === undefined ? null : predLoops[i].closedIdx ?? null
      const matched = predClosedByIdx === g.closedBy
      if (matched) counts.interaction.goldClosesMatched++
      details.interaction.closes.push({ goldId: g.id, closedBy: g.closedBy, predClosedByIdx, matched })
    }
  }
  counts.interaction.predictedCloses = predLoops.filter((l) => l.closedIdx !== null && l.closedIdx !== undefined).length

  // `loopFalseClose` counts ONLY mechanically impossible closes (DECISIONS I13, ARCHITECTURE §7.4): a close of a loop
  // that was never shown to that window, or closing evidence that is not strictly after the opening message.
  // `validateOutput` drops both (`unknown_close`), so a survivor here is a pipeline or harness bug — which is what
  // makes the 0 gate safe. Closing something gold leaves open is a MODEL mistake: it lowers loop precision instead.
  const predCloses = pred.closes ?? []
  const checkedLoops = new Set<number>()
  for (const c of predCloses) {
    const l = predLoops[c.loopIndex]
    checkedLoops.add(c.loopIndex)
    const first = c.evidence.length ? Math.min(...c.evidence) : null
    const reason = !l
      ? `closes[].loopIndex ${c.loopIndex} is not a loop of this run`
      : c.windowIndex < l.windowIndex
        ? `window ${c.windowIndex} closed a loop first produced in window ${l.windowIndex}: it was never shown to that window`
        : first === null
          ? 'close has no evidence'
          : first <= l.openedIdx
            ? `close evidence idx ${first} is not after the opening message idx ${l.openedIdx}`
            : null
    if (reason) {
      counts.interaction.falseCloses++
      details.interaction.falseCloses.push({ predIndex: c.loopIndex, closedIdx: first, reason })
    }
  }
  // a resolved close with no event behind it (older result shape) still has to sit after the opening message
  predLoops.forEach((l, i) => {
    if (l.closedIdx === null || l.closedIdx === undefined || checkedLoops.has(i)) return
    if (l.closedIdx <= l.openedIdx) {
      counts.interaction.falseCloses++
      details.interaction.falseCloses.push({ predIndex: i, closedIdx: l.closedIdx, reason: `closedIdx ${l.closedIdx} is not after the opening message idx ${l.openedIdx}` })
    }
  })

  // ---- conversations (§7.3): fully deterministic, no judge call
  const predSegments = pred.segments ?? []
  counts.interaction.segments = predSegments.length
  // The grouping runs on every run, annotated or not: `conversationsPredicted` is what `groupSegments` makes of the
  // run's own segments, and that number exists whether or not gold has conversations to match it against (I16).
  const grouped: PredConversation[] = groupRunSegments(predSegments, args.messages)
  counts.interaction.conversationsPredicted = grouped.length
  {
    const conv = matchConversations(conversationsAnnotated ? gold.conversations ?? [] : [], grouped)
    details.interaction.conversations = conv
    counts.interaction.conversationsGold = conversationsAnnotated ? (gold.conversations ?? []).filter((c) => !c.optional).length : 0
    counts.interaction.conversationsMatched = conv.matches.filter((m) => !m.optional).length
    for (const m of conv.matches) {
      const g = (gold.conversations ?? []).find((c) => c.id === m.goldId)!
      counts.interaction.topicCoverageSum += m.topicCoverage
      counts.interaction.topicCoverageN++
      counts.interaction.topicsGold += g.topics.length
      counts.interaction.topicsCovered += g.topics.length - m.missingTopics.length
    }
  }

  // ---- mechanical interaction checks: run over every predicted segment/loop, annotated or not (gate = 0, §7.4)
  for (const l of predLoops) {
    if (invalidEvidence(l.evidence, l.windowIndex)) counts.interaction.segmentInvalidEvidence++
    if (sensitiveHits(l.text, gold.sensitiveValues).length) counts.sensitiveInStatement++
  }
  for (const s of predSegments) {
    const spanBad = !Number.isInteger(s.startIdx) || !Number.isInteger(s.endIdx) || s.startIdx < 0 || s.endIdx < s.startIdx || s.endIdx >= n
    if (spanBad || invalidEvidence(s.evidence, s.windowIndex)) counts.interaction.segmentInvalidEvidence++
    if (sensitiveHits([s.summary, ...s.topics].join(' '), gold.sensitiveValues).length) counts.sensitiveInStatement++
  }

  // ---- whole-output checks (TPs included)
  for (const t of TYPES) {
    // loops and segments have their own counter (`segmentInvalidEvidence`), counted above
    if (t === 'loops') continue
    for (const it of items[t]) {
      if (invalidEvidence(it.evidence, it.windowIndex)) counts.invalidEvidencePost++
      if ((t === 'claims' || t === 'handles' || t === 'events') && it.sensitiveText && sensitiveHits(it.sensitiveText, gold.sensitiveValues).length) counts.sensitiveInStatement++
    }
  }

  // ---- false positives: deterministic labels, then judge
  const wrongPersonDet = (it: PredItem): boolean => {
    if (it.type === 'handles') return gold.handles.some((g) => normKey(g.value) === normKey(pred.handles[it.index].value) && g.person !== it.person)
    if (it.type === 'dates') return gold.dates.some((g) => g.person !== it.person && dateMatches(pred.dates[it.index], g.person, g))
    if (it.type === 'relations') {
      const p = relEnds[it.index]
      return gold.relations.some((g) => {
        const types = relTypes(g)
        const typeOk = types.has(p.type) || (INVERSE[p.type] !== undefined && types.has(INVERSE[p.type]))
        const shares = [p.from, p.to].some((k) => k !== UNKNOWN_PERSON && (k === g.from || k === g.to))
        return typeOk && shares && !relMatches(p, g)
      })
    }
    return false
  }
  const toJudge: (PredItem & { fpId: string })[] = []
  /** loop FPs go into their own batches, so the five round-1 types keep the exact batches (and judge-cache keys) they had before goldVersion 2 */
  const toJudgeLoops: (PredItem & { fpId: string })[] = []
  const fpRows: FpDetail[] = []
  for (const t of TYPES) {
    // A predicted loop is a false positive only against gold that says what the loops are. With no `loops` key the
    // zip is not scored for loops at all (no TP, no FP, no judge call); `predicted` above still reports every one.
    if (t === 'loops' && !loopsAnnotated) continue
    for (const it of items[t]) {
      if (tp[t].has(it.index)) continue
      const fpId = `${t}#${it.index}`
      const base = { type: t, fpId, predIndex: it.index, person: it.person, text: it.text, evidence: it.evidence, subLabel: null, goldId: null, negativeId: null }
      if (invalidEvidence(it.evidence, it.windowIndex)) fpRows.push({ ...base, label: 'invalid_evidence', reason: 'evidence index out of range or outside its window' })
      else if (it.sensitiveText && sensitiveHits(it.sensitiveText, gold.sensitiveValues).length) fpRows.push({ ...base, label: 'sensitive_leak', reason: `matched ${sensitiveHits(it.sensitiveText, gold.sensitiveValues).join(',')}` })
      else if (duplicateOf(it) !== null) fpRows.push({ ...base, label: 'wrong_person', reason: `duplicate person of sender ${duplicateOf(it)} (name matches its gold label/alias)` })
      else if (wrongPersonDet(it)) fpRows.push({ ...base, label: 'wrong_person', reason: 'same value exists in gold under another person' })
      else (t === 'loops' ? toJudgeLoops : toJudge).push({ ...it, fpId })
    }
  }
  const evidenceWindow = (ev: number[]) => {
    const valid = [...new Set(ev.filter((e) => Number.isInteger(e) && e >= 0 && e < n))]
    const dist = new Map<number, number>()
    for (const e of valid) for (let k = Math.max(0, e - 2); k <= Math.min(n - 1, e + 2); k++) dist.set(k, Math.min(dist.get(k) ?? 99, Math.abs(k - e)))
    const chosen = [...dist.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, 30).map(([k]) => k).sort((a, b) => a - b)
    return chosen.map((k) => ({ idx: k, sentAt: args.messages[k].sentAt, senderName: args.messages[k].senderName, body: args.messages[k].body, isEvidence: valid.includes(k) }))
  }
  const classifyBatches = async (list: (PredItem & { fpId: string })[]) => {
    for (let b = 0; b < list.length; b += 10) {
      const batch = list.slice(b, b + 10)
      const input: FpClassifyInput = {
        zip: args.zipLabel,
        persons: gold.persons.map((p) => ({ key: p.key, label: p.label, aliases: p.aliases ?? [] })),
        goldClaims: gold.claims.map((c) => ({ id: c.id, person: c.person, statement: c.statement })),
        negatives: gold.negatives.map((x) => ({ id: x.id, kind: x.kind, description: x.description, forbidden: x.forbidden ?? null })),
        items: batch.map((it) => ({ fpId: it.fpId, type: SINGULAR[it.type], person: it.person, text: it.text, evidenceWindow: evidenceWindow(it.evidence) })),
      }
      const out = await judge.classifyFps(input)
      for (const it of batch) {
        const l = out.labels.find((x) => x.fpId === it.fpId)!
        fpRows.push({ type: it.type, fpId: it.fpId, predIndex: it.index, person: it.person, text: it.text, evidence: it.evidence, label: l.label, subLabel: l.subLabel, goldId: l.goldId, negativeId: l.negativeId, reason: l.reason })
      }
    }
  }
  await classifyBatches(toJudge)
  await classifyBatches(toJudgeLoops)
  for (const row of fpRows) {
    counts.errors[row.type][row.label]++
    if (row.subLabel) counts.subLabels[row.subLabel]++
    if (row.type === 'claims' && row.label === 'should_ignore' && (row.subLabel === 'transactional' || row.subLabel === 'coordination')) counts.transactionalClaims++
  }
  details.fp = fpRows.sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || a.predIndex - b.predIndex)

  // ---- counts, TP/FN details
  for (const t of TYPES) {
    const c = counts.types[t]
    c.predicted = items[t].length
    c.scored = t === 'loops' && !loopsAnnotated ? 0 : items[t].length
    const matchedStrict = new Set<string>()
    const matchedLenient = new Set<string>()
    for (const [i, m] of tp[t]) {
      const g = goldText[t].get(m.goldId)!
      c.tpLenient++
      matchedLenient.add(m.goldId)
      if (m.verdict === 'same') {
        c.tpStrict++
        matchedStrict.add(m.goldId)
      }
      const overlap = g.evidence.some((e) => items[t][i].evidence.includes(e))
      if (overlap) counts.evidenceOverlapCount++
      details.tp.push({ type: t, predIndex: i, goldId: m.goldId, verdict: m.verdict, text: items[t][i].text, goldText: g.text, evidenceOverlap: overlap })
    }
    for (const [id, g] of goldText[t]) {
      if (g.optional) continue
      c.goldRequired++
      if (matchedStrict.has(id)) c.goldMatchedStrict++
      if (matchedLenient.has(id)) c.goldMatchedLenient++
      if (!matchedStrict.has(id)) details.fn.push({ type: t, goldId: id, text: g.text, lessSpecificMatch: matchedLenient.has(id) })
    }
  }
  details.tp.sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || a.predIndex - b.predIndex)

  // ---- windows
  for (const w of pred.windows) {
    counts.windows.total++
    counts.rawItemCount += w.rawItemCount
    counts.droppedInvalidEvidence += w.droppedInvalidEvidence
    counts.windows.attemptMs.push(...w.attemptMs)
    if (w.dedup === 'skipped_deadline') counts.windows.dedupSkipped++
    if (w.interaction === 'failed') counts.windows.interactionFailed++
    if (w.interaction === 'skipped_deadline') counts.windows.interactionSkipped++
    if (w.outcome !== 'done') {
      counts.windows.failed++
      const code = w.code ?? w.outcome
      counts.windows.failedCodes[code] = (counts.windows.failedCodes[code] ?? 0) + 1
    }
  }
  counts.unmatchedNewPersons = unmatched.size
  details.unmatchedNewPersons = [...unmatched]
  counts.duplicateSenderPersons = duplicates.size
  details.duplicatePersons = [...duplicates].map(([key, person]) => ({ key, person }))
  return { counts, details }
}
