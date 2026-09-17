// pnpm llm:usage [--json] [--reset --loop <id> [--limit <n>]] [--file <path>] [--jsonl <path>] [--remote [--since <iso>]]
// Owned by llm (ARCHITECTURE §5 "Loop reset & reporting"). Prints token counts only, never prompts, outputs or keys.
import { spawnSync } from 'node:child_process'
import { readJsonl } from '@/server/llm/node/fs-io'
import { envBudgetLimit, readBudgetFile, resetFileBudget } from '@/server/llm/node/file-budget'
import { summarizeUsage } from '@/server/llm/usage'
import type { LlmCallRecord } from '@/server/llm/types'

const argv = process.argv.slice(2)
const has = (f: string) => argv.includes(f)
const arg = (f: string) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const asJson = has('--json')

function out(value: Record<string, unknown>, lines: string[]) {
  console.log(asJson ? JSON.stringify(value) : lines.join('\n'))
}

function fail(msg: string): never {
  console.error(`llm:usage: ${msg}`)
  process.exit(1)
}

async function main() {
  if (has('--help') || has('-h')) {
    console.log('usage: pnpm llm:usage [--json] [--reset --loop <id> [--limit <n>]] [--file <budget.json>] [--jsonl <llm-calls.jsonl>] [--remote [--since <iso>]]')
    return
  }

  if (has('--remote')) {
    const now = new Date()
    const since = arg('--since') ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(since)) fail('--since must be an ISO UTC timestamp like 2026-09-01T00:00:00.000Z')
    const sql = `SELECT COALESCE(SUM(input_tokens),0) AS inputTokens, COALESCE(SUM(output_tokens),0) AS outputTokens, COUNT(*) AS calls FROM llm_calls WHERE mode != 'replay' AND created_at >= '${since}'`
    const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'xiaoli', '--remote', '--json', '--command', sql], { encoding: 'utf8' })
    if (r.status !== 0) fail(`wrangler d1 execute failed (exit ${r.status}): ${(r.stderr || '').slice(0, 500)}`)
    const row = (JSON.parse(r.stdout) as { results?: Record<string, number>[] }[])[0]?.results?.[0] ?? {}
    const limit = envBudgetLimit()
    const inputTokens = Number(row.inputTokens ?? 0)
    const outputTokens = Number(row.outputTokens ?? 0)
    const value = { source: 'remote', since, limit, inputTokens, outputTokens, calls: Number(row.calls ?? 0), exceeded: inputTokens + outputTokens >= limit }
    out(value, [`remote llm_calls since ${since}`, `input ${inputTokens}  output ${outputTokens}  calls ${value.calls}`, `limit ${limit}${value.exceeded ? '  EXCEEDED' : ''}`])
    return
  }

  const jsonl = arg('--jsonl')
  if (jsonl) {
    const s = summarizeUsage((await readJsonl(jsonl)) as LlmCallRecord[])
    out({ source: jsonl, ...s }, [
      `calls ${s.calls} (live/record ${s.liveCalls}, replay ${s.replayCalls}, errors ${s.errorCalls})`,
      `input ${s.inputTokens}  output ${s.outputTokens}  cache hit ${s.cacheHitTokens}`,
    ])
    return
  }

  const file = arg('--file')
  if (has('--reset')) {
    const loopId = arg('--loop')
    if (!loopId || loopId.startsWith('--')) fail('--reset requires --loop <loopId>')
    const limitArg = arg('--limit')
    const limit = limitArg === undefined ? undefined : Number(limitArg)
    if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) fail('--limit must be a positive integer')
    await resetFileBudget(file, { loopId, limit })
  }

  const s = await readBudgetFile(file)
  const limit = s?.limit ?? envBudgetLimit()
  const inputTokens = s?.inputTokens ?? 0
  const outputTokens = s?.outputTokens ?? 0
  const value = { loopId: s?.loopId ?? null, startedAt: s?.startedAt ?? null, limit, inputTokens, outputTokens, exceeded: inputTokens + outputTokens >= limit }
  out(value, [
    `loop ${value.loopId ?? '(not reset yet)'}${value.startedAt ? ` since ${value.startedAt}` : ''}`,
    `input ${inputTokens}  output ${outputTokens}  total ${inputTokens + outputTokens} / ${limit}${value.exceeded ? '  EXCEEDED' : ''}`,
  ])
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
