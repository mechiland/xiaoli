// F1 (ARCHITECTURE §10): window failures through the real llm adapter in replay mode, from hand-written cassettes.
// Since wave 5 a window is TWO calls (extraction + interaction, in parallel), so every scenario has two cassettes in
// two version directories and replay has to hit both streams.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLlmClient, memoryCallLogger } from '@/server/llm'
import { buildCassettes, CASSETTE_DIR, FIXTURE_VERSIONS, SCENARIOS, scenarioChat, versionOf } from './__fixtures__/cassette-scenarios'
import { extractOffline } from './offline'
import { INTERACTION_PROMPT_VERSION } from './prompt-version'

const ROOT = path.resolve(__dirname, '../..')

describe('hand-written failure cassettes', () => {
  it('files match the scenarios (regenerate with server/extract/__fixtures__/build-cassettes.ts)', async () => {
    const built = (await Promise.all(SCENARIOS.map(buildCassettes))).flat()
    for (const version of FIXTURE_VERSIONS()) {
      const dir = path.join(ROOT, CASSETTE_DIR, version)
      const forVersion = built.filter((c) => c.promptVersion === version)
      expect(readdirSync(dir).sort()).toEqual(forVersion.map((c) => `${c.key}.json`).sort())
      for (const c of forVersion) expect(JSON.parse(readFileSync(path.join(dir, `${c.key}.json`), 'utf8'))).toEqual(JSON.parse(JSON.stringify(c)))
    }
  })

  it.each([
    ['ok', 'done', undefined, 1],
    ['invalid-json', 'retryable_error', 'invalid_json', 3],
    ['truncated', 'retryable_error', 'truncated', 3],
    ['timeout', 'retryable_error', 'timeout', 3],
    ['validation', 'retryable_error', 'validation_failed', 3],
    ['empty', 'retryable_error', 'llm_error', 3],
    ['interaction', 'done', undefined, 1],
    ['interaction-failed', 'done', undefined, 1],
  ])('%s → %s %s after %i attempt(s)', async (name, outcome, code, attempts) => {
    const scenario = SCENARIOS.find((s) => s.name === name)!
    const logger = memoryCallLogger()
    const llm = createLlmClient({ env: { NEXTJS_ENV: 'test' }, logger, mode: 'replay', cassetteDir: path.join(ROOT, CASSETTE_DIR), budget: null })
    const { parsed, mapping } = scenarioChat(scenario)
    const r = await extractOffline({ parsed, mapping, llm, promptVersion: versionOf(scenario), deadlinePolicy: 'app' })
    expect(r.windows).toHaveLength(1)
    expect(r.windows[0]).toMatchObject({ outcome, attempts, ...(code ? { code } : {}) })
    if (!code) expect(r.windows[0].code).toBeUndefined()
    // both cassette streams replay: no miss on either prompt version
    expect(logger.records.every((rec) => rec.mode === 'replay' && rec.error?.code !== 'cassette_miss')).toBe(true)
    expect(logger.records.some((rec) => rec.promptVersion === INTERACTION_PROMPT_VERSION)).toBe(true)

    if (name === 'ok') {
      expect(r.claims.map((c) => [c.person, c.statement, c.evidence])).toEqual([
        ['ming', '搬到了重庆', [1]],
        ['ming', '在一家设计公司上班', [1]],
      ])
      expect(r.windows[0].attemptMs[0]).toBeGreaterThanOrEqual(2_100)
    } else if (name !== 'interaction-failed') {
      expect(r.claims).toEqual([])
    }

    if (name === 'interaction') {
      // the interaction call through the real adapter: prompt rendering → replay → validation → memoryStore → offline result
      expect(r.windows[0].interaction).toBe('ok')
      expect(r.segments).toEqual([
        {
          startIdx: 0,
          endIdx: 2,
          startedAt: '2026-06-05 20:00',
          endedAt: '2026-06-05 20:03',
          messageCount: 3,
          summary: '对了柜子报价的进度，阿明说周五前给结果',
          topics: ['柜子', '报价'],
          participants: [
            { person: 'me', messageCount: 2 },
            { person: 'ming', messageCount: 1 },
          ],
          evidence: [0, 1],
          windowIndex: 0,
        },
      ])
      expect(r.loops).toEqual([
        { person: 'ming', direction: 'theirs', kind: 'promise', text: '周五前把柜子报价发过来', openedAt: '2026-06-05 20:02', openedIdx: 1, closedIdx: null, closedAt: null, closedReason: null, evidence: [1], windowIndex: 0 },
      ])
      expect(r.closes).toEqual([])
    } else if (name === 'interaction-failed') {
      // §6 failure isolation, end to end through the adapter: the interaction call timed out, the claim still landed.
      expect(r.windows[0].interaction).toBe('failed')
      expect(r.claims.map((c) => [c.person, c.statement])).toEqual([['ming', '做定制柜子']])
      expect(r.segments).toEqual([])
      expect(r.loops).toEqual([])
    } else {
      expect(r.segments).toEqual([])
      expect(r.loops).toEqual([])
    }
  })
})
