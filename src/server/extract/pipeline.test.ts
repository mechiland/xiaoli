// extractWindow: the two model calls of a window (ARCHITECTURE §6 — parallel dispatch, deadline slicing, failure
// isolation). DECISIONS I17 / ## extract X40.
import { describe, expect, it } from 'vitest'
import type { LlmClient, LlmError, LlmJsonRequest, LlmJsonResult } from '@/server/llm'
import { parsedChat, QUOTE_PROMISE, mappingFor } from './__fixtures__/chats'
import { memoryStore } from './memory-store'
import { extractWindow } from './pipeline'
import { INTERACTION_PROMPT_VERSION } from './prompt-version'
import type { WindowRef } from './types'

// All chat content is invented.
const MAPPING = mappingFor('柜子', 'private', { 山野: 'me', 阿明: 'ming' }, 'me')
const REF: WindowRef = { importId: 1, jobId: null, windowIndex: 0, startSeq: 0, endSeq: 2, focusStartSeq: 0, focusEndSeq: 2 }

const ok = (json: unknown, latencyMs = 500): LlmJsonResult => ({ ok: true, json, raw: JSON.stringify(json), usage: { inputTokens: 100, outputTokens: 10, cacheHitTokens: 0 }, latencyMs, model: 'deepseek-flash', finishReason: 'stop', fromCassette: false })
const errRes = (code: LlmError['code'], latencyMs = 200): LlmError => ({ ok: false, code, message: code, raw: null, retryable: true, latencyMs })

const CLAIM = { person: { personId: 2 }, statement: '做定制柜子', category: 'work', confidence: 0.9, sensitive: false, evidence: [2] }
const EXTRACTED = { newPersons: [], handles: [], relations: [], claims: [CLAIM], events: [], dates: [] }
const INTERACTED = {
  segment: { summary: '对了柜子报价的进度', topics: ['柜子'], speakers: [{ personId: 2 }], evidence: [1, 2] },
  loops: [{ person: { personId: 2 }, direction: 'theirs', kind: 'promise', text: '周五前把报价发过来', evidence: [2] }],
  closes: [],
}
const isInteraction = (req: LlmJsonRequest) => req.promptVersion.startsWith('interaction.')

function run(llm: LlmClient, over: { deadlineAt?: number; now?: () => number } = {}) {
  const store = memoryStore(parsedChat(QUOTE_PROMISE), MAPPING)
  return { store, outcome: extractWindow({ llm, store, model: 'deepseek-flash', ...over }, REF) }
}

describe('extractWindow: the two calls run in parallel', () => {
  it('dispatches the interaction call before the extraction call has resolved', async () => {
    const dispatched: string[] = []
    let sawInteraction!: () => void
    const interactionDispatched = new Promise<void>((resolve) => (sawInteraction = resolve))

    const llm: LlmClient = {
      async completeJson(req) {
        dispatched.push(isInteraction(req) ? 'interaction' : req.purpose)
        if (isInteraction(req)) {
          sawInteraction()
          return ok(INTERACTED)
        }
        // The extraction call only finishes once the interaction call has been dispatched. Sequentially, that never
        // happens and the race below fails with a message instead of hanging.
        await Promise.race([
          interactionDispatched,
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error('the interaction call was not dispatched while the extraction call was still pending: the two calls are sequential')), 2_000)),
        ])
        return ok(EXTRACTED)
      },
    }

    const { store, outcome } = run(llm)
    const r = await outcome
    expect(dispatched.slice(0, 2)).toEqual(['extract', 'interaction'])
    expect(r.status).toBe('done')
    // both landed: the claims from one call, the segment and loop from the other
    expect(store.result().claims.map((c) => c.statement)).toEqual(['做定制柜子'])
    expect(store.result().segments).toHaveLength(1)
    expect(store.result().loops).toHaveLength(1)
  })

  it('charges the attempt clock once for the pair: max, not sum', async () => {
    const llm: LlmClient = { async completeJson(req) { return isInteraction(req) ? ok(INTERACTED, 9_000) : ok(EXTRACTED, 11_000) } }
    const r = await run(llm, { deadlineAt: Date.now() + 28_000 }).outcome
    if (r.status !== 'done') throw new Error(r.message)
    // 11 s (the slower call), not 20 s
    expect(r.attemptMs).toBeGreaterThanOrEqual(11_000)
    expect(r.attemptMs).toBeLessThan(13_000)
    // the *reported* latency is still the sum: it is what the two calls cost, not how long the window waited
    expect(r.latencyMs).toBe(20_000)
  })
})

describe('extractWindow: failure isolation', () => {
  const failing = (mode: 'llm_error' | 'bad_json' | 'throws'): LlmClient => ({
    async completeJson(req) {
      if (!isInteraction(req)) return ok(EXTRACTED)
      if (mode === 'throws') throw new TypeError('boom')
      return mode === 'llm_error' ? errRes('timeout') : ok({ segment: 'not an object', loops: 'nope' })
    },
  })

  it.each([['llm_error'], ['bad_json'], ['throws']] as const)('a %s interaction call still leaves the window done and the claims persisted', async (mode) => {
    const { store, outcome } = run(failing(mode))
    const r = await outcome
    if (r.status !== 'done') throw new Error(`window failed: ${r.message}`)
    expect(r.interaction).toBe('failed')
    expect(r.itemsCreated).toBe(1)
    expect(store.result().claims.map((c) => c.statement)).toEqual(['做定制柜子'])
    expect(store.result().segments).toEqual([])
    expect(store.result().loops).toEqual([])
  })

  it('the reverse does not hold: a failed extraction call discards that attempt`s interaction result', async () => {
    const llm: LlmClient = { async completeJson(req) { return isInteraction(req) ? ok(INTERACTED) : errRes('invalid_json') } }
    const { store, outcome } = run(llm)
    const r = await outcome
    expect(r.status).toBe('retryable_error')
    expect(store.result().segments).toEqual([])
    expect(store.result().loops).toEqual([])
    expect(store.result().claims).toEqual([])
  })
})

describe('extractWindow: deadline slicing', () => {
  it('skips (does not fail) the interaction call when under 6 s remain at its start', async () => {
    // A clock the extraction call itself advances: by the time the interaction call would start, the request is
    // nearly out of time. `deps.now` is the injected clock, so nothing here waits in real time.
    let t = 1_000_000
    const now = () => t
    const dispatched: string[] = []
    const llm: LlmClient = {
      async completeJson(req) {
        dispatched.push(isInteraction(req) ? 'interaction' : req.purpose)
        if (!isInteraction(req)) t += 22_500 // consumed synchronously, before the interaction task gets to run
        await Promise.resolve()
        return isInteraction(req) ? ok(INTERACTED) : ok(EXTRACTED, 0)
      },
    }
    const { store, outcome } = run(llm, { deadlineAt: t + 28_000, now })
    const r = await outcome
    if (r.status !== 'done') throw new Error(`window failed: ${r.message}`)
    expect(dispatched).toEqual(['extract'])
    expect(r.interaction).toBe('skipped_deadline')
    // the claims are unaffected by the skip
    expect(store.result().claims.map((c) => c.statement)).toEqual(['做定制柜子'])
    expect(store.result().segments).toEqual([])
  })

  it('with room to spare both calls go out and get the same timeout budget', async () => {
    const reqs: LlmJsonRequest[] = []
    const llm: LlmClient = {
      async completeJson(req) {
        reqs.push(req)
        return isInteraction(req) ? ok(INTERACTED) : ok(EXTRACTED)
      },
    }
    const r = await run(llm, { deadlineAt: Date.now() + 28_000 }).outcome
    expect(r.status).toBe('done')
    const [extract, interaction] = [reqs.find((x) => !isInteraction(x))!, reqs.find(isInteraction)!]
    expect(interaction.timeoutMs).toBe(extract.timeoutMs)
    expect(extract.timeoutMs).toBeLessThanOrEqual(20_000)
    expect(extract.maxTransportRetries).toBe(0)
    expect(interaction.maxTransportRetries).toBe(0)
    // the interaction call is logged under its own prompt version and a purpose of its own, so cost reads separately
    expect(interaction.promptVersion).toBe(INTERACTION_PROMPT_VERSION)
    expect(interaction.purpose).not.toBe('extract')
    expect(interaction.purpose).not.toBe('dedup')
  })

  it('an empty window makes no call at all', async () => {
    const llm: LlmClient = { async completeJson() { throw new Error('should not be called') } }
    const store = memoryStore(parsedChat(QUOTE_PROMISE), MAPPING)
    const r = await extractWindow({ llm, store, model: 'deepseek-flash' }, { ...REF, startSeq: 50, endSeq: 60 })
    if (r.status !== 'done') throw new Error('unexpected')
    expect(r.interaction).toBe('not_needed')
    expect(r.dedup).toBe('not_needed')
  })
})
