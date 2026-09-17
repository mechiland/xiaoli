import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { llmModeFromArgs } from './modes'
import { redactSecrets } from './redact'
import { summarizeUsage } from './usage'
import { cassetteDirFor, cassetteRelPath } from './cassette'
import { parseRetryAfter, parseUsage } from './deepseek'

describe('summarizeUsage', () => {
  it('sums live/record tokens, counts replay and errors separately', () => {
    const base = { purpose: 'extract' as const, model: 'deepseek-flash', cacheHitTokens: 1, error: null }
    const s = summarizeUsage([
      { ...base, mode: 'live', inputTokens: 100, outputTokens: 10 },
      { ...base, mode: 'record', inputTokens: 50, outputTokens: 5, purpose: 'judge' },
      { ...base, mode: 'replay', inputTokens: 1000, outputTokens: 1000 },
      { ...base, mode: 'live', inputTokens: null, outputTokens: null, cacheHitTokens: null, error: { code: 'budget_exceeded', message: 'x' } },
    ])
    expect(s).toMatchObject({ calls: 4, liveCalls: 3, replayCalls: 1, errorCalls: 1, inputTokens: 150, outputTokens: 15, totalTokens: 165, cacheHitTokens: 2 })
    expect(s.errorsByCode).toEqual({ budget_exceeded: 1 })
    expect(s.byPurpose.judge).toEqual({ calls: 1, inputTokens: 50, outputTokens: 5 })
    expect(summarizeUsage([{ ...base, mode: 'replay', inputTokens: 7, outputTokens: 3 }], { includeReplay: true }).totalTokens).toBe(10)
  })
})

describe('llmModeFromArgs', () => {
  it('maps --live to record, --live --no-record to live, default replay', () => {
    expect(llmModeFromArgs([])).toBe('replay')
    expect(llmModeFromArgs(['x.zip', '--live'])).toBe('record')
    expect(llmModeFromArgs(['--live', '--no-record'])).toBe('live')
    expect(llmModeFromArgs(['--llm-mode=live'])).toBe('live')
    expect(llmModeFromArgs([], 'live')).toBe('live')
    expect(() => llmModeFromArgs(['--llm-mode=nope'])).toThrow()
  })
})

describe('helpers', () => {
  it('redacts keys, bearer tokens and api key echoes', () => {
    const key = 'sk-abcdef0123456789'
    const out = redactSecrets(`key ${key} Bearer abc.def api key: sk-12**89 raw`, key)
    expect(out).not.toContain('abcdef0123456789')
    expect(out).not.toContain('abc.def')
    expect(out).not.toContain('sk-12**89')
  })

  it('parses usage and retry-after', () => {
    expect(parseUsage({ prompt_tokens: 3, completion_tokens: 2, prompt_cache_hit_tokens: 1 })).toEqual({ inputTokens: 3, outputTokens: 2, cacheHitTokens: 1 })
    expect(parseUsage(undefined)).toBeNull()
    expect(parseRetryAfter('1.5', 0)).toBe(1500)
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6_000)
    expect(parseRetryAfter(null, 0)).toBeNull()
  })

  it('cassette dirs by data origin', () => {
    expect(cassetteDirFor('synthetic')).toBe('fixtures/cassettes/synthetic')
    expect(cassetteDirFor('real')).toBe('fixtures/cassettes/real')
    expect(cassetteRelPath('extract.v1', 'a'.repeat(32))).toBe(`extract.v1/${'a'.repeat(32)}.json`)
    expect(cassetteRelPath('..', 'k')).toBe('_/k.json')
  })
})

describe('worker safety', () => {
  const root = path.dirname(new URL(import.meta.url).pathname)
  const files = readdirSync(root)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && statSync(path.join(root, f)).isFile())
    .filter((f) => f !== 'smoke.ts') // CLI script
  it('non-node files have no static Node imports and reach ./node only via import() or import type', () => {
    expect(files).toContain('index.ts')
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(path.join(root, f), 'utf8')
      for (const line of src.split('\n')) {
        if (/^\s*import\s(?!type\b)[^()]*from\s+['"](node:[^'"]+|fs|path|os|child_process|crypto)['"]/.test(line)) offenders.push(`${f}: ${line.trim()}`)
        if (/^\s*import\s(?!type\b)[^()]*from\s+['"]\.\/node\//.test(line)) offenders.push(`${f}: ${line.trim()}`)
        if (/\brequire\(/.test(line)) offenders.push(`${f}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
