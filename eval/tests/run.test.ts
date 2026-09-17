// End-to-end harness runs with a stub extractor, stand-in parser and fake judge (no LLM, no D1).
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { anchorsFor } from '../src/annotate'
import type { ExtractApi, LlmApi, LlmClient, Loaded, OfflineExtractionResult } from '../src/entries'
import type { GoldFile } from '../src/gold-schema'
import { fakeJudge } from '../src/judge'
import { freezeGold, lockKeyFor, sha256Hex } from '../src/lock'
import { evalPaths, type Source } from '../src/paths'
import { compareReports } from '../src/report'
import { runEval, type RunDeps, type RunOptions } from '../src/run'
import { baseGold, basePred, claim, fakeParser, makeZip, rawMessages, tempRoot } from './helpers'

const SYN_ZIP = '聊天记录_20260101_000000.zip'
const REAL_ZIP = '聊天记录_20260202_000000.zip'
const REAL_SECRET_STATEMENT = '在某某大厦上班'

const dummyLlm: LlmClient = { completeJson: async () => ({ ok: false, code: 'cassette_miss', message: 'x', raw: null, retryable: false, latencyMs: 0 }) }
const okLlm: Loaded<LlmApi> = { ok: true, api: { createLlmClient: () => dummyLlm, jsonlCallLogger: () => ({}), fileBudget: async () => ({}) } }

async function makeSource(root: string, source: Source, file: string, statement: string, lock: string) {
  const paths = evalPaths(root)
  mkdirSync(paths.fixtures[source], { recursive: true })
  mkdirSync(paths.gold[source], { recursive: true })
  const bytes = makeZip(rawMessages(20))
  writeFileSync(path.join(paths.fixtures[source], file), bytes)
  const parsed = await fakeParser.parseExportZip(bytes, { fileName: file })
  const gold: GoldFile = baseGold({
    zip: file,
    messageCount: 20,
    messagesSha256: await fakeParser.messagesDigest(parsed.messages),
    anchors: anchorsFor(parsed),
    claims: [
      { id: 'c1', person: 'a', statement, category: 'work', sensitive: false, evidence: [1] },
      { id: 'c2', person: 'b', statement: '喜欢钓鱼', category: 'preference', sensitive: false, evidence: [2] },
    ],
  })
  const goldText = JSON.stringify(gold, null, 2)
  writeFileSync(path.join(paths.gold[source], file.replace(/\.zip$/, '.json')), goldText)
  freezeGold({ lockPath: lock, decisions: '', baseline: null, lockKey: lockKeyFor(source, file, sha256Hex(bytes)), source, goldSha256: sha256Hex(goldText), messagesSha256: gold.messagesSha256 })
  return gold
}

function stubExtract(fn: (promptVersion: string, file: string) => Partial<OfflineExtractionResult>): Loaded<ExtractApi> {
  return {
    ok: true,
    api: {
      PROMPT_VERSION: 'extract.v2',
      extractOffline: async (args) => basePred({ promptVersion: args.promptVersion, ...fn(args.promptVersion ?? '', args.parsed.fileName) }),
    },
  }
}

function deps(root: string, extract: Loaded<ExtractApi>, over: Partial<RunDeps> = {}): RunDeps & { logs: string[] } {
  const logs: string[] = []
  return {
    logs,
    paths: evalPaths(root),
    loadParser: async () => ({ ok: true, api: fakeParser }),
    loadExtract: async () => extract,
    loadLlm: async () => okLlm,
    llmEnv: {},
    baseline: null,
    readDecisions: () => '',
    now: () => new Date('2026-09-15T10:00:00Z'),
    log: (l) => logs.push(l),
    makeLlm: async () => ({ extract: dummyLlm, judge: null }),
    makeJudge: () =>
      Object.assign(
        fakeJudge({
          matches: { 喜欢钓鱼: { gold: 'c2', verdict: 'same' }, [REAL_SECRET_STATEMENT]: { gold: 'c1', verdict: 'same' }, 在云杉医院当护士: { gold: 'c1', verdict: 'same' } },
          labels: { 报价1680元: { label: 'should_ignore', subLabel: 'transactional' } },
        }),
        { versions: { match: 'judge-match.v1', fp: 'judge-fp.v1' } },
      ),
    ...over,
  }
}

const opts = (over: Partial<RunOptions> = {}): RunOptions => ({ source: 'synthetic', mode: 'replay', model: 'deepseek-flash', deadlinePolicy: 'app', write: true, ...over })

describe('runEval preconditions', () => {
  it('extract entry unavailable → clear message, exit 2, no report', async () => {
    const root = tempRoot()
    await makeSource(root, 'synthetic', SYN_ZIP, '在云杉医院当护士', evalPaths(root).lock)
    const r = await runEval(opts(), deps(root, { ok: false, module: 'extract', entry: 'src/server/extract/index.ts', reason: 'src/server/extract/index.ts does not exist yet' }))
    expect(r.exitCode).toBe(2)
    expect(r.message).toContain('extract')
    expect(r.report).toBeNull()
  })

  it('no gold → exit 3', async () => {
    const root = tempRoot()
    const paths = evalPaths(root)
    mkdirSync(paths.fixtures.synthetic, { recursive: true })
    writeFileSync(path.join(paths.fixtures.synthetic, SYN_ZIP), makeZip(rawMessages(5)))
    const r = await runEval(opts(), deps(root, stubExtract(() => ({}))))
    expect(r.exitCode).toBe(3)
    expect(r.message).toMatch(/no gold/)
  })
})

describe('runEval scoring', () => {
  it('synthetic run: scores, writes combined (aggregate only) + detail reports, real gates fail as not evaluated', async () => {
    const root = tempRoot()
    const paths = evalPaths(root)
    await makeSource(root, 'synthetic', SYN_ZIP, '在云杉医院当护士', paths.lock)
    const d = deps(root, stubExtract(() => ({ claims: [claim('a', '在云杉医院当护士', 'work', [1]), claim('b', '喜欢钓鱼', 'preference', [2])] })))
    const r = await runEval(opts(), d)
    const rep = r.report!
    expect(rep.zips[0]).toMatchObject({ zip: SYN_ZIP, status: 'scored', messageCount: 20 })
    expect(rep.sources.synthetic!.claims).toMatchObject({ precisionLenient: 1, recallStrict: 1 })
    expect(rep.promptVersion).toBe('extract.v2')
    expect(rep.gold[0]).toMatchObject({ frozen: true, lockKey: '聊天记录_20260101_000000' })
    expect(rep.passedBySource).toEqual({ synthetic: true, real: false })
    expect(r.exitCode).toBe(1)
    expect(rep.usage).toMatchObject({ inputTokens: 1000, outputTokens: 200, calls: 1 })

    const combined = readFileSync(path.join(paths.reportSummary, '20260915-100000.json'), 'utf8')
    expect(combined).not.toContain('在云杉医院当护士')
    expect(JSON.parse(combined).zips[0].details).toBeUndefined()
    const detail = JSON.parse(readFileSync(path.join(paths.reportDetail.synthetic, '20260915-100000.json'), 'utf8'))
    expect(detail.zips[0].details.tp).toHaveLength(2)
    expect(d.logs.join('\n')).toContain('claims    P 1.00')
  })

  it('all sources with real data: anonymised combined report, real detail only under gitignored path', async () => {
    const root = tempRoot()
    const paths = evalPaths(root)
    execFileSync('git', ['init', '-q'], { cwd: root })
    writeFileSync(path.join(root, '.gitignore'), 'eval/reports/real/\neval/gold/real/\nfixtures/real/\n')
    await makeSource(root, 'synthetic', SYN_ZIP, '在云杉医院当护士', paths.lock)
    await makeSource(root, 'real', REAL_ZIP, REAL_SECRET_STATEMENT, paths.lock)
    const perfect = (file: string) => ({ claims: [claim('a', file === REAL_ZIP ? REAL_SECRET_STATEMENT : '在云杉医院当护士', 'work', [1]), claim('b', '喜欢钓鱼', 'preference', [2])] })
    const r = await runEval(opts({ source: 'all' }), deps(root, stubExtract((_, file) => perfect(file))))
    expect(r.report!.passed).toBe(true)
    expect(r.exitCode).toBe(0)
    const combined = readFileSync(path.join(paths.reportSummary, '20260915-100000.json'), 'utf8')
    expect(combined).not.toContain(REAL_ZIP)
    expect(combined).not.toContain(REAL_SECRET_STATEMENT)
    expect(JSON.parse(combined).zips.map((z: { zip: string }) => z.zip)).toContain('real-1')
    expect(readFileSync(path.join(paths.reportDetail.real, '20260915-100000.json'), 'utf8')).toContain(REAL_SECRET_STATEMENT)
  })

  it('refuses to write real detail when the path is not confirmed gitignored', async () => {
    const root = tempRoot()
    await makeSource(root, 'real', REAL_ZIP, REAL_SECRET_STATEMENT, evalPaths(root).lock)
    await expect(runEval(opts({ source: 'real' }), deps(root, stubExtract(() => ({}))))).rejects.toThrow(/gitignored/)
  })

  it('gold drift → gold_mismatch, not scored, gates fail', async () => {
    const root = tempRoot()
    const paths = evalPaths(root)
    const gold = await makeSource(root, 'synthetic', SYN_ZIP, '在云杉医院当护士', paths.lock)
    writeFileSync(path.join(paths.fixtures.synthetic, SYN_ZIP), makeZip(rawMessages(21)))
    const r = await runEval(opts(), deps(root, stubExtract(() => ({}))))
    expect(r.report!.zips[0]).toMatchObject({ status: 'gold_mismatch', messageCount: 21 })
    expect(r.report!.zips[0].problem).toContain(`gold messageCount ${gold.messageCount}`)
    const g = r.report!.gates.find((x) => x.source === 'synthetic' && x.name === 'zips.unscoredWithGold')!
    expect(g.passed).toBe(false)
    expect(r.report!.passedBySource.synthetic).toBe(false)
  })

  it('budget_exceeded window aborts the run; record mode enforces p95', async () => {
    const root = tempRoot()
    await makeSource(root, 'synthetic', SYN_ZIP, '在云杉医院当护士', evalPaths(root).lock)
    const slow = stubExtract(() => ({ windows: [{ index: 0, startIdx: 0, endIdx: 19, outcome: 'fatal_error', code: 'budget_exceeded', attempts: 1, attemptMs: [45_000], latencyMs: 45_000, rawItemCount: 0, droppedInvalidEvidence: 0, rawOutputs: [] }] }))
    const r = await runEval(opts({ mode: 'record', write: false }), deps(root, slow))
    expect(r.report!.aborted).toBe('budget_exceeded')
    const p95Gate = r.report!.gates.find((x) => x.source === 'synthetic' && x.name === 'p95WindowMs')!
    expect(p95Gate.informational).toBeUndefined()
    expect(r.files).toEqual([])
    expect(r.exitCode).toBe(1)
  })

  it('--compare runs both prompt versions and writes a compare report with deltas', async () => {
    const root = tempRoot()
    const paths = evalPaths(root)
    await makeSource(root, 'synthetic', SYN_ZIP, '在云杉医院当护士', paths.lock)
    const byVersion = stubExtract((v) =>
      v === 'extract.v1'
        ? { claims: [claim('a', '在云杉医院当护士', 'work', [1]), claim('b', '报价1680元', 'other', [3])] }
        : { claims: [claim('a', '在云杉医院当护士', 'work', [1]), claim('b', '喜欢钓鱼', 'preference', [2])] },
    )
    const r = await runEval(opts({ compare: 'extract.v1' }), deps(root, byVersion))
    const file = readdirSync(paths.reportCompare).find((f) => f.startsWith('compare-extract.v1-vs-extract.v2-'))!
    const cmp = JSON.parse(readFileSync(path.join(paths.reportCompare, file), 'utf8'))
    expect(cmp.sources.synthetic.a['claims.precisionLenient']).toBe(0.5)
    expect(cmp.sources.synthetic.b['claims.precisionLenient']).toBe(1)
    expect(cmp.sources.synthetic.delta['claims.precisionLenient']).toBe(0.5)
    expect(cmp.sources.synthetic.a.transactionalAsClaimRatio).toBe(0.5)
    expect(r.files.some((f) => f.endsWith(file))).toBe(true)
  })

  /**
   * The cost half of the two-call split (DECISIONS I17). The stub extractor issues the calls a real window issues —
   * an extraction call, an interaction call with its own prompt version, and a dedup call — through the client the
   * harness handed it. The report must then carry both prompt versions and a per-call cost split, and it must do so
   * even though extract sends the interaction call with `purpose: 'other'` (INTERACTION_PURPOSE), i.e. the split
   * cannot rest on the purpose field.
   */
  it('report carries both prompt versions and the per-call cost split', async () => {
    const root = tempRoot()
    await makeSource(root, 'synthetic', SYN_ZIP, '在云杉医院当护士', evalPaths(root).lock)
    const calling: Loaded<ExtractApi> = {
      ok: true,
      api: {
        PROMPT_VERSION: 'extract.v8',
        INTERACTION_PROMPT_VERSION: 'interaction.v1',
        extractOffline: async (args) => {
          await args.llm.completeJson({ purpose: 'extract', promptVersion: args.promptVersion ?? 'extract.v8', model: 'deepseek-flash', messages: [], maxTokens: 10 })
          await args.llm.completeJson({ purpose: 'other', promptVersion: 'interaction.v1', model: 'deepseek-flash', messages: [], maxTokens: 10 })
          await args.llm.completeJson({ purpose: 'dedup', promptVersion: 'dedup.v2', model: 'deepseek-flash', messages: [], maxTokens: 10 })
          return basePred({ promptVersion: args.promptVersion, interactionPromptVersion: 'interaction.v1', usage: { inputTokens: 300, outputTokens: 30, calls: 3 } })
        },
      },
    }
    const usageLlm: LlmClient = {
      completeJson: async () => ({ ok: true, json: {}, raw: '{}', usage: { inputTokens: 100, outputTokens: 10, cacheHitTokens: null }, latencyMs: 1, model: 'deepseek-flash', finishReason: 'stop', fromCassette: true }),
    }
    const d = deps(root, calling, { makeLlm: async () => ({ extract: usageLlm, judge: null }) })
    const rep = (await runEval(opts({ write: false }), d)).report!
    expect(rep.promptVersion).toBe('extract.v8')
    expect(rep.interactionPromptVersion).toBe('interaction.v1')
    expect(rep.usage.byCall.extract).toEqual({ inputTokens: 100, outputTokens: 10, calls: 1, failedCalls: 0 })
    expect(rep.usage.byCall.interaction).toEqual({ inputTokens: 100, outputTokens: 10, calls: 1, failedCalls: 0 })
    expect(rep.usage.byCall.dedup).toEqual({ inputTokens: 100, outputTokens: 10, calls: 1, failedCalls: 0 })
    // the two totals agree, so no honesty warning; the console prints the split
    expect(rep.warnings.filter((w) => w.includes('usage mismatch'))).toEqual([])
    expect(d.logs.join('\n')).toContain('by call: extract in 100 out 10 (1 calls) · interaction in 100 out 10 (1 calls)')
  })

  it('says so when the pipeline`s own token total and the calls the harness saw disagree', async () => {
    const root = tempRoot()
    await makeSource(root, 'synthetic', SYN_ZIP, '在云杉医院当护士', evalPaths(root).lock)
    const underReporting: Loaded<ExtractApi> = {
      ok: true,
      api: {
        PROMPT_VERSION: 'extract.v8',
        INTERACTION_PROMPT_VERSION: 'interaction.v1',
        extractOffline: async (args) => {
          await args.llm.completeJson({ purpose: 'extract', promptVersion: 'extract.v8', model: 'deepseek-flash', messages: [], maxTokens: 10 })
          await args.llm.completeJson({ purpose: 'other', promptVersion: 'interaction.v1', model: 'deepseek-flash', messages: [], maxTokens: 10 })
          // …but only counts the first one, which is exactly how a second call disappears from a cost report
          return basePred({ promptVersion: args.promptVersion, usage: { inputTokens: 100, outputTokens: 10, calls: 1 } })
        },
      },
    }
    const usageLlm: LlmClient = {
      completeJson: async () => ({ ok: true, json: {}, raw: '{}', usage: { inputTokens: 100, outputTokens: 10, cacheHitTokens: null }, latencyMs: 1, model: 'deepseek-flash', finishReason: 'stop', fromCassette: true }),
    }
    const rep = (await runEval(opts({ write: false }), deps(root, underReporting, { makeLlm: async () => ({ extract: usageLlm, judge: null }) }))).report!
    expect(rep.warnings.join(' ')).toContain('usage mismatch: extractOffline reports 1 calls / 100 input tokens, the harness observed 2 / 200')
    expect(rep.usage.byCall.interaction.calls).toBe(1)
  })

  it('compareReports refuses runs with different gold', async () => {
    const root = tempRoot()
    await makeSource(root, 'synthetic', SYN_ZIP, '在云杉医院当护士', evalPaths(root).lock)
    const r = await runEval(opts({ write: false }), deps(root, stubExtract(() => ({}))))
    const a = r.report!
    const b = { ...a, gold: a.gold.map((g) => ({ ...g, goldSha256: 'e'.repeat(64) })) }
    expect(() => compareReports(a, b)).toThrow(/different gold/)
  })
})
