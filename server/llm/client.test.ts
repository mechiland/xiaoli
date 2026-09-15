// Adapter behaviour with a scripted fetch and in-memory stores. No network.
import { describe, expect, it } from 'vitest'
import { memoryBudget } from './budget'
import { cassetteKey, memoryCassetteStore, type Cassette } from './cassette'
import { createLlmClient, type CreateLlmClientOptions } from './client'
import { memoryCallLogger } from './loggers'
import { LlmRequestError, type LlmError, type LlmJsonRequest, type LlmJsonResult } from './types'

const TEST_KEY = 'sk-test-0123456789abcdef'
const ENV = { DEEPSEEK_API_KEY: TEST_KEY, DEEPSEEK_BASE_URL: 'https://llm.example.test/', LLM_THINKING: 'disabled' as const, NEXTJS_ENV: 'test' }

function req(over: Partial<LlmJsonRequest> = {}): LlmJsonRequest {
  return {
    purpose: 'other',
    promptVersion: 'test.v1',
    model: 'deepseek-flash',
    messages: [
      { role: 'system', content: '只输出 json，格式示例：{"city": "城市名"}' },
      { role: 'user', content: '合成消息：我住在示例市。' },
    ],
    maxTokens: 100,
    ...over,
  }
}

function completion(content: string | null, opts: { finish?: string; usage?: Record<string, unknown> } = {}) {
  return new Response(
    JSON.stringify({
      id: 'cmpl-test',
      model: 'deepseek-flash',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: opts.finish ?? 'stop' }],
      usage: opts.usage ?? { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 30 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

type Step = Response | Error | ((init: RequestInit) => Promise<Response>)

function setup(steps: Step[], over: Partial<CreateLlmClientOptions> = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]
    if (!step) throw new Error('no scripted response')
    if (step instanceof Error) throw step
    if (typeof step === 'function') return step(init ?? {})
    return step.clone()
  }) as typeof fetch
  const logger = memoryCallLogger()
  const budget = memoryBudget(1_000_000)
  const store = memoryCassetteStore()
  const sleeps: number[] = []
  const client = createLlmClient({
    env: ENV,
    logger,
    mode: 'live',
    budget,
    cassetteStore: store,
    fetch: fetchFn,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    ...over,
  })
  return { client, calls, logger, budget, store, sleeps }
}

const asErr = (r: LlmJsonResult | LlmError) => {
  expect(r.ok).toBe(false)
  return r as LlmError
}
const asOk = (r: LlmJsonResult | LlmError) => {
  expect(r.ok).toBe(true)
  return r as LlmJsonResult
}

describe('createLlmClient — live', () => {
  it('sends an OpenAI-compatible JSON-mode request and returns parsed JSON', async () => {
    const t = setup([completion('{"city":"示例市"}')])
    const r = asOk(await t.client.completeJson(req({ context: { ownerId: 'u1', importId: 3, jobId: 9, evalRunId: null } })))
    expect(r.json).toEqual({ city: '示例市' })
    expect(r.usage).toEqual({ inputTokens: 50, outputTokens: 10, cacheHitTokens: 20 })
    expect(r.fromCassette).toBe(false)
    expect(r.finishReason).toBe('stop')

    expect(t.calls).toHaveLength(1)
    expect(t.calls[0].url).toBe('https://llm.example.test/chat/completions')
    const headers = t.calls[0].init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${TEST_KEY}`)
    const body = JSON.parse(String(t.calls[0].init.body))
    expect(body).toEqual({
      model: 'deepseek-flash',
      messages: req().messages,
      response_format: { type: 'json_object' },
      max_tokens: 100,
      temperature: 0,
      thinking: { type: 'disabled' },
      stream: false,
    })

    expect(t.logger.records).toHaveLength(1)
    const rec = t.logger.records[0]
    expect(rec).toMatchObject({
      ownerId: 'u1',
      importId: 3,
      jobId: 9,
      provider: 'deepseek',
      model: 'deepseek-flash',
      promptVersion: 'test.v1',
      purpose: 'other',
      mode: 'live',
      attempt: 1,
      inputTokens: 50,
      outputTokens: 10,
      cacheHitTokens: 20,
      rawOutput: '{"city":"示例市"}',
      finishReason: 'stop',
      error: null,
      cassetteKey: cassetteKey(req(), 'disabled'),
    })
    expect(t.budget.state).toEqual({ inputTokens: 50, outputTokens: 10 })
    expect(t.store.entries.size).toBe(0) // live never writes cassettes
  })

  it('passes thinking=enabled from env and reads cache hits under prompt_tokens_details', async () => {
    const t = setup([completion('{"a":1}', { usage: { prompt_tokens: 5, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } } })], {
      env: { ...ENV, LLM_THINKING: 'enabled' },
    })
    const r = asOk(await t.client.completeJson(req()))
    expect(JSON.parse(String(t.calls[0].init.body)).thinking).toEqual({ type: 'enabled' })
    expect(r.usage.cacheHitTokens).toBe(4)
  })

  it('retries empty content with 1s/3s backoff and logs each attempt', async () => {
    const t = setup([completion(''), completion('   '), completion('{"ok":true}')])
    const r = asOk(await t.client.completeJson(req()))
    expect(r.json).toEqual({ ok: true })
    expect(t.sleeps).toEqual([1000, 3000])
    expect(t.logger.records.map((x) => [x.attempt, x.error?.code ?? null])).toEqual([
      [1, 'empty_content'],
      [2, 'empty_content'],
      [3, null],
    ])
    expect(t.budget.state.inputTokens).toBe(150) // failed attempts still billed
  })

  it('gives up on http_5xx after maxTransportRetries', async () => {
    const t = setup([new Response('{"error":{"message":"overloaded"}}', { status: 503 })])
    const e = asErr(await t.client.completeJson(req({ maxTransportRetries: 1 })))
    expect(e.code).toBe('http_5xx')
    expect(e.retryable).toBe(true)
    expect(e.message).toContain('503')
    expect(t.calls).toHaveLength(2)
  })

  it('honours retry-after on 429', async () => {
    const t = setup([new Response('{}', { status: 429, headers: { 'retry-after': '2' } }), completion('{"x":1}')])
    asOk(await t.client.completeJson(req()))
    expect(t.sleeps).toEqual([2000])
    expect(t.logger.records[0].error?.code).toBe('rate_limited')
  })

  it('does not retry 4xx and never leaks the key into errors or records', async () => {
    const t = setup([new Response(JSON.stringify({ error: { message: `Authentication Fails, Your api key: ${TEST_KEY} is invalid` } }), { status: 401 })])
    const e = asErr(await t.client.completeJson(req()))
    expect(e.code).toBe('http_4xx')
    expect(e.retryable).toBe(false)
    expect(t.calls).toHaveLength(1)
    expect(JSON.stringify(e)).not.toContain(TEST_KEY)
    expect(JSON.stringify(t.logger.records)).not.toContain(TEST_KEY)
    expect(JSON.stringify(t.logger.records)).not.toContain('0123456789abcdef')
  })

  it('retries network errors and redacts their messages', async () => {
    const t = setup([new TypeError(`fetch failed for Bearer ${TEST_KEY}`), completion('{"x":1}')])
    asOk(await t.client.completeJson(req()))
    expect(t.logger.records[0].error?.code).toBe('network')
    expect(t.logger.records[0].error?.message).not.toContain(TEST_KEY)
  })

  it('maps invalid JSON and finish_reason=length without adapter retries', async () => {
    const bad = setup([completion('{"city": 示例')])
    const e1 = asErr(await bad.client.completeJson(req()))
    expect(e1).toMatchObject({ code: 'invalid_json', raw: '{"city": 示例', retryable: true })
    expect(bad.calls).toHaveLength(1)

    const cut = setup([completion('{"city": "示', { finish: 'length' })])
    const e2 = asErr(await cut.client.completeJson(req()))
    expect(e2).toMatchObject({ code: 'truncated', retryable: false, finishReason: 'length' })
    expect(cut.calls).toHaveLength(1)
  })

  it('accepts a fenced JSON block', async () => {
    const t = setup([completion('```json\n{"a":1}\n```')])
    expect(asOk(await t.client.completeJson(req())).json).toEqual({ a: 1 })
  })

  it('times out an attempt at timeoutMs', async () => {
    const hang = (init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    const t = setup([hang])
    const e = asErr(await t.client.completeJson(req({ timeoutMs: 30, maxTransportRetries: 0 })))
    expect(e.code).toBe('timeout')
    expect(e.retryable).toBe(true)
  })

  it('caps the attempt at the deadline and reports code deadline', async () => {
    let now = 1_000_000
    const hang = (init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    const t = setup([hang], { now: () => now })
    const e = asErr(await t.client.completeJson(req({ timeoutMs: 20_000, deadlineAt: now + 1_050 })))
    expect(e.code).toBe('deadline')
    expect(e.retryable).toBe(false)

    now = 2_000_000
    const t2 = setup([completion('{}')], { now: () => now })
    const e2 = asErr(await t2.client.completeJson(req({ deadlineAt: now + 999 })))
    expect(e2.code).toBe('deadline')
    expect(t2.calls).toHaveLength(0)
  })

  it('does not sleep past the deadline for a retry', async () => {
    const now = 5_000_000
    const t = setup([new Response('{}', { status: 500 })], { now: () => now })
    const e = asErr(await t.client.completeJson(req({ deadlineAt: now + 1_500 })))
    expect(e.code).toBe('http_5xx')
    expect(t.calls).toHaveLength(1)
    expect(t.sleeps).toEqual([])
  })

  it('refuses live calls once the budget is used up', async () => {
    const t = setup([completion('{}')], { budget: memoryBudget(100, { inputTokens: 90, outputTokens: 10 }) })
    const e = asErr(await t.client.completeJson(req()))
    expect(e).toMatchObject({ code: 'budget_exceeded', retryable: false })
    expect(t.calls).toHaveLength(0)
    expect(t.logger.records[0].error?.code).toBe('budget_exceeded')
  })

  it('fails closed when the budget cannot be read', async () => {
    const broken = { limit: 10, used: async () => Promise.reject(new Error('corrupt')), add: async () => {} }
    const t = setup([completion('{}')], { budget: broken })
    expect(asErr(await t.client.completeJson(req())).code).toBe('budget_exceeded')
    expect(t.calls).toHaveLength(0)
  })

  it('returns http_4xx without calling out when the key is missing', async () => {
    const t = setup([completion('{}')], { env: { ...ENV, DEEPSEEK_API_KEY: undefined } })
    const e = asErr(await t.client.completeJson(req()))
    expect(e.code).toBe('http_4xx')
    expect(e.message).toContain('DEEPSEEK_API_KEY')
    expect(t.calls).toHaveLength(0)
  })

  it('keeps working when the logger throws', async () => {
    const t = setup([completion('{"a":1}')], { logger: { log: async () => Promise.reject(new Error('db down')) } })
    asOk(await t.client.completeJson(req()))
  })

  it('requires a budget for live and record', () => {
    expect(() => createLlmClient({ env: ENV, logger: memoryCallLogger(), mode: 'live', budget: null })).toThrow(LlmRequestError)
    expect(() => createLlmClient({ env: ENV, logger: memoryCallLogger(), mode: 'record', budget: null })).toThrow(LlmRequestError)
    expect(() => createLlmClient({ env: ENV, logger: memoryCallLogger(), mode: 'replay', budget: null })).not.toThrow()
  })

  it('asserts JSON-mode prompts outside production', async () => {
    const t = setup([completion('{}')])
    const noJson = req({ messages: [{ role: 'user', content: '请输出结果 {"a":1}' }] })
    await expect(t.client.completeJson(noJson)).rejects.toThrow(/json/)
    const noExample = req({ messages: [{ role: 'user', content: '请输出 json' }] })
    await expect(t.client.completeJson(noExample)).rejects.toThrow(/example/)
    await expect(t.client.completeJson(req({ maxTokens: 0 }))).rejects.toThrow(LlmRequestError)

    const prod = setup([completion('{}')], { env: { ...ENV, NEXTJS_ENV: 'production' } })
    asOk(await prod.client.completeJson(noJson))
  })
})

describe('createLlmClient — record & replay', () => {
  it('record writes a cassette that replay returns without network', async () => {
    const rec = setup([completion('{"city":"示例市"}')], { mode: 'record' })
    asOk(await rec.client.completeJson(req()))
    const key = cassetteKey(req(), 'disabled')
    const cas = await rec.store.read('test.v1', key)
    expect(cas).toMatchObject({
      key,
      model: 'deepseek-flash',
      promptVersion: 'test.v1',
      purpose: 'other',
      request: { messages: req().messages, maxTokens: 100, temperature: 0, thinking: 'disabled' },
      response: { content: '{"city":"示例市"}', finishReason: 'stop', usage: { inputTokens: 50, outputTokens: 10, cacheHitTokens: 20 } },
      error: null,
    })

    const rep = setup([new Error('network must not be used in replay')], { mode: 'replay', budget: null, cassetteStore: rec.store })
    const r = asOk(await rep.client.completeJson(req()))
    expect(r.json).toEqual({ city: '示例市' })
    expect(r.fromCassette).toBe(true)
    expect(rep.calls).toHaveLength(0)
    expect(rep.logger.records[0]).toMatchObject({ mode: 'replay', attempt: 1, cassetteKey: key, inputTokens: 50, error: null })
  })

  it('replay miss is a clear error and never calls the network', async () => {
    const t = setup([new Error('network must not be used in replay')], { mode: 'replay', budget: null })
    const e = asErr(await t.client.completeJson(req()))
    expect(e.code).toBe('cassette_miss')
    expect(e.retryable).toBe(false)
    expect(e.message).toContain(cassetteKey(req(), 'disabled'))
    expect(t.calls).toHaveLength(0)
    expect(t.logger.records[0].error?.code).toBe('cassette_miss')

    const noDir = setup([], { mode: 'replay', budget: null, cassetteStore: undefined })
    expect(asErr(await noDir.client.completeJson(req())).code).toBe('cassette_miss')
  })

  it('cassette key changes with any keyed field and ignores extra message fields', () => {
    const base = cassetteKey(req(), 'disabled')
    expect(base).toMatch(/^[0-9a-f]{32}$/)
    expect(cassetteKey(req({ temperature: 0 }), 'disabled')).toBe(base)
    expect(cassetteKey(req({ timeoutMs: 1, deadlineAt: 5, context: { ownerId: 'x' } }), 'disabled')).toBe(base)
    const extra = req({ messages: req().messages.map((m) => ({ ...m, name: 'ignored' }) as typeof m) })
    expect(cassetteKey(extra, 'disabled')).toBe(base)
    for (const other of [
      cassetteKey(req(), 'enabled'),
      cassetteKey(req({ temperature: 0.5 }), 'disabled'),
      cassetteKey(req({ maxTokens: 101 }), 'disabled'),
      cassetteKey(req({ model: 'deepseek-v4-pro' }), 'disabled'),
      cassetteKey(req({ promptVersion: 'test.v2' }), 'disabled'),
      cassetteKey(req({ purpose: 'judge' }), 'disabled'),
    ])
      expect(other).not.toBe(base)
  })

  const handWritten = (over: Partial<Cassette>): Cassette => ({
    key: cassetteKey(req(), 'disabled'),
    recordedAt: '2026-09-15T00:00:00.000Z',
    model: 'deepseek-flash',
    promptVersion: 'test.v1',
    purpose: 'other',
    request: { messages: req().messages, maxTokens: 100, temperature: 0, thinking: 'disabled' },
    response: null,
    error: null,
    ...over,
  })

  it('replays hand-written failure cassettes as the same outcomes', async () => {
    const cases: [Partial<Cassette>, string][] = [
      [{ response: { content: '{"broken', finishReason: 'stop', usage: null, latencyMs: 10 } }, 'invalid_json'],
      [{ response: { content: '{"a":', finishReason: 'length', usage: null, latencyMs: 10 } }, 'truncated'],
      [{ response: { content: '', finishReason: 'stop', usage: null, latencyMs: 10 } }, 'empty_content'],
      [{ error: { code: 'timeout', message: '', latencyMs: 20_000 } }, 'timeout'],
    ]
    for (const [over, code] of cases) {
      const store = memoryCassetteStore([handWritten(over)])
      const t = setup([], { mode: 'replay', budget: null, cassetteStore: store })
      const e = asErr(await t.client.completeJson(req()))
      expect(e.code).toBe(code)
      expect(e.fromCassette).toBe(true)
      expect(t.logger.records).toHaveLength(1) // no transport retries in replay
    }
  })

  it('replays a recorded completion slower than the attempt limit as timeout', async () => {
    const store = memoryCassetteStore([handWritten({ response: { content: '{"a":1}', finishReason: 'stop', usage: null, latencyMs: 8_000 } })])
    const t = setup([], { mode: 'replay', budget: null, cassetteStore: store })
    expect(asErr(await t.client.completeJson(req({ timeoutMs: 5_000 }))).code).toBe('timeout')
    expect(asOk(await t.client.completeJson(req({ timeoutMs: 9_000 }))).latencyMs).toBe(8_000)
  })

  it('record keeps an existing completion when a later attempt fails transiently, and records errors when nothing exists', async () => {
    const ok = setup([completion('{"a":1}')], { mode: 'record' })
    asOk(await ok.client.completeJson(req()))
    const failing = setup([new Response('{}', { status: 500 })], { mode: 'record', cassetteStore: ok.store })
    asErr(await failing.client.completeJson(req({ maxTransportRetries: 0 })))
    expect((await ok.store.read('test.v1', cassetteKey(req(), 'disabled')))?.response?.content).toBe('{"a":1}')

    const fresh = setup([new Response('{}', { status: 500 })], { mode: 'record' })
    asErr(await fresh.client.completeJson(req({ maxTransportRetries: 0 })))
    const cas = await fresh.store.read('test.v1', cassetteKey(req(), 'disabled'))
    expect(cas?.error?.code).toBe('http_5xx')

    const badKey = setup([new Response('{}', { status: 401 })], { mode: 'record' })
    asErr(await badKey.client.completeJson(req()))
    expect(badKey.store.entries.size).toBe(0) // environment errors are not recorded
  })

  it('record overwrites with a newer completion, including invalid JSON', async () => {
    const t = setup([completion('{"a":1}'), completion('not json')], { mode: 'record' })
    asOk(await t.client.completeJson(req()))
    asErr(await t.client.completeJson(req()))
    expect((await t.store.read('test.v1', cassetteKey(req(), 'disabled')))?.response?.content).toBe('not json')
  })
})
