// scripts/llm-usage.ts end to end on a temp budget file and call log.
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '..', '..', '..')
let dir: string
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'xiaoli-llm-usage-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

function run(args: string[]) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/llm-usage.ts', ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, LLM_BUDGET_TOKENS: '' } })
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr }
}

describe('pnpm llm:usage', () => {
  it('resets a loop, prints JSON totals, and summarizes a call log', async () => {
    const file = path.join(dir, 'budget.json')
    const fresh = run(['--json', '--file', file])
    expect(fresh.status).toBe(0)
    expect(JSON.parse(fresh.stdout)).toEqual({ loopId: null, startedAt: null, limit: 3_000_000, inputTokens: 0, outputTokens: 0, exceeded: false })

    const reset = run(['--reset', '--loop', 'loop-3', '--limit', '100', '--json', '--file', file])
    expect(reset.status).toBe(0)
    expect(JSON.parse(reset.stdout)).toMatchObject({ loopId: 'loop-3', limit: 100, inputTokens: 0, exceeded: false })

    await writeFile(file, JSON.stringify({ loopId: 'loop-3', startedAt: '2026-09-15T00:00:00.000Z', limit: 100, inputTokens: 70, outputTokens: 30 }))
    expect(JSON.parse(run(['--json', '--file', file]).stdout)).toMatchObject({ exceeded: true })

    const log = path.join(dir, 'llm-calls.jsonl')
    const line = (mode: string, i: number, o: number) => JSON.stringify({ mode, purpose: 'extract', model: 'deepseek-flash', inputTokens: i, outputTokens: o, cacheHitTokens: null, error: null })
    await writeFile(log, `${line('live', 10, 2)}\n${line('replay', 99, 99)}\n`)
    expect(JSON.parse(run(['--json', '--jsonl', log]).stdout)).toMatchObject({ calls: 2, inputTokens: 10, outputTokens: 2 })

    const bad = run(['--reset', '--file', file])
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('--loop')
  })
})
