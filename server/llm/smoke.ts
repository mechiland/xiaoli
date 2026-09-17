// Live smoke: pnpm tsx server/llm/smoke.ts --live   (one tiny synthetic JSON request, recorded under fixtures/cassettes/synthetic)
// Without --live it replays the recorded cassette. Prints no secrets; the output JSON is synthetic.
import { loadEnvLocal } from '@/scripts/with-platform'
import { parseServerEnv } from '@/server/env'
import { cassetteDirFor, cassetteKey, cassetteRelPath } from './cassette'
import { createCliLlm } from './node/cli'
import { smokeRequest } from './smoke-request'
import { DEFAULT_MODEL } from './types'

async function main() {
  loadEnvLocal()
  const mode = process.argv.includes('--live') ? 'record' : 'replay'
  const env = parseServerEnv(process.env)
  const model = env.EXTRACT_MODEL ?? DEFAULT_MODEL
  const req = smokeRequest(model)
  const runId = `smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const cassetteDir = cassetteDirFor('synthetic')
  const cli = await createCliLlm({ mode, runId, runsDir: '.dev/llm/runs', cassetteDir })
  const res = await cli.llm.completeJson(req)
  const s = cli.summary()
  console.log(
    JSON.stringify(
      {
        mode,
        model,
        thinking: env.LLM_THINKING,
        ok: res.ok,
        code: res.ok ? null : res.code,
        message: res.ok ? null : res.message,
        json: res.ok ? res.json : null,
        finishReason: res.ok ? res.finishReason : (res.finishReason ?? null),
        latencyMs: res.latencyMs,
        usage: res.ok ? res.usage : (res.usage ?? null),
        attempts: cli.records.length,
        billedTokens: { input: s.inputTokens, output: s.outputTokens },
        cassette: `${cassetteDir}/${cassetteRelPath(req.promptVersion, cassetteKey(req, env.LLM_THINKING))}`,
        callLog: cli.logPath,
      },
      null,
      2,
    ),
  )
  process.exit(res.ok ? 0 : 1)
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err))
  process.exit(1)
})
