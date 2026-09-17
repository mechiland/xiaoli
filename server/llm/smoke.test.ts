// Replays the cassette recorded by the live smoke run (`node --import tsx server/llm/smoke.ts --live`). No network.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { cassetteDirFor } from './cassette'
import { createLlmClient } from './client'
import { memoryCallLogger } from './loggers'
import { SmokeOutputSchema, smokeRequest } from './smoke-request'

const ROOT = path.resolve(__dirname, '..', '..')

describe('live smoke cassette', () => {
  it('replays the recorded deepseek-flash JSON-mode response', async () => {
    const logger = memoryCallLogger()
    const llm = createLlmClient({
      env: {},
      logger,
      mode: 'replay',
      cassetteDir: path.join(ROOT, cassetteDirFor('synthetic')),
      budget: null,
      fetch: (async () => {
        throw new Error('replay must not use the network')
      }) as typeof fetch,
    })
    const r = await llm.completeJson(smokeRequest('deepseek-flash'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(SmokeOutputSchema.safeParse(r.json).success).toBe(true)
    expect(r).toMatchObject({ fromCassette: true, finishReason: 'stop', model: 'deepseek-flash' })
    expect(r.usage.inputTokens).toBeGreaterThan(0)
    expect(logger.records).toHaveLength(1)
    expect(logger.records[0]).toMatchObject({ mode: 'replay', promptVersion: 'llm-smoke.v1', error: null })
  })
})
