// Ratios from raw counts and the PLAN §4 gates (ARCHITECTURE §7.4).
import type { Source } from './paths'
import { ERROR_CODES, TYPES, type ErrorCode, type InteractionCounts, type TypeCounts, type TypeName, type ZipCounts } from './score'
import type { FpSubLabel } from './judge'

export interface TypeStat extends TypeCounts {
  fp: number
  fn: number
  precisionStrict: number | null
  precisionLenient: number | null
  recallStrict: number | null
  recallLenient: number | null
  yieldPer100: number | null
}
export type TypeMetrics = Record<TypeName, TypeStat> & {
  messages: number
  yieldPer100Total: number | null
  transactionalAsClaimRatio: number | null
  transactionalClaims: number
  sensitiveInStatement: number
  invalidEvidencePost: number
  invalidEvidencePreRate: number | null
  droppedInvalidEvidence: number
  rawItemCount: number
  evidenceOverlap: number | null
  unmatchedNewPersons: number
  duplicateSenderPersons: number
  kindMismatch: number
  categoryMismatch: number
  errors: Record<TypeName, Record<ErrorCode, number>>
  subLabels: Record<FpSubLabel, number>
  /** interaction layer (ARCHITECTURE §7.4). Every ratio is null when no zip of this source annotated that type. */
  interaction: InteractionMetrics
}

export interface InteractionMetrics extends InteractionCounts {
  /** gold loops with `closedBy` that the run closed at that idx / gold loops with `closedBy` — reported, not gated */
  loopCloseRecall: number | null
  /** predicted closes on a matched loop that gold does not say was ever closed — gated = 0 */
  loopFalseClose: number
  /** matched gold conversations / non-optional gold conversations — reported, warning below 0.8 */
  conversationCoverage: number | null
  /** mean topic coverage over matched conversations */
  topicCoverage: number | null
  /** segments + loops with evidence out of range or outside their window — gated = 0 */
  segmentInvalidEvidence: number
  /** matched loop pairs whose kind/direction differs — reported, never counted as a miss */
  loopKindMismatch: number
}

const round = (x: number) => Math.round(x * 10_000) / 10_000
const ratio = (a: number, b: number): number | null => (b === 0 ? null : round(a / b))

export function metricsFromCounts(c: ZipCounts): TypeMetrics {
  const types = {} as Record<TypeName, TypeStat>
  let predictedTotal = 0
  let tpTotal = 0
  for (const t of TYPES) {
    const x = c.types[t]
    predictedTotal += x.predicted
    tpTotal += x.tpLenient
    // `predicted` is what the run produced; `scored` is what gold could be matched against. They differ only for
    // loops on gold that has no `loops` key, and there every ratio must be null — reporting 0/12 would say "the
    // model got every loop wrong", which is as false as the `predicted = 0` it replaces (DECISIONS I16).
    types[t] = {
      ...x,
      fp: x.scored - x.tpLenient,
      fn: x.goldRequired - x.goldMatchedLenient,
      precisionStrict: ratio(x.tpStrict, x.scored),
      precisionLenient: ratio(x.tpLenient, x.scored),
      recallStrict: ratio(x.goldMatchedStrict, x.goldRequired),
      recallLenient: ratio(x.goldMatchedLenient, x.goldRequired),
      yieldPer100: c.messages ? round((100 * x.predicted) / c.messages) : null,
    }
  }
  return {
    ...types,
    messages: c.messages,
    yieldPer100Total: c.messages ? round((100 * predictedTotal) / c.messages) : null,
    transactionalAsClaimRatio: ratio(c.transactionalClaims, c.types.claims.predicted),
    transactionalClaims: c.transactionalClaims,
    sensitiveInStatement: c.sensitiveInStatement,
    invalidEvidencePost: c.invalidEvidencePost,
    invalidEvidencePreRate: ratio(c.droppedInvalidEvidence, c.rawItemCount),
    droppedInvalidEvidence: c.droppedInvalidEvidence,
    rawItemCount: c.rawItemCount,
    evidenceOverlap: ratio(c.evidenceOverlapCount, tpTotal),
    unmatchedNewPersons: c.unmatchedNewPersons,
    duplicateSenderPersons: c.duplicateSenderPersons,
    kindMismatch: c.kindMismatch,
    categoryMismatch: c.categoryMismatch,
    errors: JSON.parse(JSON.stringify(c.errors)),
    subLabels: { ...c.subLabels },
    interaction: interactionMetrics(c.interaction),
  }
}

export function interactionMetrics(i: InteractionCounts): InteractionMetrics {
  return {
    ...i,
    loopCloseRecall: ratio(i.goldClosesMatched, i.goldCloses),
    loopFalseClose: i.falseCloses,
    conversationCoverage: ratio(i.conversationsMatched, i.conversationsGold),
    topicCoverage: i.topicCoverageN ? round(i.topicCoverageSum / i.topicCoverageN) : null,
    segmentInvalidEvidence: i.segmentInvalidEvidence,
    loopKindMismatch: i.loopKindMismatch,
  }
}

/** Nearest-rank 95th percentile. */
export function p95(samples: number[]): number | null {
  if (!samples.length) return null
  const s = [...samples].sort((a, b) => a - b)
  return s[Math.ceil(0.95 * s.length) - 1]
}

export const THRESHOLDS = {
  claimsPrecisionLenient: 0.85,
  claimsRecallStrict: 0.7,
  handlesPrecision: 0.9,
  relationsPrecision: 0.9,
  sensitiveInStatement: 0,
  invalidEvidencePost: 0,
  transactionalAsClaimRatio: 0.05,
  p95WindowMs: 30_000,
  /**
   * Interaction (§7.4). A wrong "you promised X" is worse than a missed one, so precision is gated and loop
   * **recall is reported, not gated** in this first round: there is no baseline for a brand-new capability
   * (DECISIONS eval-synthetic E21). Raise both once two eval runs exist.
   */
  loopsPrecisionLenient: 0.8,
  loopFalseClose: 0,
  segmentInvalidEvidence: 0,
} as const
export const INVALID_EVIDENCE_PRE_WARN = 0.05
/** conversationCoverage below this is a warning, not a gate. */
export const CONVERSATION_COVERAGE_WARN = 0.8

export interface Gate {
  name: string
  source: Source
  value: number | null
  threshold: number
  op: '>=' | '<=' | '=='
  passed: boolean
  /** not part of `passed` (p95 in replay reports) */
  informational?: boolean
  note?: string
}

export interface SourceGateInput {
  source: Source
  /** false when the run did not include this source */
  evaluated: boolean
  metrics: TypeMetrics | null
  zipsWithGold: number
  scoredZips: number
  /** zips that have gold but were not scored (gold_mismatch, invalid_gold, extract_error) */
  problemZips: number
  gold: { frozen: boolean; changeRecorded: boolean | null; lockAppendOnly: boolean | null }[]
  judgeFallback: boolean
  p95WindowMs: number | null
  /** true for record/live runs with deadlinePolicy 'app' */
  p95Enforced: boolean
}

export function sourceGates(i: SourceGateInput): Gate[] {
  const gates: Gate[] = []
  const add = (name: string, value: number | null, op: Gate['op'], threshold: number, opts: { nullPasses?: string; informational?: boolean; note?: string } = {}) => {
    let passed: boolean
    let note = opts.note
    if (!i.evaluated) {
      passed = false
      note = 'source not evaluated in this run'
    } else if (value === null) {
      passed = !!opts.nullPasses && i.metrics !== null
      note = note ?? (i.metrics === null ? 'no scored zips' : opts.nullPasses)
    } else passed = op === '>=' ? value >= threshold : op === '<=' ? value <= threshold : value === threshold
    gates.push({ name, source: i.source, value: i.evaluated ? value : null, threshold, op, passed, ...(opts.informational ? { informational: true } : {}), ...(note ? { note } : {}) })
  }
  const m = i.metrics
  const flag = (ok: boolean) => (i.gold.length ? (ok ? 1 : 0) : 0)
  add('claims.precisionLenient', m?.claims.precisionLenient ?? null, '>=', THRESHOLDS.claimsPrecisionLenient, { nullPasses: 'no predicted claims' })
  add('claims.recallStrict', m?.claims.recallStrict ?? null, '>=', THRESHOLDS.claimsRecallStrict, { nullPasses: 'no required gold claims' })
  add('handles.precisionLenient', m?.handles.precisionLenient ?? null, '>=', THRESHOLDS.handlesPrecision, { nullPasses: 'no predicted handles' })
  add('relations.precisionLenient', m?.relations.precisionLenient ?? null, '>=', THRESHOLDS.relationsPrecision, { nullPasses: 'no predicted relations' })
  add('sensitiveInStatement', m?.sensitiveInStatement ?? null, '==', THRESHOLDS.sensitiveInStatement)
  add('invalidEvidencePost', m?.invalidEvidencePost ?? null, '==', THRESHOLDS.invalidEvidencePost)
  add('transactionalAsClaimRatio', m?.transactionalAsClaimRatio ?? null, '<=', THRESHOLDS.transactionalAsClaimRatio, { nullPasses: 'no predicted claims' })
  // interaction (§7.4). Null = no zip of this source has gold loops / no predicted loops: the capability is not
  // being measured here, which passes. Loop recall is reported in the report, never gated in this round.
  add('loops.precisionLenient', m?.loops.precisionLenient ?? null, '>=', THRESHOLDS.loopsPrecisionLenient, {
    nullPasses: m && m.loops.predicted > 0 ? `${m.loops.predicted} loops predicted, none scored: no gold zip of this source annotates loops` : 'no predicted loops with gold loops to match',
  })
  add('loopFalseClose', m?.interaction.loopFalseClose ?? null, '==', THRESHOLDS.loopFalseClose)
  add('segmentInvalidEvidence', m?.interaction.segmentInvalidEvidence ?? null, '==', THRESHOLDS.segmentInvalidEvidence)
  add('zips.scored', i.scoredZips, '>=', 1, { note: `${i.scoredZips}/${i.zipsWithGold} zips with gold scored` })
  add('zips.unscoredWithGold', i.problemZips, '==', 0)
  add('gold.frozen', flag(i.gold.every((g) => g.frozen)), '==', 1)
  add('gold.changeRecorded', flag(i.gold.every((g) => g.changeRecorded !== false)), '==', 1)
  add('gold.lockAppendOnly', flag(i.gold.every((g) => g.lockAppendOnly !== false)), '==', 1)
  add('judge.noFallback', i.judgeFallback ? 0 : 1, '==', 1)
  add('p95WindowMs', i.p95WindowMs, '<=', THRESHOLDS.p95WindowMs, {
    informational: !i.p95Enforced,
    ...(i.p95Enforced ? {} : { nullPasses: 'informational in replay / deadlinePolicy none', note: 'informational in replay / deadlinePolicy none' }),
  })
  return gates
}

export function gatesPassed(gates: Gate[], source?: Source): boolean {
  return gates.filter((g) => !g.informational && (!source || g.source === source)).every((g) => g.passed)
}

export { ERROR_CODES }
