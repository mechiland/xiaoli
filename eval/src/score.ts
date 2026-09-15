// Scoring of one ZIP: person mapping, matching (§7.3), FP classification, raw counts (§7.4).
import type { OfflineExtractionResult } from './entries'
import type { GoldFile } from './gold-schema'
import type { FpClassifyInput, FpSubLabel, JudgeClient, MatchOutput, Verdict } from './judge'
import { normKey, sensitiveHits } from './text'

export const TYPES = ['claims', 'relations', 'handles', 'dates', 'events'] as const
export type TypeName = (typeof TYPES)[number]
export const ERROR_CODES = ['factual_error', 'wrong_person', 'over_inference', 'should_ignore', 'sensitive_leak', 'invalid_evidence', 'other'] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
export const SUB_LABELS = ['transactional', 'coordination', 'invisible_content', 'not_about_person'] as const
export const UNKNOWN_PERSON = 'unknown'
const SINGULAR = { claims: 'claim', relations: 'relation', handles: 'handle', dates: 'date', events: 'event' } as const
const SYMMETRIC = new Set(['spouse', 'sibling', 'friend', 'colleague', 'classmate', 'relative'])
const INVERSE: Record<string, string> = { parent: 'child', child: 'parent' }

export interface ScoreMessage {
  idx: number
  senderName: string
  sentAt: string
  body: string
}

export interface TypeCounts {
  predicted: number
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
  kindMismatch: number
  categoryMismatch: number
  windows: { total: number; failed: number; dedupSkipped: number; attemptMs: number[]; failedCodes: Record<string, number> }
}

export interface TpDetail { type: TypeName; predIndex: number; goldId: string; verdict: Verdict; text: string; goldText: string; evidenceOverlap: boolean }
export interface FpDetail { type: TypeName; fpId: string; predIndex: number; person: string; text: string; evidence: number[]; label: ErrorCode; subLabel: FpSubLabel | null; goldId: string | null; negativeId: string | null; reason: string }
export interface FnDetail { type: TypeName; goldId: string; text: string; lessSpecificMatch: boolean }
export interface ZipDetails { tp: TpDetail[]; fp: FpDetail[]; fn: FnDetail[]; unmatchedNewPersons: string[] }
export interface ZipScore { counts: ZipCounts; details: ZipDetails }

const zeroErrors = (): Record<ErrorCode, number> => Object.fromEntries(ERROR_CODES.map((c) => [c, 0])) as Record<ErrorCode, number>
const zeroType = (): TypeCounts => ({ predicted: 0, tpStrict: 0, tpLenient: 0, goldRequired: 0, goldMatchedStrict: 0, goldMatchedLenient: 0 })

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
    kindMismatch: 0,
    categoryMismatch: 0,
    windows: { total: 0, failed: 0, dedupSkipped: 0, attemptMs: [], failedCodes: {} },
  }
}

/** Micro-average building block: sums every counter. */
export function addCounts(a: ZipCounts, b: ZipCounts): ZipCounts {
  const r = emptyCounts()
  const scalar = ['messages', 'transactionalClaims', 'sensitiveInStatement', 'invalidEvidencePost', 'droppedInvalidEvidence', 'rawItemCount', 'evidenceOverlapCount', 'unmatchedNewPersons', 'kindMismatch', 'categoryMismatch'] as const
  for (const k of scalar) r[k] = a[k] + b[k]
  for (const t of TYPES) {
    for (const k of Object.keys(r.types[t]) as (keyof TypeCounts)[]) r.types[t][k] = a.types[t][k] + b.types[t][k]
    for (const e of ERROR_CODES) r.errors[t][e] = a.errors[t][e] + b.errors[t][e]
  }
  for (const s of SUB_LABELS) r.subLabels[s] = a.subLabels[s] + b.subLabels[s]
  r.windows = {
    total: a.windows.total + b.windows.total,
    failed: a.windows.failed + b.windows.failed,
    dedupSkipped: a.windows.dedupSkipped + b.windows.dedupSkipped,
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
  const details: ZipDetails = { tp: [], fp: [], fn: [], unmatchedNewPersons: [] }

  // ---- persons
  const goldKeys = new Set(gold.persons.map((p) => p.key))
  for (const s of gold.mapping.senders) if (s.person) goldKeys.add(s.person)
  const labelToKey = new Map<string, string>()
  for (const p of gold.persons) for (const name of [p.label, ...(p.aliases ?? [])]) if (!labelToKey.has(normKey(name))) labelToKey.set(normKey(name), p.key)
  const predLabels = new Map(pred.persons.map((p) => [p.key, p.label]))
  const unmatched = new Set<string>()
  const mapPerson = (key: string): string => {
    if (goldKeys.has(key)) return key
    const label = predLabels.get(key) ?? (key.startsWith('new:') ? key.slice(4) : null)
    const hit = label === null ? undefined : labelToKey.get(normKey(label))
    if (hit) return hit
    if (key.startsWith('new:') || predLabels.has(key)) unmatched.add(key)
    return UNKNOWN_PERSON
  }
  for (const p of pred.persons) mapPerson(p.key)
  const labelOf = (mapped: string, raw: string) => (mapped === UNKNOWN_PERSON ? predLabels.get(raw) ?? raw : gold.persons.find((p) => p.key === mapped)?.label ?? mapped)

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
  }
  const relEnds = pred.relations.map((r) => ({ from: mapPerson(r.from), to: mapPerson(r.to), type: r.type }))

  // ---- matching: predIndex → match, per type
  const tp: Record<TypeName, Map<number, { goldId: string; verdict: Verdict }>> = { claims: new Map(), relations: new Map(), handles: new Map(), dates: new Map(), events: new Map() }
  const goldText: Record<TypeName, Map<string, { text: string; evidence: number[]; optional: boolean }>> = {
    claims: new Map(gold.claims.map((g) => [g.id, { text: g.statement, evidence: g.evidence, optional: !!g.optional }])),
    handles: new Map(gold.handles.map((g) => [g.id, { text: `${g.kind}:${g.value}`, evidence: g.evidence, optional: !!g.optional }])),
    relations: new Map(gold.relations.map((g) => [g.id, { text: `${g.from} —${g.type}${g.label ? `/${g.label}` : ''}→ ${g.to}`, evidence: g.evidence, optional: !!g.optional }])),
    dates: new Map(gold.dates.map((g) => [g.id, { text: `${g.kind} ${g.month ?? '?'}-${g.day ?? '?'} ${g.calendar}`, evidence: g.evidence, optional: !!g.optional }])),
    events: new Map(gold.events.map((g) => [g.id, { text: g.summary, evidence: g.evidence, optional: !!g.optional }])),
  }

  /** deterministic one-to-one: predictions in order, required gold preferred over optional */
  function matchDeterministic<G extends { id: string; optional?: boolean }>(type: TypeName, goldList: G[], ok: (predIndex: number, g: G) => boolean) {
    const used = new Set<string>()
    const ordered = [...goldList.filter((g) => !g.optional), ...goldList.filter((g) => g.optional)]
    for (const it of items[type]) {
      if (it.person === UNKNOWN_PERSON) continue
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
  matchDeterministic('relations', gold.relations, (i, g) => relEnds[i].to !== UNKNOWN_PERSON && relMatches(relEnds[i], g))
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
  if (gold.events.length && items.events.length) {
    const out = await judge.matchClaims({
      person: { key: '__events__', label: '事件' },
      gold: gold.events.map((g) => ({ id: g.id, statement: g.summary, category: 'other' as const })),
      pred: items.events.map((p) => ({ index: p.index, statement: p.text, category: 'other' as const })),
    })
    assignJudged('events', gold.events.map((g) => g.id), out)
  }

  // ---- whole-output checks (TPs included)
  for (const t of TYPES) {
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
  const fpRows: FpDetail[] = []
  for (const t of TYPES) {
    for (const it of items[t]) {
      if (tp[t].has(it.index)) continue
      const fpId = `${t}#${it.index}`
      const base = { type: t, fpId, predIndex: it.index, person: it.person, text: it.text, evidence: it.evidence, subLabel: null, goldId: null, negativeId: null }
      if (invalidEvidence(it.evidence, it.windowIndex)) fpRows.push({ ...base, label: 'invalid_evidence', reason: 'evidence index out of range or outside its window' })
      else if (it.sensitiveText && sensitiveHits(it.sensitiveText, gold.sensitiveValues).length) fpRows.push({ ...base, label: 'sensitive_leak', reason: `matched ${sensitiveHits(it.sensitiveText, gold.sensitiveValues).join(',')}` })
      else if (wrongPersonDet(it)) fpRows.push({ ...base, label: 'wrong_person', reason: 'same value exists in gold under another person' })
      else toJudge.push({ ...it, fpId })
    }
  }
  const evidenceWindow = (ev: number[]) => {
    const valid = [...new Set(ev.filter((e) => Number.isInteger(e) && e >= 0 && e < n))]
    const dist = new Map<number, number>()
    for (const e of valid) for (let k = Math.max(0, e - 2); k <= Math.min(n - 1, e + 2); k++) dist.set(k, Math.min(dist.get(k) ?? 99, Math.abs(k - e)))
    const chosen = [...dist.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, 30).map(([k]) => k).sort((a, b) => a - b)
    return chosen.map((k) => ({ idx: k, sentAt: args.messages[k].sentAt, senderName: args.messages[k].senderName, body: args.messages[k].body, isEvidence: valid.includes(k) }))
  }
  for (let b = 0; b < toJudge.length; b += 10) {
    const batch = toJudge.slice(b, b + 10)
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
    if (w.outcome !== 'done') {
      counts.windows.failed++
      const code = w.code ?? w.outcome
      counts.windows.failedCodes[code] = (counts.windows.failedCodes[code] ?? 0) + 1
    }
  }
  counts.unmatchedNewPersons = unmatched.size
  details.unmatchedNewPersons = [...unmatched]
  return { counts, details }
}
