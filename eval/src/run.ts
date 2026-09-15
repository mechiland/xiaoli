// `pnpm eval` orchestration (ARCHITECTURE §7.5). All I/O dependencies are injectable for unit tests.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ExtractModel } from '@/contracts'
import type { ExtractApi, LlmApi, LlmClient, LlmMode, Loaded, OfflineExtractionResult, ParserApi } from './entries'
import { parseGold, type GoldFile, type GoldLock } from './gold-schema'
import { JudgeCache, llmJudge, type JudgeClient } from './judge'
import { goldStatus, lockKeyFor, readLock, sha256Hex } from './lock'
import { gatesPassed, INVALID_EVIDENCE_PRE_WARN, metricsFromCounts, p95, sourceGates, type Gate } from './metrics'
import { fileTimestamp, goldPathFor, SOURCES, zipBase, type EvalPaths, type Source } from './paths'
import { combinedReport, compareReports, summaryLines, writeCompare, writeEvalReports, type EvalReport, type GoldReportEntry, type SourceMetrics, type ZipReport } from './report'
import { addCounts, emptyCounts, scoreZip, type ZipCounts } from './score'

export const PERF_ZIP = 'perf-5000.zip'
/**
 * Synthetic ZIPs that are never annotated: perf and the re-export dedup pair (DECISIONS eval-synthetic E19). They are
 * listed as no_gold without a warning. `eval/tests/reexport-synthetic.test.ts` keeps this in sync with the generator.
 */
export const NOT_ANNOTATED_ZIPS: ReadonlySet<string> = new Set([PERF_ZIP, '聊天记录_20260611_213407.zip', '聊天记录_20260915_081926.zip'])

export interface RunOptions {
  source: Source | 'all'
  zip?: string
  mode: LlmMode
  model: ExtractModel
  promptVersion?: string
  compare?: string
  runId?: string
  deadlinePolicy: 'app' | 'none'
  write: boolean
}

export type JudgeWithVersions = JudgeClient & { versions: { match: string; fp: string } }
export interface RunDeps {
  paths: EvalPaths
  loadParser: () => Promise<Loaded<ParserApi>>
  loadExtract: () => Promise<Loaded<ExtractApi>>
  loadLlm: () => Promise<Loaded<LlmApi>>
  /** env handed to createLlmClient (process.env + .env.local); never logged */
  llmEnv: Record<string, unknown>
  baseline: GoldLock | null
  readDecisions: () => string
  now: () => Date
  log: (line: string) => void
  /** test hooks */
  makeLlm?: (source: Source, mode: LlmMode, runId: string, api: LlmApi | null) => Promise<{ extract: LlmClient; judge: LlmClient | null }>
  makeJudge?: (source: Source, mode: LlmMode, llm: LlmClient | null, runId: string) => JudgeWithVersions
}

export interface RunResult {
  exitCode: number
  message: string
  report: EvalReport | null
  files: string[]
}

export interface ZipPlan {
  source: Source
  file: string
  zipPath: string
  goldPath: string
  gold: GoldFile | null
  goldBytes: Uint8Array | null
  goldIssues: string[] | null
}

export function discoverZips(paths: EvalPaths, opts: Pick<RunOptions, 'source' | 'zip'>): ZipPlan[] {
  const sources = opts.source === 'all' ? SOURCES : [opts.source]
  const plans: ZipPlan[] = []
  for (const source of sources) {
    const dir = paths.fixtures[source]
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.zip')).sort()) {
      if (opts.zip && zipBase(opts.zip) !== zipBase(file)) continue
      const goldPath = goldPathFor(paths, source, file)
      let gold: GoldFile | null = null
      let goldBytes: Uint8Array | null = null
      let goldIssues: string[] | null = null
      if (existsSync(goldPath)) {
        goldBytes = new Uint8Array(readFileSync(goldPath))
        try {
          const parsed = parseGold(JSON.parse(Buffer.from(goldBytes).toString('utf8')))
          if (parsed.ok) gold = parsed.gold
          else goldIssues = parsed.issues
        } catch (e) {
          goldIssues = [`invalid JSON: ${(e as Error).message}`]
        }
      }
      plans.push({ source, file, zipPath: path.join(dir, file), goldPath, gold, goldBytes, goldIssues })
    }
  }
  return plans
}

const zeroUsage = () => ({ inputTokens: 0, outputTokens: 0, calls: 0, judgeInputTokens: 0, judgeOutputTokens: 0, judgeCalls: 0, judgeCacheHits: 0, judgeFallbacks: 0 })

async function defaultMakeLlm(paths: EvalPaths, env: Record<string, unknown>, source: Source, mode: LlmMode, runId: string, api: LlmApi | null) {
  if (!api) throw new Error('llm module unavailable')
  const logger = api.jsonlCallLogger(path.join(paths.runs, runId, 'llm-calls.jsonl'))
  const budget = mode === 'replay' ? null : await api.fileBudget()
  const extract = api.createLlmClient({ env, logger, mode, cassetteDir: paths.cassettes[source], budget })
  const judge = mode === 'replay' ? null : api.createLlmClient({ env, logger, mode: 'live', budget })
  return { extract, judge }
}

export async function runOnce(opts: RunOptions & { promptVersion: string }, deps: RunDeps, plans: ZipPlan[], parser: ParserApi, extract: ExtractApi, llmApi: LlmApi | null): Promise<EvalReport> {
  const { paths } = deps
  const runId = opts.runId ? `${opts.runId}-${opts.promptVersion}` : `${fileTimestamp(deps.now())}-${opts.promptVersion}`
  const lock = readLock(paths.lock)
  const decisions = deps.readDecisions()
  const zips: ZipReport[] = []
  const goldEntries: GoldReportEntry[] = []
  const counts: Record<Source, ZipCounts | null> = { synthetic: null, real: null }
  const judgeFallbackBySource: Record<Source, boolean> = { synthetic: false, real: false }
  const warnings: string[] = []
  const usage = zeroUsage()
  let aborted: string | null = null
  let judgeVersions = { match: 'judge-match.v1', fp: 'judge-fp.v1' }
  const requested = opts.source === 'all' ? SOURCES : [opts.source]

  for (const source of requested) {
    const srcPlans = plans.filter((p) => p.source === source)
    if (!srcPlans.length || aborted) continue
    const needsRun = srcPlans.some((p) => p.gold)
    let clients: { extract: LlmClient; judge: LlmClient | null } | null = null
    let judge: JudgeWithVersions | null = null
    if (needsRun) {
      clients = deps.makeLlm ? await deps.makeLlm(source, opts.mode, runId, llmApi) : await defaultMakeLlm(paths, deps.llmEnv, source, opts.mode, runId, llmApi)
      judge = deps.makeJudge
        ? deps.makeJudge(source, opts.mode, clients.judge, runId)
        : llmJudge({ llm: clients.judge, cache: new JudgeCache(paths.judgeCache[source]), mode: opts.mode, promptsDir: paths.judgePrompts, evalRunId: runId })
      judgeVersions = judge.versions
    }
    for (const plan of srcPlans) {
      if (aborted) break
      const label = source === 'real' ? 'a real zip' : plan.file
      const base: ZipReport = { zip: plan.file, source, status: 'no_gold', messageCount: null, windows: null, metrics: null, errors: null }
      if (!plan.gold && !plan.goldIssues) {
        if (!NOT_ANNOTATED_ZIPS.has(plan.file)) warnings.push(`no gold for ${plan.file}; skipped`)
        zips.push(base)
        continue
      }
      const bytes = new Uint8Array(readFileSync(plan.zipPath))
      if (!plan.gold) {
        zips.push({ ...base, status: 'invalid_gold', problem: plan.goldIssues!.slice(0, 5).join('; ') })
        warnings.push(`gold for ${plan.file} failed schema validation`)
        continue
      }
      const gold = plan.gold
      const lockKey = lockKeyFor(source, plan.file, sha256Hex(bytes))
      goldEntries.push({ source, zip: plan.file, ...goldStatus({ lock, baseline: deps.baseline, decisions, lockKey, goldSha256: sha256Hex(plan.goldBytes!) }) })

      let parsed
      try {
        parsed = await parser.parseExportZip(bytes, { fileName: plan.file })
      } catch (e) {
        zips.push({ ...base, status: 'extract_error', problem: `parseExportZip failed: ${(e as { code?: string }).code ?? (e as Error).message}` })
        continue
      }
      const digest = await parser.messagesDigest(parsed.messages)
      if (digest !== gold.messagesSha256 || parsed.messages.length !== gold.messageCount) {
        const anchor = gold.anchors.find((a) => parsed.messages[a.idx]?.fingerprint !== a.fingerprint)
        zips.push({ ...base, status: 'gold_mismatch', messageCount: parsed.messages.length, problem: `gold messageCount ${gold.messageCount}, parsed ${parsed.messages.length}; first differing anchor idx ${anchor?.idx ?? 'none'}` })
        warnings.push(`gold drift for ${label}: not scored (re-annotation needed)`)
        continue
      }
      if (gold.parserVersion !== parser.PARSER_VERSION) warnings.push(`gold for ${label} was annotated with parser ${gold.parserVersion}, now ${parser.PARSER_VERSION} (digest unchanged)`)

      let result: OfflineExtractionResult
      try {
        result = await extract.extractOffline({ parsed, mapping: gold.mapping, llm: clients!.extract, model: opts.model, promptVersion: opts.promptVersion, deadlinePolicy: opts.deadlinePolicy })
      } catch (e) {
        zips.push({ ...base, status: 'extract_error', messageCount: parsed.messages.length, problem: `extractOffline threw: ${(e as Error).message.split('\n')[0].slice(0, 200)}` })
        continue
      }
      usage.inputTokens += result.usage.inputTokens
      usage.outputTokens += result.usage.outputTokens
      usage.calls += result.usage.calls
      if (result.windows.some((w) => w.code === 'budget_exceeded')) aborted = 'budget_exceeded'

      const score = await scoreZip({ zipLabel: source === 'real' ? lockKey : plan.file, messages: parsed.messages, gold, pred: result, judge: judge! })
      counts[source] = counts[source] ? addCounts(counts[source]!, score.counts) : addCounts(emptyCounts(), score.counts)
      const metrics = metricsFromCounts(score.counts)
      if (metrics.invalidEvidencePreRate !== null && metrics.invalidEvidencePreRate > INVALID_EVIDENCE_PRE_WARN) warnings.push(`invalidEvidencePreRate ${metrics.invalidEvidencePreRate} > ${INVALID_EVIDENCE_PRE_WARN} for ${label}`)
      zips.push({
        ...base,
        status: 'scored',
        messageCount: parsed.messages.length,
        windows: { total: score.counts.windows.total, failed: score.counts.windows.failed, p95Ms: p95(score.counts.windows.attemptMs), dedupSkipped: score.counts.windows.dedupSkipped, failedCodes: score.counts.windows.failedCodes },
        metrics,
        errors: metrics.errors,
        details: score.details,
      })
    }
    if (judge) {
      const st = judge.stats()
      usage.judgeInputTokens += st.inputTokens
      usage.judgeOutputTokens += st.outputTokens
      usage.judgeCalls += st.calls
      usage.judgeCacheHits += st.cacheHits
      usage.judgeFallbacks += st.fallbacks
      judgeFallbackBySource[source] = st.fallbacks > 0
    }
  }

  const sources = {} as Record<Source, SourceMetrics | null>
  const p95BySource = {} as Record<Source, number | null>
  const gates: Gate[] = []
  const p95Enforced = opts.mode !== 'replay' && opts.deadlinePolicy === 'app'
  for (const s of SOURCES) {
    const c = counts[s]
    const srcZips = zips.filter((z) => z.source === s)
    sources[s] = c ? { ...metricsFromCounts(c), zips: srcZips.filter((z) => z.status === 'scored').length } : null
    p95BySource[s] = c ? p95(c.windows.attemptMs) : null
    gates.push(
      ...sourceGates({
        source: s,
        evaluated: requested.includes(s) && !aborted,
        metrics: sources[s],
        zipsWithGold: srcZips.filter((z) => z.status !== 'no_gold').length,
        scoredZips: srcZips.filter((z) => z.status === 'scored').length,
        problemZips: srcZips.filter((z) => z.status !== 'scored' && z.status !== 'no_gold').length,
        gold: goldEntries.filter((g) => g.source === s),
        judgeFallback: judgeFallbackBySource[s],
        p95WindowMs: p95BySource[s],
        p95Enforced,
      }),
    )
  }
  return {
    reportVersion: 1,
    runId,
    createdAt: deps.now().toISOString(),
    promptVersion: opts.promptVersion,
    model: opts.model,
    mode: opts.mode,
    deadlinePolicy: opts.deadlinePolicy,
    parserVersion: parser.PARSER_VERSION,
    judgePromptVersions: judgeVersions,
    judgeFallback: judgeFallbackBySource.synthetic || judgeFallbackBySource.real,
    aborted,
    usage,
    gold: goldEntries,
    p95WindowMs: p95BySource,
    p95Valid: opts.deadlinePolicy === 'app',
    sources,
    gates,
    passed: gatesPassed(gates),
    passedBySource: { synthetic: gatesPassed(gates, 'synthetic'), real: gatesPassed(gates, 'real') },
    zips,
    warnings,
  }
}

export async function runEval(opts: RunOptions, deps: RunDeps): Promise<RunResult> {
  const plans = discoverZips(deps.paths, opts)
  const withGold = plans.filter((p) => p.gold || p.goldIssues)
  const bySource = (s: Source) => plans.filter((p) => p.source === s)
  deps.log(`zips found: synthetic ${bySource('synthetic').length} (with gold ${bySource('synthetic').filter((p) => p.gold || p.goldIssues).length}), real ${bySource('real').length} (with gold ${bySource('real').filter((p) => p.gold || p.goldIssues).length})`)

  const [parser, extract, llm] = await Promise.all([deps.loadParser(), deps.loadExtract(), deps.loadLlm()])
  const missing = [parser, extract, llm].filter((x): x is Extract<typeof x, { ok: false }> => !x.ok)
  if (missing.length) {
    const message = `eval cannot run: required module entries are unavailable:\n${missing.map((m) => `  - ${m.module}: ${m.reason}`).join('\n')}`
    return { exitCode: 2, message, report: null, files: [] }
  }
  if (!plans.length) return { exitCode: 3, message: opts.zip ? `no zip matches --zip ${opts.zip}` : 'no zips found', report: null, files: [] }
  if (!withGold.length) return { exitCode: 3, message: 'eval cannot run: no gold files under eval/gold/<source>/ for the selected zips (the annotator has not produced gold yet)', report: null, files: [] }
  const parserApi = (parser as { ok: true; api: ParserApi }).api
  const extractApi = (extract as { ok: true; api: ExtractApi }).api
  const llmApi = (llm as { ok: true; api: LlmApi }).api
  const current = opts.promptVersion ?? extractApi.PROMPT_VERSION
  if (!current) return { exitCode: 2, message: 'eval cannot run: extract does not export PROMPT_VERSION and --prompt was not given', report: null, files: [] }

  const files: string[] = []
  const stamp = fileTimestamp(deps.now())
  const report = await runOnce({ ...opts, promptVersion: current }, deps, plans, parserApi, extractApi, llmApi)
  for (const line of summaryLines(combinedReport(report))) deps.log(line)
  for (const w of combinedReport(report).warnings) deps.log(`warning: ${w}`)
  if (opts.write) files.push(...writeEvalReports(deps.paths, report, stamp))

  if (opts.compare && opts.compare !== current) {
    const baseline = await runOnce({ ...opts, promptVersion: opts.compare }, deps, plans, parserApi, extractApi, llmApi)
    if (opts.write) files.push(...writeEvalReports(deps.paths, baseline, `${stamp}-${opts.compare}`))
    const cmp = compareReports(baseline, report, deps.now().toISOString())
    if (opts.write) files.push(writeCompare(deps.paths, cmp, stamp))
    deps.log(`compare ${opts.compare} → ${current}: claims P Δ ${cmp.sources.synthetic.delta['claims.precisionLenient'] ?? 'n/a'} (synthetic), ${cmp.sources.real.delta['claims.precisionLenient'] ?? 'n/a'} (real); R Δ ${cmp.sources.synthetic.delta['claims.recallStrict'] ?? 'n/a'} / ${cmp.sources.real.delta['claims.recallStrict'] ?? 'n/a'}`)
  }
  for (const f of files) deps.log(`wrote ${path.relative(deps.paths.root, f)}`)
  return { exitCode: report.passed ? 0 : 1, message: report.passed ? 'eval gates passed' : 'eval gates failed', report, files }
}
