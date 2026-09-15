// EvalReport shape, anonymised combined report, per-source detail reports, prompt-version comparison (§7.5).
import { execFileSync } from 'node:child_process'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { GoldStatus } from './lock'
import { gatesPassed, type Gate, type TypeMetrics } from './metrics'
import type { EvalPaths, Source } from './paths'
import { TYPES, type ZipDetails } from './score'

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
  windows: { total: number; failed: number; p95Ms: number | null; dedupSkipped: number; failedCodes: Record<string, number> } | null
  metrics: TypeMetrics | null
  errors: TypeMetrics['errors'] | null
  problem?: string
  details?: ZipDetails
}
export type SourceMetrics = TypeMetrics & { zips: number }
export interface EvalUsage {
  inputTokens: number
  outputTokens: number
  calls: number
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
  const combined = path.join(paths.reports, `${stamp}.json`)
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
const PER_TYPE = ['precisionStrict', 'precisionLenient', 'recallStrict', 'recallLenient', 'yieldPer100', 'predicted'] as const

export function flatMetrics(m: SourceMetrics | null): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const t of TYPES) for (const k of PER_TYPE) out[`${t}.${k}`] = m ? m[t][k] : null
  for (const k of SCALARS) out[k] = m ? m[k] : null
  return out
}

export interface CompareReport {
  kind: 'compare'
  createdAt: string
  a: { runId: string; promptVersion: string; model: string; mode: string; passed: boolean }
  b: { runId: string; promptVersion: string; model: string; mode: string; passed: boolean }
  goldSha256: Record<string, string>
  sources: Record<Source, { a: Record<string, number | null>; b: Record<string, number | null>; delta: Record<string, number | null> }>
  gates: { name: string; source: Source; a: { value: number | null; passed: boolean } | null; b: { value: number | null; passed: boolean } | null }[]
  usage: { a: EvalUsage; b: EvalUsage }
}

export function compareReports(a: EvalReport, b: EvalReport, createdAt = new Date().toISOString()): CompareReport {
  const shas = (r: EvalReport): Record<string, string> =>
    Object.fromEntries(r.gold.map((g): [string, string] => [g.lockKey, g.goldSha256]).sort((x, y) => x[0].localeCompare(y[0])))
  const sa = shas(a)
  const sb = shas(b)
  if (JSON.stringify(sa) !== JSON.stringify(sb)) throw new Error('refusing to compare: the two runs used different gold files (goldSha256 differs)')
  const sources = {} as CompareReport['sources']
  for (const s of ['synthetic', 'real'] as const) {
    const fa = flatMetrics(a.sources[s])
    const fb = flatMetrics(b.sources[s])
    const delta: Record<string, number | null> = {}
    for (const k of Object.keys(fa)) delta[k] = fa[k] === null || fb[k] === null ? null : Math.round(((fb[k] as number) - (fa[k] as number)) * 10_000) / 10_000
    sources[s] = { a: fa, b: fb, delta }
  }
  const names = [...new Set([...a.gates, ...b.gates].map((g) => `${g.source}|${g.name}`))]
  return {
    kind: 'compare',
    createdAt,
    a: { runId: a.runId, promptVersion: a.promptVersion, model: a.model, mode: a.mode, passed: a.passed },
    b: { runId: b.runId, promptVersion: b.promptVersion, model: b.model, mode: b.mode, passed: b.passed },
    goldSha256: sa,
    sources,
    gates: names.map((key) => {
      const [source, name] = key.split('|') as [Source, string]
      const pick = (r: EvalReport) => {
        const g = r.gates.find((x) => x.source === source && x.name === name)
        return g ? { value: g.value, passed: g.passed } : null
      }
      return { name, source, a: pick(a), b: pick(b) }
    }),
    usage: { a: a.usage, b: b.usage },
  }
}

export function writeCompare(paths: EvalPaths, cmp: CompareReport, stamp: string): string {
  const file = path.join(paths.reports, `compare-${cmp.a.promptVersion}-vs-${cmp.b.promptVersion}-${stamp}.json`)
  writeJson(file, cmp)
  return file
}

const fmt = (x: number | null | undefined) => (x === null || x === undefined ? '  -  ' : x.toFixed(2))

/** Numbers-only console summary (safe for real data). */
export function summaryLines(r: EvalReport): string[] {
  const lines: string[] = []
  lines.push(`run ${r.runId} · prompt ${r.promptVersion} · model ${r.model} · mode ${r.mode} · deadline ${r.deadlinePolicy}${r.aborted ? ` · ABORTED ${r.aborted}` : ''}`)
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
      const errs = TYPES.map((t) => `${t}:${Object.entries(m.errors[t]).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(',') || '0'}`).join(' ')
      lines.push(`  errors ${errs}`)
    }
  }
  lines.push(`tokens extract in ${r.usage.inputTokens} out ${r.usage.outputTokens} (${r.usage.calls} calls) · judge in ${r.usage.judgeInputTokens} out ${r.usage.judgeOutputTokens} (${r.usage.judgeCalls} calls, ${r.usage.judgeCacheHits} cached, ${r.usage.judgeFallbacks} fallback)`)
  const failed = r.gates.filter((g) => !g.passed && !g.informational)
  lines.push(`gates: ${r.passed ? 'PASS' : 'FAIL'} (synthetic ${r.passedBySource.synthetic ? 'pass' : 'fail'}, real ${r.passedBySource.real ? 'pass' : 'fail'})`)
  for (const g of failed) lines.push(`  ✗ [${g.source}] ${g.name} = ${g.value ?? 'null'} (need ${g.op} ${g.threshold})${g.note ? ` — ${g.note}` : ''}`)
  return lines
}
