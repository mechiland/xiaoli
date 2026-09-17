// llm_calls logging, D1 budget and getAppLlm against an in-memory D1 (tests/helpers, never the dev server's state).
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { llmCalls, type Db } from '@/server/db'
import type { AppEnv } from '@/server/context'
import { parseServerEnv } from '@/server/env'
import { createTestDb, createTestUser } from '@/tests/helpers/test-db'
import { d1Budget, monthStartIso, sumD1Usage } from './budget'
import { cassetteKey, dirCassetteStore } from './cassette'
import { createLlmClient } from './client'
import { getAppLlm } from './app'
import { d1CallLogger } from './loggers'
import type { LlmCallRecord, LlmJsonRequest } from './types'

let db: Db
let dispose: () => Promise<void>
let dir: string

beforeAll(async () => {
  const t = await createTestDb()
  db = t.db
  dispose = t.dispose
  dir = await mkdtemp(path.join(tmpdir(), 'xiaoli-llm-d1-'))
})
afterAll(async () => {
  await dispose?.()
  if (dir) await rm(dir, { recursive: true, force: true })
})

const REQ: LlmJsonRequest = {
  purpose: 'extract',
  promptVersion: 'd1-test.v1',
  model: 'deepseek-flash',
  messages: [{ role: 'user', content: '合成：输出 json，例如 {"ok": true}' }],
  maxTokens: 50,
}

const rec = (over: Partial<LlmCallRecord>): LlmCallRecord => ({
  ownerId: null,
  provider: 'deepseek',
  model: 'deepseek-flash',
  promptVersion: 'p.v1',
  purpose: 'judge',
  importId: null,
  jobId: null,
  evalRunId: null,
  inputTokens: 100,
  outputTokens: 20,
  cacheHitTokens: 0,
  latencyMs: 5.4,
  attempt: 1,
  mode: 'live',
  cassetteKey: null,
  rawOutput: null,
  finishReason: 'stop',
  error: null,
  createdAt: '2026-09-15T01:00:00.000Z',
  ...over,
})

describe('d1CallLogger + d1Budget', () => {
  it('writes every field and sums only non-replay rows since the window start', async () => {
    const logger = d1CallLogger(db)
    await logger.log(rec({ evalRunId: 'd1-run', error: { code: 'invalid_json', message: 'content is not valid JSON' }, rawOutput: '{"x"' }))
    await logger.log(rec({ evalRunId: 'd1-run', mode: 'replay', inputTokens: 999, outputTokens: 999 }))
    await logger.log(rec({ evalRunId: 'd1-run', mode: 'record', createdAt: '2026-08-31T23:59:59.000Z' }))

    const rows = await db.select().from(llmCalls).where(eq(llmCalls.evalRunId, 'd1-run'))
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ provider: 'deepseek', latencyMs: 5, errorCode: 'invalid_json', errorMessage: 'content is not valid JSON', rawOutput: '{"x"', mode: 'live' })

    expect(await sumD1Usage(db, { since: '2026-09-01T00:00:00.000Z' })).toMatchObject({ inputTokens: 100, outputTokens: 20, calls: 1 })
    const budget = d1Budget(db, { since: '2026-08-01T00:00:00.000Z', limit: 240 })
    expect(await budget.used()).toEqual({ inputTokens: 200, outputTokens: 40 })

    const client = createLlmClient({
      env: { DEEPSEEK_API_KEY: 'sk-test-abcdefgh' },
      logger,
      mode: 'live',
      budget,
      fetch: (async () => {
        throw new Error('must not be called')
      }) as typeof fetch,
    })
    const r = await client.completeJson(REQ)
    expect(r.ok === false && r.code).toBe('budget_exceeded')
  })

  it('monthStartIso is the first UTC instant of the month', () => {
    expect(monthStartIso(new Date('2026-09-15T08:30:00Z'))).toBe('2026-09-01T00:00:00.000Z')
  })
})

describe('getAppLlm', () => {
  function appWith(envVars: Record<string, unknown>, llmOverride?: unknown) {
    return new Hono<AppEnv>()
      .use('*', async (c, next) => {
        c.set('env', parseServerEnv(envVars))
        c.set('db', db)
        c.set('user', null)
        if (llmOverride) c.set('llmOverride', llmOverride)
        await next()
      })
      .post('/call', async (c) => {
        const llm = await getAppLlm(c)
        return c.json(await llm.completeJson({ ...REQ, context: { ownerId: 'owner-x', importId: 42, jobId: 7 } }))
      })
  }

  it('uses LLM_MODE, LLM_CASSETTE_DIR and logs to llm_calls with the request context', async () => {
    const user = await createTestUser(db, 'llm-app@xiaoli.test')
    const cassettes = path.join(dir, 'cassettes')
    await dirCassetteStore(cassettes).write({
      key: cassetteKey(REQ, 'disabled'),
      recordedAt: '2026-09-15T00:00:00.000Z',
      model: 'deepseek-flash',
      promptVersion: REQ.promptVersion,
      purpose: REQ.purpose,
      request: { messages: REQ.messages, maxTokens: REQ.maxTokens, temperature: 0, thinking: 'disabled' },
      response: { content: '{"ok":true}', finishReason: 'stop', usage: { inputTokens: 11, outputTokens: 4, cacheHitTokens: null }, latencyMs: 321 },
      error: null,
    })
    const app = appWith({ LLM_MODE: 'replay', LLM_CASSETTE_DIR: cassettes, NEXTJS_ENV: 'test', DEEPSEEK_API_KEY: 'sk-test-abcdefgh', OWNER: user.id })
    const res = await app.request('/call', { method: 'POST' })
    const body = (await res.json()) as { ok: boolean; json: unknown; fromCassette: boolean }
    expect(body).toMatchObject({ ok: true, json: { ok: true }, fromCassette: true })
    const rows = await db.select().from(llmCalls).where(eq(llmCalls.importId, 42))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ownerId: 'owner-x', jobId: 7, mode: 'replay', latencyMs: 321, inputTokens: 11, cassetteKey: cassetteKey(REQ, 'disabled') })
  })

  it('returns the test override when present', async () => {
    const fake = { completeJson: async () => ({ ok: true, json: { fake: 1 }, raw: '', usage: { inputTokens: 0, outputTokens: 0, cacheHitTokens: null }, latencyMs: 0, model: 'm', finishReason: 'stop', fromCassette: false }) }
    const res = await appWith({ NEXTJS_ENV: 'test' }, fake).request('/call', { method: 'POST' })
    expect(await res.json()).toMatchObject({ json: { fake: 1 } })
  })
})
