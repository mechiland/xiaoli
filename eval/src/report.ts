// EvalReport shape, anonymised combined report, per-source detail reports, prompt-version comparison (§7.5).
import { execFileSync } from 'node:child_process'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { GoldStatus } from './lock'
import { gatesPassed, type Gate, type TypeMetrics } from './metrics'
import type { EvalPaths, Source } from './paths'
import { TYPES, type ZipDetails } from './score'
import { USAGE_BUCKETS, zeroUsageByBucket, type UsageByBucket } from './usage'

export interface GoldReportEntry extends GoldStatus {
  source: Source
  zip: string
}
export type ZipStatus = 'scored' | 'gold_mismatch' | 'no_gold' | 'invalid_gold' | 'extract_error'
export interface ZipReport {
  zip: string
  source: Source
  status: ZipStatus
  messageCount: number | null
  windows: { total: number; failed: number; p95Ms: number | null; dedupSkipped: number; interactionFailed: number; interactionSkipped: number; failedCodes: Record<string, number> } | null
  metrics: TypeMetrics | null
  errors: TypeMetrics['errors'] | null
  problem?: string
  details?: ZipDetails
}
export type SourceMetrics = TypeMetrics & { zips: number }
export interface EvalUsage {
  /** extraction pipeline total as `extractOffline` reports it (extract + interaction + dedup calls) */
  inputTokens: number
  outputTokens: number
  calls: number
  /**
   * The same calls split by which model call made them, counted by the harness itself (`eval/src/usage.ts`).
   * DECISIONS I17 split the interaction layer into its own call precisely as a quality-for-cost trade, so a report
   * that could only print one combined total would hide the price that was paid for it.
   */
  byCall: UsageByBucket
  judgeInputTokens: number
  judgeOutputTokens: number
  judgeCalls: number
  judgeCacheHits: number
  judgeFallbacks: number
}
export interface EvalReport {
  reportVersion: 1
  runId: string
  createdAt: string
  promptVersion: string
  /**
   * The interaction call's prompt version (DECISIONS I17), as observed on the calls this run actually made; the
   * module constant when no interaction call was issued; null when the build has no interaction call at all.
   */
  interactionPromptVersion: string | null
  model: string
  mode: 'live' | 'record' | 'replay'
  deadlinePolicy: 'app' | 'none'
  parserVersion: string | null
  judgePromptVersions: { match: string; fp: string }
  judgeFallback: boolean
  aborted: string | null
  usage: EvalUsage
  gold: GoldReportEntry[]
  p95WindowMs: Record<Source, number | null>
  p95Valid: boolean
  sources: Record<Source, SourceMetrics | null>
  gates: Gate[]
  passed: boolean
  passedBySource: Record<Source, boolean>
  zips: ZipReport[]
  warnings: string[]
}

/** Real zips → `real-1..n` by sorted basename. */
export function realAliases(report: EvalReport): Map<string, string> {
  const names = [...new Set([...report.zips.filter((z) => z.source === 'real').map((z) => z.zip), ...report.gold.filter((g) => g.source === 'real').map((g) => g.zip)])].sort()
  return new Map(names.map((n, i) => [n, `real-${i + 1}`]))
}

/** Aggregate-only report: no per-item text, real zip names anonymised, real problem strings dropped. */
export function combinedReport(r: EvalReport): EvalReport {
  const alias = realAliases(r)
  const c: EvalReport = JSON.parse(JSON.stringify(r))
  c.zips = c.zips.map((z) => {
    const { details: _d, ...rest } = z
    if (z.source !== 'real') return rest
    const { problem: _p, ...noProblem } = rest
    return { ...noProblem, zip: alias.get(z.zip) ?? 'real-?' }
  })
  c.gold = c.gold.map((g) => (g.source === 'real' ? { ...g, zip: alias.get(g.zip) ?? 'real-?' } : g))
  for (const [name, a] of alias) c.warnings = c.warnings.map((w) => w.split(name).join(a))
  return c
}

/** Per-source report including details (real → gitignored path only). */
export function sourceDetailReport(r: EvalReport, source: Source): EvalReport {
  const c: EvalReport = JSON.parse(JSON.stringify(r))
  c.zips = c.zips.filter((z) => z.source === source)
  c.gold = c.gold.filter((g) => g.source === source)
  c.gates = c.gates.filter((g) => g.source === source)
  c.passed = gatesPassed(c.gates)
  return c
}

export function isGitIgnored(root: string, file: string): boolean | null {
  try {
    execFileSync('git', ['check-ignore', '-q', path.relative(root, file)], { cwd: root, stdio: 'ignore' })
    return true
  } catch (e) {
    const status = (e as { status?: number }).status
    return status === 1 ? false : null
  }
}

function writeJson(file: string, data: unknown) {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
  renameSync(tmp, file)
}

/** Writes combined + per-source detail reports. Refuses to write real detail unless git confirms the path is ignored. */
export function writeEvalReports(paths: EvalPaths, report: EvalReport, stamp: string, opts: { requireIgnoredReal?: boolean } = {}): string[] {
  const files: string[] = []
  const combined = path.join(paths.reportSummary, `${stamp}.json`)
  writeJson(combined, combinedReport(report))
  files.push(combined)
  for (const source of ['synthetic', 'real'] as const) {
    if (!report.zips.some((z) => z.source === source)) continue
    const file = path.join(paths.reportDetail[source], `${stamp}.json`)
    if (source === 'real' && (opts.requireIgnoredReal ?? true) && isGitIgnored(paths.root, file) !== true) {
      throw new Error('refusing to write real-data detail report: eval/reports/real/ is not confirmed gitignored')
    }
    writeJson(file, sourceDetailReport(report, source))
    files.push(file)
  }
  return files
}

// ---------------------------------------------------------------- compare
const SCALARS = ['transactionalAsClaimRatio', 'sensitiveInStatement', 'invalidEvidencePost', 'invalidEvidencePreRate', 'evidenceOverlap', 'yieldPer100Total'] as const
const PER_TYPE = ['precisionStrict', 'precisionLenient', 'recallStrict', 'recallLenient', 'yieldPer100', 'predicted', 'scored'] as const
/** interaction metrics carried side by side in `--compare` (ARCHITECTURE §7.4) */
const INTERACTION_SCALARS = [
  'loopCloseRecall', 'loopFalseClose', 'loopKindMismatch', 'conversationCoverage', 'topicCoverage', 'segmentInvalidEvidence',
  'segments', 'conversationsPredicted', 'predictedCloses',
] as const

export function flatMetrics(m: SourceMetrics | null): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const t of TYPES) for (const k of PER_TYPE) out[`${t}.${k}`] = m ? m[t][k] : null
  for (const k of SCALARS) out[k] = m ? m[k] : null
  for (const k of INTERACTION_SCALARS) out[`interaction.${k}`] = m ? m.interaction[k] : null
  return out
}

/**
 * Claims and interaction output side by side — **not** a routing story.
 *
 * The first version of this block told the reader that "claims n down + segments/loops up = the 分流 rule working".
 * The live extract.v9 run went the other way (claims n 50 → 55 *and* precision down, DECISIONS I15), and that
 * framing invited exactly the wrong conclusion about a regression. Since DECISIONS I17 there is no routing to
 * appeal to at all: extraction and interaction are two independent calls issued in parallel, and the extraction
 * call is not told the interaction layer exists. So a claims change between two runs is a claims change. The block
 * still prints the two groups together — the reader is comparing prompt versions and wants both — but it says
 * nothing about one explaining the other.
 */
export interface ClaimsVsInteraction {
  claimsPredicted: [number | null, number | null, number | null]
  claimsPrecisionLenient: [number | null, number | null, number | null]
  claimsRecallStrict: [number | null, number | null, number | null]
  claimsFn: [number | null, number | null, number | null]
  loopsPredicted: [number | null, number | null, number | null]
  segments: [number | null, number | null, number | null]
  conversations: [number | null, number | null, number | null]
  note: string
}
export const CLAIMS_VS_INTERACTION_NOTE =
  'claims 与交互层是两次独立的模型调用（DECISIONS I17）：抽取调用不知道交互层的存在，两者之间没有分流。所以 claims 的任何变化都只能当作 claims 本身的变化来读 —— segments/loops 上升不解释 claims 精确率下降，也不抵消它。claims 召回要和 claims.fn 一起读。（extract.v9 曾把三件事塞进一次调用，那次的账记在 I15。）'

export interface CompareReport {
  kind: 'compare'
  createdAt: string
  a: { runId: string; promptVersion: string; interactionPromptVersion: string | null; model: string; mode: string; passed: boolean }
  b: { runId: string; promptVersion: string; interactionPromptVersion: string | null; model: string; mode: string; passed: boolean }
  goldSha256: Record<string, string>
  sources: Record<Source, { a: Record<string, number | null>; b: Record<string, number | null>; delta: Record<string, number | null> }>
  /** claims and interaction output side by side, per source (see ClaimsVsInteraction) */
  claimsVsInteraction: Record<Source, ClaimsVsInteraction>
  gates: { name: string; source: Source; a: { value: number | null; passed: boolean } | null; b: { value: number | null; passed: boolean } | null }[]
  usage: { a: EvalUsage; b: EvalUsage; deltaByCall: UsageByBucket }
  /** conditions that make the two columns not directly comparable (interaction prompt version, mode, model) */
  warnings: string[]
}

export function compareReports(a: EvalReport, b: EvalReport, createdAt = new Date().toISOString()): CompareReport {
  const shas = (r: EvalReport): Record<string, string> =>
    Object.fromEntries(r.gold.map((g): [string, string] => [g.lockKey, g.goldSha256]).sort((x, y) => x[0].localeCompare(y[0])))
  const sa = shas(a)
  const sb = shas(b)
  if (JSON.stringify(sa) !== JSON.stringify(sb)) throw new Error('refusing to compare: the two runs used different gold files (goldSha256 differs)')
  // Interaction prompt version: the same guard as gold sha, one step softer. Two DIFFERENT interaction prompts on
  // top of two different extract prompts means two variables moved at once and no row of the table is readable —
  // that is refused. One side having no interaction call at all (null) is the split itself being measured
  // (DECISIONS I17), which is a legitimate comparison, so it is flagged loudly instead (see `warnings`).
  const warnings: string[] = []
  const ia = a.interactionPromptVersion ?? null
  const ib = b.interactionPromptVersion ?? null
  if (ia && ib && ia !== ib) {
    throw new Error(`refusing to compare: the two runs used different interaction prompt versions (${ia} vs ${ib}); two prompts moved at once, so no row of this table is attributable`)
  }
  if (ia !== ib) {
    warnings.push(`interaction prompt version differs: A ${ia ?? 'none (no interaction call)'} → B ${ib ?? 'none (no interaction call)'}; the interaction rows are not a like-for-like comparison`)
  }
  if (a.mode !== b.mode) warnings.push(`modes differ: A ${a.mode} → B ${b.mode}`)
  if (a.model !== b.model) warnings.push(`models differ: A ${a.model} → B ${b.model}`)
  const sources = {} as CompareReport['sources']
  const claimsVsInteraction = {} as CompareReport['claimsVsInteraction']
  for (const s of ['synthetic', 'real'] as const) {
    const fa = flatMetrics(a.sources[s])
    const fb = flatMetrics(b.sources[s])
    const delta: Record<string, number | null> = {}
    for (const k of Object.keys(fa)) delta[k] = fa[k] === null || fb[k] === null ? null : Math.round(((fb[k] as number) - (fa[k] as number)) * 10_000) / 10_000
    sources[s] = { a: fa, b: fb, delta }
    const row = (k: string): [number | null, number | null, number | null] => [fa[k], fb[k], delta[k]]
    const fn = (r: EvalReport): number | null => (r.sources[s] ? r.sources[s]!.claims.fn : null)
    claimsVsInteraction[s] = {
      claimsPredicted: row('claims.predicted'),
      claimsPrecisionLenient: row('claims.precisionLenient'),
      claimsRecallStrict: row('claims.recallStrict'),
      claimsFn: [fn(a), fn(b), fn(a) === null || fn(b) === null ? null : fn(b)! - fn(a)!],
      loopsPredicted: row('loops.predicted'),
      segments: row('interaction.segments'),
      conversations: row('interaction.conversationsPredicted'),
      note: CLAIMS_VS_INTERACTION_NOTE,
    }
  }
  const names = [...new Set([...a.gates, ...b.gates].map((g) => `${g.source}|${g.name}`))]
  return {
    kind: 'compare',
    createdAt,
    a: { runId: a.runId, promptVersion: a.promptVersion, interactionPromptVersion: ia, model: a.model, mode: a.mode, passed: a.passed },
    b: { runId: b.runId, promptVersion: b.promptVersion, interactionPromptVersion: ib, model: b.model, mode: b.mode, passed: b.passed },
    goldSha256: sa,
    sources,
    claimsVsInteraction,
    gates: names.map((key) => {
      const [source, name] = key.split('|') as [Source, string]
      const pick = (r: EvalReport) => {
        const g = r.gates.find((x) => x.source === source && x.name === name)
        return g ? { value: g.value, passed: g.passed } : null
      }
      return { name, source, a: pick(a), b: pick(b) }
    }),
    usage: { a: a.usage, b: b.usage, deltaByCall: deltaUsage(a.usage, b.usage) },
    warnings,
  }
}

/** B − A per call bucket, so the cost side of a prompt change is a number in the report, not an exercise. */
export function deltaUsage(a: EvalUsage, b: EvalUsage): UsageByBucket {
  const ba = a.byCall ?? zeroUsageByBucket()
  const bb = b.byCall ?? zeroUsageByBucket()
  const r = zeroUsageByBucket()
  for (const k of USAGE_BUCKETS) {
    r[k] = {
      inputTokens: bb[k].inputTokens - ba[k].inputTokens,
      outputTokens: bb[k].outputTokens - ba[k].outputTokens,
      calls: bb[k].calls - ba[k].calls,
      failedCalls: bb[k].failedCalls - ba[k].failedCalls,
    }
  }
  return r
}

export function writeCompare(paths: EvalPaths, cmp: CompareReport, stamp: string): string {
  const file = path.join(paths.reportCompare, `compare-${cmp.a.promptVersion}-vs-${cmp.b.promptVersion}-${stamp}.json`)
  writeJson(file, cmp)
  return file
}

const fmt = (x: number | null | undefined) => (x === null || x === undefined ? '  -  ' : x.toFixed(2))

/** `extract in … out … (n calls) · interaction … · dedup …` — the cost of the two-call split, side by side. */
export function usageLine(byCall: UsageByBucket | undefined, signed = false): string {
  const u = byCall ?? zeroUsageByBucket()
  const n = (x: number) => (signed && x > 0 ? `+${x}` : String(x))
  return USAGE_BUCKETS.filter((b) => u[b].calls !== 0 || u[b].inputTokens !== 0 || b === 'extract' || b === 'interaction')
    .map((b) => `${b} in ${n(u[b].inputTokens)} out ${n(u[b].outputTokens)} (${n(u[b].calls)} calls${u[b].failedCalls ? `, ${n(u[b].failedCalls)} failed` : ''})`)
    .join(' · ')
}

/** Numbers-only console summary (safe for real data). */
export function summaryLines(r: EvalReport): string[] {
  const lines: string[] = []
  lines.push(
    `run ${r.runId} · prompt ${r.promptVersion} · interaction ${r.interactionPromptVersion ?? 'none'} · model ${r.model} · mode ${r.mode} · deadline ${r.deadlinePolicy}${r.aborted ? ` · ABORTED ${r.aborted}` : ''}`,
  )
  for (const s of ['synthetic', 'real'] as const) {
    const m = r.sources[s]
    const zips = r.zips.filter((z) => z.source === s)
    if (!zips.length) continue
    const scored = zips.filter((z) => z.status === 'scored').length
    const bad = zips.filter((z) => z.status !== 'scored' && z.status !== 'no_gold').length
    lines.push(`[${s}] zips ${zips.length} · scored ${scored} · unscored-with-gold ${bad} · messages ${m?.messages ?? 0}`)
    if (m) {
      lines.push(`  claims    P ${fmt(m.claims.precisionLenient)} (strict ${fmt(m.claims.precisionStrict)})  R ${fmt(m.claims.recallStrict)} (lenient ${fmt(m.claims.recallLenient)})  n=${m.claims.predicted}  /100msg ${fmt(m.claims.yieldPer100)}`)
      for (const t of ['handles', 'relations', 'dates', 'events'] as const) lines.push(`  ${t.padEnd(9)} P ${fmt(m[t].precisionLenient)}  R ${fmt(m[t].recallStrict)}  n=${m[t].predicted}  /100msg ${fmt(m[t].yieldPer100)}`)
      lines.push(`  sensitiveInStatement ${m.sensitiveInStatement} · invalidEvidencePost ${m.invalidEvidencePost} · transactionalAsClaimRatio ${fmt(m.transactionalAsClaimRatio)} · invalidEvidencePreRate ${fmt(m.invalidEvidencePreRate)}`)
      const x = m.interaction
      // n is ALWAYS what the run produced. When no gold annotates loops the ratios are `-` (not 0) and the line
      // says so in words, so "12 loops, precision -" can never be read as "the model produced nothing" (I16).
      const loopScored = x.loopsAnnotated ? `scored ${m.loops.scored}` : `0 scored — no gold zip annotates loops, so P/R are not measurable (not 0)`
      lines.push(`  loops     P ${fmt(m.loops.precisionLenient)}  R ${fmt(m.loops.recallStrict)} (reported, not gated — new capability)  n=${m.loops.predicted} (${loopScored})  kindMismatch ${x.loopKindMismatch}  gold-annotated zips ${x.loopsAnnotated}`)
      lines.push(`  loopCloseRecall ${fmt(x.loopCloseRecall)} (${x.goldClosesMatched}/${x.goldCloses}) · loopFalseClose ${x.loopFalseClose} · predictedCloses ${x.predictedCloses}`)
      lines.push(`  segments ${x.segments} · conversations ${x.conversationsPredicted} pred (grouped from this run's own segments) / ${x.conversationsGold} gold · conversationCoverage ${fmt(x.conversationCoverage)} · topicCoverage ${fmt(x.topicCoverage)} · segmentInvalidEvidence ${x.segmentInvalidEvidence}`)
      const errs = TYPES.map((t) => `${t}:${Object.entries(m.errors[t]).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(',') || '0'}`).join(' ')
      lines.push(`  errors ${errs}`)
    }
  }
  lines.push(`tokens pipeline in ${r.usage.inputTokens} out ${r.usage.outputTokens} (${r.usage.calls} calls) · judge in ${r.usage.judgeInputTokens} out ${r.usage.judgeOutputTokens} (${r.usage.judgeCalls} calls, ${r.usage.judgeCacheHits} cached, ${r.usage.judgeFallbacks} fallback)`)
  lines.push(`  by call: ${usageLine(r.usage.byCall)}`)
  const failed = r.gates.filter((g) => !g.passed && !g.informational)
  lines.push(`gates: ${r.passed ? 'PASS' : 'FAIL'} (synthetic ${r.passedBySource.synthetic ? 'pass' : 'fail'}, real ${r.passedBySource.real ? 'pass' : 'fail'})`)
  for (const g of failed) lines.push(`  ✗ [${g.source}] ${g.name} = ${g.value ?? 'null'} (need ${g.op} ${g.threshold})${g.note ? ` — ${g.note}` : ''}`)
  return lines
}

/** Side-by-side console table for `--compare` (numbers only, safe for real data). */
export function compareLines(cmp: CompareReport): string[] {
  const lines: string[] = []
  lines.push(
    `compare ${cmp.a.promptVersion} (A) → ${cmp.b.promptVersion} (B) · interaction ${cmp.a.interactionPromptVersion ?? 'none'} → ${cmp.b.interactionPromptVersion ?? 'none'} · mode ${cmp.a.mode}/${cmp.b.mode} · gates A ${cmp.a.passed ? 'PASS' : 'FAIL'} → B ${cmp.b.passed ? 'PASS' : 'FAIL'}`,
  )
  for (const w of cmp.warnings) lines.push(`  ⚠ ${w}`)
  const num = (x: number | null | undefined, count = false) => (x === null || x === undefined ? '  -  ' : count ? String(x) : x.toFixed(2))
  const signed = (x: number | null | undefined, count = false) => (x === null || x === undefined ? '  -  ' : `${x > 0 ? '+' : ''}${count ? x : x.toFixed(2)}`)
  const rows: [string, string, boolean][] = [
    ['claims.precisionLenient', 'claims P (lenient)', false],
    ['claims.recallStrict', 'claims R (strict)', false],
    ['claims.predicted', 'claims n', true],
    ['loops.precisionLenient', 'loops P (lenient, gated ≥ 0.80)', false],
    ['loops.recallStrict', 'loops R (strict, REPORTED not gated)', false],
    ['loops.predicted', 'loops n', true],
    ['interaction.loopCloseRecall', 'loopCloseRecall (reported)', false],
    ['interaction.loopFalseClose', 'loopFalseClose (gated = 0)', true],
    ['interaction.segments', 'segments n', true],
    ['interaction.conversationCoverage', 'conversationCoverage (reported)', false],
    ['interaction.topicCoverage', 'topicCoverage (reported)', false],
    ['interaction.segmentInvalidEvidence', 'segmentInvalidEvidence (gated = 0)', true],
    ['handles.precisionLenient', 'handles P', false],
    ['relations.precisionLenient', 'relations P', false],
    ['transactionalAsClaimRatio', 'transactionalAsClaimRatio', false],
  ]
  for (const s of ['synthetic', 'real'] as const) {
    const c = cmp.sources[s]
    if (Object.values(c.a).every((v) => v === null) && Object.values(c.b).every((v) => v === null)) continue
    lines.push(`[${s}]  ${'metric'.padEnd(38)} ${'A'.padStart(6)} ${'B'.padStart(6)} ${'Δ'.padStart(7)}`)
    for (const [key, label, count] of rows) lines.push(`  ${label.padEnd(38)} ${num(c.a[key], count).padStart(6)} ${num(c.b[key], count).padStart(6)} ${signed(c.delta[key], count).padStart(7)}`)
    const t = cmp.claimsVsInteraction[s]
    lines.push(
      `  claims ↔ interaction (two independent calls): claims n ${num(t.claimsPredicted[0], true)} → ${num(t.claimsPredicted[1], true)} (Δ ${signed(t.claimsPredicted[2], true)}), claims FN ${num(t.claimsFn[0], true)} → ${num(t.claimsFn[1], true)}, loops n ${num(t.loopsPredicted[0], true)} → ${num(t.loopsPredicted[1], true)}, segments ${num(t.segments[0], true)} → ${num(t.segments[1], true)}, conversations ${num(t.conversations[0], true)} → ${num(t.conversations[1], true)}`,
    )
    lines.push(`  ${t.note}`)
  }
  lines.push(`  cost A: ${usageLine(cmp.usage.a.byCall)}`)
  lines.push(`  cost B: ${usageLine(cmp.usage.b.byCall)}`)
  lines.push(`  cost Δ: ${usageLine(cmp.usage.deltaByCall, true)}`)
  const flips = cmp.gates.filter((g) => g.a && g.b && g.a.passed !== g.b.passed)
  for (const g of flips) lines.push(`  gate ${g.a!.passed ? 'PASS→FAIL' : 'FAIL→PASS'} [${g.source}] ${g.name}: ${g.a!.value ?? 'null'} → ${g.b!.value ?? 'null'}`)
  return lines
}
