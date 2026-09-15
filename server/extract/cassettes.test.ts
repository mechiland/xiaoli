// F1 (ARCHITECTURE §10): window failures through the real llm adapter in replay mode, from hand-written cassettes.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLlmClient, memoryCallLogger } from '@/server/llm'
import { buildCassette, CASSETTE_DIR, FIXTURE_PROMPT_VERSION, SCENARIOS, scenarioChat } from './__fixtures__/cassette-scenarios'
import { extractOffline } from './offline'

const ROOT = path.resolve(__dirname, '../..')

describe('hand-written failure cassettes', () => {
  it('files match the scenarios (regenerate with server/extract/__fixtures__/build-cassettes.ts)', async () => {
    const dir = path.join(ROOT, CASSETTE_DIR, FIXTURE_PROMPT_VERSION)
    const built = await Promise.all(SCENARIOS.map(buildCassette))
    expect(readdirSync(dir).sort()).toEqual(built.map((c) => `${c.key}.json`).sort())
    for (const c of built) expect(JSON.parse(readFileSync(path.join(dir, `${c.key}.json`), 'utf8'))).toEqual(JSON.parse(JSON.stringify(c)))
  })

  it.each([
    ['ok', 'done', undefined, 1],
    ['invalid-json', 'retryable_error', 'invalid_json', 3],
    ['truncated', 'retryable_error', 'truncated', 3],
    ['timeout', 'retryable_error', 'timeout', 3],
    ['validation', 'retryable_error', 'validation_failed', 3],
    ['empty', 'retryable_error', 'llm_error', 3],
  ])('%s → %s %s after %i attempt(s)', async (name, outcome, code, attempts) => {
    const scenario = SCENARIOS.find((s) => s.name === name)!
    const logger = memoryCallLogger()
    const llm = createLlmClient({ env: { NEXTJS_ENV: 'test' }, logger, mode: 'replay', cassetteDir: path.join(ROOT, CASSETTE_DIR), budget: null })
    const { parsed, mapping } = scenarioChat(scenario)
    const r = await extractOffline({ parsed, mapping, llm, promptVersion: FIXTURE_PROMPT_VERSION, deadlinePolicy: 'app' })
    expect(r.windows).toHaveLength(1)
    expect(r.windows[0]).toMatchObject({ outcome, attempts, ...(code ? { code } : {}) })
    if (!code) expect(r.windows[0].code).toBeUndefined()
    expect(logger.records.every((rec) => rec.mode === 'replay' && rec.error?.code !== 'cassette_miss')).toBe(true)
    if (name === 'ok') {
      expect(r.claims.map((c) => [c.person, c.statement, c.evidence])).toEqual([
        ['ming', '搬到了重庆', [1]],
        ['ming', '在一家设计公司上班', [1]],
      ])
      expect(r.windows[0].attemptMs[0]).toBeGreaterThanOrEqual(2_100)
    } else {
      expect(r.claims).toEqual([])
    }
  })
})
