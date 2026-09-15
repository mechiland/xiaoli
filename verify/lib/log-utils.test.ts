import { describe, expect, it } from 'vitest'
import {
  evaluate,
  isExpected,
  isExpectedConsole,
  median,
  parseServerTiming,
  resolveKeys,
  sanitizeUrl,
  scenarioDirName,
  selectScenarios,
  timestampDir,
} from './log-utils'
import type { VerifyLog } from './types'

const emptyLog = (): Omit<VerifyLog, 'passed' | 'failureReasons'> => ({
  scenario: 'x/y',
  description: null,
  startedAt: '',
  finishedAt: '',
  baseUrl: 'http://localhost:3000',
  account: 'seed',
  commit: null,
  widths: [{ width: 1440, steps: [{ name: 'a', startedAt: '', durationMs: 1, ok: true }], screenshots: [] }],
  consoleErrors: [],
  consoleWarnings: [],
  failedRequests: [],
  abortedRequests: [],
  apiNon2xx: [],
  pageLoads: [],
  apiTimings: [],
  budgets: [],
  checks: [],
  notes: [],
})

describe('verify log utils', () => {
  it('strips search text from URLs', () => {
    expect(sanitizeUrl('http://localhost:3000/api/search?q=%E6%B1%89%E4%B8%AD&limit=20')).toBe('http://localhost:3000/api/search?q=&limit=20')
    expect(sanitizeUrl('http://localhost:3000/p/1')).toBe('http://localhost:3000/p/1')
  })

  it('median and Server-Timing parsing', () => {
    expect(median([])).toBeNull()
    expect(median([30, 10, 20])).toBe(20)
    expect(median([10, 20, 30, 40])).toBe(25)
    expect(parseServerTiming('app;dur=12.5')).toBe(12.5)
    expect(parseServerTiming('db;dur=3, app;dur=41')).toBe(41)
    expect(parseServerTiming('db;dur=3')).toBeNull()
    expect(parseServerTiming(null)).toBeNull()
  })

  it('matches expected failures by url, status and step', () => {
    const exp = [{ urlPattern: '/api/people/', status: 500, step: 'error-state' }]
    expect(isExpected(exp, { url: 'http://h/api/people/3', step: 'error-state', status: 500 })).toBe(true)
    expect(isExpected(exp, { url: 'http://h/api/people/3', step: 'other', status: 500 })).toBe(false)
    expect(isExpected(exp, { url: 'http://h/api/people/3', step: 'error-state', status: 404 })).toBe(false)
    expect(isExpected([{ urlPattern: /\/api\/home$/ }], { url: 'http://h/api/home', step: 's' })).toBe(true)
    expect(
      isExpectedConsole(exp, undefined, {
        text: 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
        step: 'error-state',
        location: 'http://h/api/people/3',
      }),
    ).toBe(true)
    expect(isExpectedConsole(exp, undefined, { text: 'TypeError: boom', step: 'error-state' })).toBe(false)
    expect(isExpectedConsole([], ['Download the React DevTools'], { text: 'Download the React DevTools for a better…', step: 's' })).toBe(true)
  })

  it('passes only with all steps ok, no unexpected errors, budgets and checks passed', () => {
    expect(evaluate(emptyLog()).passed).toBe(true)

    const withExpected = emptyLog()
    withExpected.apiNon2xx.push({ width: 1440, step: 'a', url: '/api/x', method: 'GET', status: 500, expected: true })
    expect(evaluate(withExpected).passed).toBe(true)

    const bad = emptyLog()
    bad.widths[0].steps.push({ name: 'b', startedAt: '', durationMs: 1, ok: false, error: 'boom' })
    bad.consoleErrors.push({ width: 1440, step: 'b', type: 'error', text: 'x', expected: false })
    bad.failedRequests.push({ width: 1440, step: 'b', url: '/x', method: 'GET', failure: 'net::ERR_FAILED', expected: false })
    bad.budgets.push({ width: 1440, name: 'P2', kind: 'page-ttfb', target: 300, samplesMs: [], statisticMs: null, passed: false, missing: true, note: 'placeholder' })
    bad.checks.push({ width: 1440, step: 'b', name: 'c', passed: false })
    const r = evaluate(bad)
    expect(r.passed).toBe(false)
    expect(r.failureReasons).toHaveLength(5)
    expect(r.failureReasons.join('\n')).toContain('missing')
  })

  it('selects scenarios by id, dir, alias and comma list', () => {
    const ids = ['_smoke/home-loads', '_smoke/perf-budgets', 'person/showcase', 'e2e/blind-shots']
    expect(selectScenarios(['smoke'], ids).selected).toEqual(['_smoke/home-loads'])
    expect(selectScenarios(['_smoke'], ids).selected).toEqual(['_smoke/home-loads', '_smoke/perf-budgets'])
    expect(selectScenarios(['perf,person/showcase'], ids).selected).toEqual(['_smoke/perf-budgets', 'person/showcase'])
    expect(selectScenarios(['nope'], ids).unknown).toEqual(['nope'])
  })

  it('formats dirs and keys', () => {
    expect(scenarioDirName('person/showcase')).toBe('person__showcase')
    expect(timestampDir(new Date(2026, 8, 15, 7, 5, 9))).toBe('20260915-070509')
    expect(resolveKeys('Mod+K', 'linux')).toBe('Control+K')
    expect(resolveKeys('Mod+K', 'darwin')).toBe('Meta+K')
  })
})
