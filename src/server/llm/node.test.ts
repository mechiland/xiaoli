// Node-side pieces: file budget (lock), JSONL logger, directory cassette store, CLI factory. Temp dirs only.
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cassetteKey, dirCassetteStore } from './cassette'
import { createLlmClient } from './client'
import { createCliLlm, fileBudget, jsonlCallLogger, readCallLog, readFileBudget, resetFileBudget } from './index'
import { memoryCallLogger } from './loggers'
import type { LlmCallRecord, LlmJsonRequest } from './types'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'xiaoli-llm-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const REQ: LlmJsonRequest = {
  purpose: 'other',
  promptVersion: 'node-test.v1',
  model: 'deepseek-flash',
  messages: [{ role: 'user', content: '合成：输出 json，例如 {"ok": true}' }],
  maxTokens: 50,
}

const record = (over: Partial<LlmCallRecord> = {}): LlmCallRecord => ({
  ownerId: null,
  provider: 'deepseek',
  model: 'deepseek-flash',
  promptVersion: 'p.v1',
  purpose: 'extract',
  importId: null,
  jobId: null,
  evalRunId: 'run-1',
  inputTokens: 10,
  outputTokens: 5,
  cacheHitTokens: null,
  latencyMs: 12,
  attempt: 1,
  mode: 'live',
  cassetteKey: null,
  rawOutput: '{}',
  finishReason: 'stop',
  error: null,
  createdAt: '2026-09-15T00:00:00.000Z',
  ...over,
})

describe('file budget', () => {
  it('starts empty, adds under a lock without losing concurrent updates, and resets', async () => {
    const file = path.join(dir, 'budget.json')
    const a = await fileBudget(file)
    const b = await fileBudget(file)
    expect(await a.used()).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(a.limit).toBe(3_000_000)
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).add({ inputTokens: 3, outputTokens: 1 })))
    expect(await b.used()).toEqual({ inputTokens: 60, outputTokens: 20 })
    await expect(readFile(path.join(dir, 'budget.lock'))).rejects.toThrow() // lock released

    const state = await resetFileBudget(file, { loopId: 'loop-7', limit: 500 })
    expect(state).toMatchObject({ loopId: 'loop-7', limit: 500, inputTokens: 0, outputTokens: 0 })
    expect(await a.used()).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(a.limit).toBe(500) // picked up from the file on read
    expect((await readFileBudget(file))?.loopId).toBe('loop-7')
  })

  it('breaks a stale lock', async () => {
    const file = path.join(dir, 'budget.json')
    await writeFile(path.join(dir, 'budget.lock'), '')
    const old = new Date(Date.now() - 10_000)
    const { utimes } = await import('node:fs/promises')
    await utimes(path.join(dir, 'budget.lock'), old, old)
    const b = await fileBudget(file)
    await b.add({ inputTokens: 1, outputTokens: 1 })
    expect(await b.used()).toEqual({ inputTokens: 1, outputTokens: 1 })
  })

  it('a corrupt budget file makes live calls fail closed', async () => {
    const file = path.join(dir, 'budget.json')
    await writeFile(file, '{not json')
    await expect(fileBudget(file)).rejects.toThrow()
    await resetFileBudget(file, { loopId: 'x' })
    const budget = await fileBudget(file)
    await writeFile(file, '{"loopId": 1}')
    const fetchFn = (async () => {
      throw new Error('must not be called')
    }) as typeof fetch
    const client = createLlmClient({ env: { DEEPSEEK_API_KEY: 'sk-test-abcdefgh' }, logger: memoryCallLogger(), mode: 'live', budget, fetch: fetchFn })
    const r = await client.completeJson(REQ)
    expect(r.ok === false && r.code).toBe('budget_exceeded')
  })
})

describe('jsonl logger', () => {
  it('appends one line per record and reads them back', async () => {
    const file = path.join(dir, 'runs', 'r1', 'llm-calls.jsonl')
    const logger = jsonlCallLogger(file)
    await logger.log(record())
    await logger.log(record({ attempt: 2, error: { code: 'timeout', message: 'slow' } }))
    const back = await readCallLog(file)
    expect(back).toHaveLength(2)
    expect(back[1]).toMatchObject({ attempt: 2, error: { code: 'timeout' } })
    expect(await readCallLog(path.join(dir, 'missing.jsonl'))).toEqual([])
  })
})

describe('directory cassette store', () => {
  it('records to <dir>/<promptVersion>/<key>.json and replays from disk', async () => {
    const cassettes = path.join(dir, 'cassettes')
    const body = JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 3 } })
    const fetchFn = (async () => new Response(body, { status: 200 })) as typeof fetch
    const recClient = createLlmClient({
      env: { DEEPSEEK_API_KEY: 'sk-test-abcdefgh' },
      logger: memoryCallLogger(),
      mode: 'record',
      cassetteDir: cassettes,
      budget: await fileBudget(path.join(dir, 'b.json')),
      fetch: fetchFn,
    })
    expect((await recClient.completeJson(REQ)).ok).toBe(true)
    const key = cassetteKey(REQ, 'disabled')
    const file = path.join(cassettes, 'node-test.v1', `${key}.json`)
    const saved = JSON.parse(await readFile(file, 'utf8'))
    expect(saved).toMatchObject({ key, response: { content: '{"ok":true}', usage: { inputTokens: 7, outputTokens: 3 } } })
    expect(JSON.stringify(saved)).not.toContain('sk-test')

    const replay = createLlmClient({ env: {}, logger: memoryCallLogger(), mode: 'replay', cassetteDir: cassettes, budget: null })
    const r = await replay.completeJson(REQ)
    expect(r.ok && r.json).toEqual({ ok: true })
  })

  it('reports invalid files and key mismatches as cassette_miss with the reason', async () => {
    const cassettes = path.join(dir, 'cassettes')
    const key = cassetteKey(REQ, 'disabled')
    await mkdir(path.join(cassettes, 'node-test.v1'), { recursive: true })
    await writeFile(path.join(cassettes, 'node-test.v1', `${key}.json`), JSON.stringify({ key: 'f'.repeat(32) }))
    const replay = createLlmClient({ env: {}, logger: memoryCallLogger(), mode: 'replay', cassetteDir: cassettes, budget: null })
    const r = await replay.completeJson(REQ)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('cassette_miss')
      expect(r.message).toMatch(/unreadable|invalid/)
    }
    const store = dirCassetteStore(cassettes)
    expect(store.describe('a/../b', key)).toBe(`${cassettes}/a_.._b/${key}.json`)
  })
})

describe('createCliLlm', () => {
  it('logs to <runsDir>/<runId>/llm-calls.jsonl and summarizes usage (replay needs no budget)', async () => {
    const cli = await createCliLlm({ mode: 'replay', runId: 'run/1', runsDir: path.join(dir, 'runs'), cassetteDir: path.join(dir, 'none'), env: {} })
    const r = await cli.llm.completeJson(REQ)
    expect(r.ok).toBe(false)
    expect(cli.logPath).toBe(path.join(dir, 'runs', 'run_1', 'llm-calls.jsonl'))
    expect(await readCallLog(cli.logPath)).toHaveLength(1)
    expect(cli.summary()).toMatchObject({ calls: 1, replayCalls: 1, errorCalls: 1, inputTokens: 0 })
  })
})
