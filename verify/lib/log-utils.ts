// Pure helpers for the verify log (unit-tested in verify/lib/log-utils.test.ts).
import type { ExpectedFailure, VerifyLog } from './types'

/** Strips values of `q=` (search text) from logged URLs (ARCHITECTURE §8). */
export function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.searchParams.has('q')) u.searchParams.set('q', '_')
    return u.toString().replace('q=_', 'q=')
  } catch {
    return url.replace(/([?&]q=)[^&#]*/g, '$1')
  }
}

/** Path + query relative to base (for compact logs). */
export function relUrl(url: string, base: string): string {
  const s = sanitizeUrl(url)
  return s.startsWith(base) ? s.slice(base.length) || '/' : s
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** `app;dur=12.3, db;dur=4` → 12.3 (the `app` entry). */
export function parseServerTiming(header: string | undefined | null, name = 'app'): number | null {
  if (!header) return null
  for (const part of header.split(',')) {
    const [metric, ...params] = part.trim().split(';')
    if (metric.trim() !== name) continue
    for (const p of params) {
      const [k, v] = p.trim().split('=')
      if (k === 'dur' && v !== undefined && !Number.isNaN(Number(v))) return Number(v)
    }
  }
  return null
}

export function matchesPattern(url: string, pattern: string | RegExp): boolean {
  return typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)
}

export function isExpected(
  expected: ExpectedFailure[] | undefined,
  hit: { url: string; step: string; status?: number },
): boolean {
  return (expected ?? []).some(
    (e) =>
      matchesPattern(hit.url, e.urlPattern) &&
      (e.step === undefined || e.step === hit.step) &&
      (e.status === undefined || hit.status === undefined || e.status === hit.status),
  )
}

export function isExpectedConsole(
  expected: ExpectedFailure[] | undefined,
  allow: string[] | undefined,
  hit: { text: string; step: string; location?: string },
): boolean {
  if ((allow ?? []).some((a) => hit.text.includes(a))) return true
  return (expected ?? []).some((e) => {
    if (e.step !== undefined && e.step !== hit.step) return false
    if (e.consoleText && hit.text.includes(e.consoleText)) return true
    // Chrome logs "Failed to load resource: the server responded with a status of 500" with the URL as location.
    if (/Failed to load resource/.test(hit.text) && hit.location && matchesPattern(hit.location, e.urlPattern)) {
      return e.status === undefined || hit.text.includes(`status of ${e.status}`)
    }
    return false
  })
}

/** Computes `passed` and human-readable reasons from a finished log. */
export function evaluate(log: Omit<VerifyLog, 'passed' | 'failureReasons'>): { passed: boolean; failureReasons: string[] } {
  const reasons: string[] = []
  for (const w of log.widths) {
    for (const s of w.steps) if (!s.ok) reasons.push(`[${w.width}] step failed: ${s.name}${s.error ? ` — ${s.error.split('\n')[0]}` : ''}`)
  }
  const ce = log.consoleErrors.filter((e) => !e.expected)
  if (ce.length) reasons.push(`${ce.length} console error(s)`)
  const fr = log.failedRequests.filter((r) => !r.expected)
  if (fr.length) reasons.push(`${fr.length} failed request(s)`)
  const an = log.apiNon2xx.filter((r) => !r.expected)
  if (an.length) reasons.push(`${an.length} unexpected non-2xx /api response(s)`)
  for (const b of log.budgets) {
    if (!b.passed) reasons.push(b.missing ? `budget ${b.name}: missing (${b.note ?? 'not implemented yet'})` : `budget ${b.name}: ${b.statisticMs} ms > ${b.target} ms`)
  }
  for (const c of log.checks) if (!c.passed) reasons.push(`[${c.width}] check failed: ${c.name}`)
  return { passed: reasons.length === 0, failureReasons: reasons }
}

/** `person/showcase` → `person__showcase` */
export function scenarioDirName(id: string): string {
  return id.replace(/\//g, '__')
}

/** Local time `YYYYMMDD-HHmmss`. */
export function timestampDir(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 'Mod+K' → 'Control+K' (or Meta on darwin). */
export function resolveKeys(keys: string, platform: string = process.platform): string {
  return keys.replace(/\bMod\b/g, platform === 'darwin' ? 'Meta' : 'Control')
}

/** Aliases accepted on the CLI in addition to scenario ids and directories. */
export const SCENARIO_ALIASES: Record<string, string> = {
  smoke: '_smoke/home-loads',
  perf: '_smoke/perf-budgets',
}

/** Resolves CLI selectors (ids, dirs, aliases, comma lists) against discovered ids. Unknown selectors are returned separately. */
export function selectScenarios(selectors: string[], ids: string[]): { selected: string[]; unknown: string[] } {
  const selected: string[] = []
  const unknown: string[] = []
  for (const raw of selectors.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean)) {
    const sel = SCENARIO_ALIASES[raw] ?? raw.replace(/\/$/, '')
    const hits = ids.includes(sel) ? [sel] : ids.filter((id) => id.startsWith(sel + '/'))
    if (!hits.length) unknown.push(raw)
    for (const h of hits) if (!selected.includes(h)) selected.push(h)
  }
  return { selected, unknown }
}
