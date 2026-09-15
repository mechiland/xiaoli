// Eval "top-up" run (DECISIONS ## extract X27): replays the committed extract cassettes of the current prompt version and
// makes live (recorded) calls only for cassette misses of other purposes (dedup) and for judge cache misses. Used when a
// deterministic pipeline change (validation, guard, dedup inputs) leaves the extract requests byte-identical, so the
// critic's plain `pnpm eval` replay afterwards hits every cassette and judge cache entry.
//
//   node --import tsx server/extract/scripts/eval-fill.ts [--source all|synthetic|real] [--run-id id] [--max-live-tokens 60000] [--no-write]
//
// Live extract calls are refused (the run would no longer measure the recorded prompt version), and live calls stop
// with budget_exceeded once --max-live-tokens is used up.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { LlmClient, LlmError, LlmJsonRequest } from '@/server/llm'
import { loadExtract, loadLlm, loadParser } from '@/eval/src/entries'
import { committedLock } from '@/eval/src/lock'
import { evalPaths, type Source } from '@/eval/src/paths'
import { runEval } from '@/eval/src/run'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function loadEnv(root: string): Record<string, unknown> {
  const env: Record<string, unknown> = { ...process.env }
  const file = path.join(root, '.env.local')
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  return env
}

async function main(): Promise<number> {
  const paths = evalPaths()
  const root = paths.root
  const env = loadEnv(root)
  const maxLive = Number(flag('max-live-tokens') ?? 60_000)
  const source = (flag('source') ?? 'all') as Source | 'all'
  let liveTokens = 0
  const liveByPurpose: Record<string, number> = {}

  const capped = (inner: LlmClient): LlmClient => ({
    async completeJson(req: LlmJsonRequest) {
      if (liveTokens >= maxLive) {
        const e: LlmError = { ok: false, code: 'budget_exceeded', message: `eval-fill live token cap ${maxLive} reached`, raw: null, retryable: false, latencyMs: 0 }
        return e
      }
      const r = await inner.completeJson(req)
      const u = r.usage
      if (u) liveTokens += u.inputTokens + u.outputTokens
      liveByPurpose[req.purpose] = (liveByPurpose[req.purpose] ?? 0) + 1
      return r
    },
  })

  const result = await runEval(
    { source, mode: 'record', model: 'deepseek-flash', runId: flag('run-id'), deadlinePolicy: 'app', write: !process.argv.includes('--no-write') },
    {
      paths,
      loadParser: () => loadParser(root),
      loadExtract: () => loadExtract(root),
      loadLlm: () => loadLlm(root),
      llmEnv: env,
      baseline: committedLock(root),
      readDecisions: () => (existsSync(paths.decisions) ? readFileSync(paths.decisions, 'utf8') : ''),
      now: () => new Date(),
      log: (l) => console.log(l),
      async makeLlm(src, _mode, runId, api) {
        if (!api) throw new Error('llm module unavailable')
        const logger = api.jsonlCallLogger(path.join(paths.runs, runId, 'llm-calls.jsonl'))
        const budget = await api.fileBudget()
        const replay = api.createLlmClient({ env, logger, mode: 'replay', cassetteDir: paths.cassettes[src], budget: null })
        const record = capped(api.createLlmClient({ env, logger, mode: 'record', cassetteDir: paths.cassettes[src], budget }))
        const extract: LlmClient = {
          async completeJson(req) {
            const r = await replay.completeJson(req)
            if (r.ok || r.code !== 'cassette_miss') return r
            if (req.purpose === 'extract') return r // never re-record extraction here
            return record.completeJson(req)
          },
        }
        return { extract, judge: capped(api.createLlmClient({ env, logger, mode: 'live', budget })) }
      },
    },
  )
  console.log(`eval-fill live calls ${JSON.stringify(liveByPurpose)} · live tokens ${liveTokens} (cap ${maxLive})`)
  ;(result.exitCode === 0 ? console.log : console.error)(result.message)
  return result.exitCode
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`eval-fill: ${(e as Error).message}`)
    process.exit(1)
  },
)
