// Runs one scenario at each width and writes artifacts/<scenario>/<timestamp>/{<width>/NN-name.png, log.json, trace-<width>.zip}.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Browser, Page, Request } from 'playwright'
import { ensureAuth, type FreshCredentials } from './auth'
import { createHelpers, type InflightTracker } from './helpers'
import {
  evaluate,
  isExpected,
  isExpectedConsole,
  median,
  parseServerTiming,
  relUrl,
  round1,
  scenarioDirName,
  timestampDir,
} from './log-utils'
import { createSeedAccessor, manifestHasTags } from './manifest'
import type {
  AccountName,
  ApiResult,
  BudgetOptions,
  BudgetResult,
  ScenarioApi,
  ScenarioContext,
  ScenarioDefinition,
  ScenarioMeasure,
  VerifyLog,
  WidthLog,
} from './types'

class StepAbort extends Error {}

export interface RunOptions {
  browser: Browser
  baseUrl: string
  widths?: number[]
  account?: AccountName
  root?: string
  /** override the scenario's trace flag */
  trace?: boolean
}

const LCP_INIT = `(() => { try { new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__verifyLcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {} })()`
const NAV_TIMING = `new Promise((resolve) => setTimeout(() => {
  const n = performance.getEntriesByType('navigation')[0];
  resolve(n ? { url: location.href, ttfb: n.responseStart - n.requestStart, dcl: n.domContentLoadedEventEnd - n.startTime, load: n.loadEventEnd - n.startTime, lcp: window.__verifyLcp ?? null } : null);
}, 0))`
const TTFB_NOW = `(() => { const n = performance.getEntriesByType('navigation')[0]; return n ? n.responseStart - n.requestStart : null })()`
const PLACEHOLDER_TEXT = '这一页还在建设中'

function gitCommit(root: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null
  } catch {
    return null
  }
}

function isSeedAccount(a: AccountName): boolean {
  return a === 'seed' || a === 'seed2' || a === 'empty'
}

export function reseed(root: string, account: AccountName): void {
  if (!isSeedAccount(account)) return
  console.log(`[verify] re-seeding account "${account}"`)
  const r = spawnSync('pnpm', ['seed', '--account', account], { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) console.error(`[verify] pnpm seed --account ${account} exited with ${r.status}`)
}

export async function runScenario(def: ScenarioDefinition, opts: RunOptions): Promise<{ log: VerifyLog; outDir: string }> {
  const root = opts.root ?? process.cwd()
  const base = opts.baseUrl.replace(/\/$/, '')
  const account: AccountName = opts.account ?? def.account ?? 'seed'
  const widths = opts.widths ?? def.widths ?? [1440, 390]
  const trace = opts.trace ?? def.trace ?? true
  const outDir = path.join(root, 'artifacts', scenarioDirName(def.id), timestampDir())
  mkdirSync(outDir, { recursive: true })

  const log: Omit<VerifyLog, 'passed' | 'failureReasons'> = {
    scenario: def.id,
    description: def.description ?? null,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    baseUrl: base,
    account,
    commit: gitCommit(root),
    widths: [],
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
  }

  if (def.destructive && def.requiredTags?.length && !manifestHasTags(root, account, def.requiredTags)) reseed(root, account)

  const fresh: FreshCredentials = { creds: null }
  try {
    for (const width of widths) {
      await runWidth({ def, browser: opts.browser, base, account, width, root, outDir, log, fresh, trace })
    }
  } finally {
    if (def.destructive) reseed(root, account)
  }

  log.finishedAt = new Date().toISOString()
  const { passed, failureReasons } = evaluate(log)
  const full: VerifyLog = { ...log, passed, failureReasons }
  writeFileSync(path.join(outDir, 'log.json'), JSON.stringify(full, null, 2))
  return { log: full, outDir }
}

interface WidthArgs {
  def: ScenarioDefinition
  browser: Browser
  base: string
  account: AccountName
  width: number
  root: string
  outDir: string
  log: Omit<VerifyLog, 'passed' | 'failureReasons'>
  fresh: FreshCredentials
  trace: boolean
}

async function runWidth(a: WidthArgs): Promise<void> {
  const { def, base, width, log, outDir } = a
  const narrow = width < 800
  const widthLog: WidthLog = { width, steps: [], screenshots: [] }
  log.widths.push(widthLog)
  const shotDir = path.join(outDir, String(width))
  mkdirSync(shotDir, { recursive: true })

  const context = await a.browser.newContext({
    baseURL: base,
    viewport: { width, height: narrow ? 844 : 900 },
    deviceScaleFactor: narrow ? 2 : 1,
    hasTouch: narrow,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  })
  if (a.trace) await context.tracing.start({ snapshots: true, screenshots: true })
  await context.addInitScript(LCP_INIT)

  let current = 'setup'
  const pending = new Set<Promise<unknown>>()
  const track = (p: Promise<unknown>) => {
    pending.add(p)
    void p.finally(() => pending.delete(p))
  }
  const inflight: InflightTracker = { count: 0, lastChange: Date.now() }
  const isApi = (url: string) => {
    try {
      const u = new URL(url)
      return u.origin === new URL(base).origin && u.pathname.startsWith('/api/')
    } catch {
      return false
    }
  }
  const expectedList = def.expectedFailures

  const page: Page = await context.newPage()
  let lastDocStatus: number | null = null

  page.on('request', () => {
    inflight.count++
    inflight.lastChange = Date.now()
  })
  const finished = () => {
    inflight.count = Math.max(0, inflight.count - 1)
    inflight.lastChange = Date.now()
  }
  page.on('requestfinished', (req: Request) => {
    finished()
    if (!isApi(req.url())) return
    const step = current
    track(
      (async () => {
        const res = await req.response()
        const t = req.timing()
        log.apiTimings.push({
          width,
          step,
          url: relUrl(req.url(), base),
          method: req.method(),
          status: res?.status() ?? 0,
          durationMs: round1(t.responseEnd >= 0 ? t.responseEnd : -1),
          serverTimingMs: parseServerTiming(res ? await res.headerValue('server-timing') : null) ?? undefined,
        })
      })().catch(() => undefined),
    )
  })
  page.on('requestfailed', (req) => {
    finished()
    const failure = req.failure()?.errorText ?? 'unknown'
    const url = relUrl(req.url(), base)
    if (/ERR_ABORTED/.test(failure)) {
      // Aborted by navigation or by React/Next cancelling a fetch — recorded, not a failure (ARCHITECTURE §8).
      log.abortedRequests.push({ width, step: current, url, method: req.method(), resourceType: req.resourceType() })
      return
    }
    log.failedRequests.push({ width, step: current, url, method: req.method(), failure, expected: isExpected(expectedList, { url: req.url(), step: current }) })
  })
  page.on('response', (res) => {
    const url = res.url()
    const status = res.status()
    const req = res.request()
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) lastDocStatus = status
    const step = current
    if (isApi(url)) {
      if (status >= 300 && status !== 304) {
        track(
          (async () => {
            let code: string | undefined
            try {
              code = ((await res.json()) as { error?: { code?: string } })?.error?.code
            } catch {
              // not JSON
            }
            log.apiNon2xx.push({ width, step, url: relUrl(url, base), method: req.method(), status, code, expected: isExpected(expectedList, { url, step, status }) })
          })(),
        )
      }
    } else if (status >= 400) {
      log.failedRequests.push({ width, step, url: relUrl(url, base), method: req.method(), failure: `HTTP ${status}`, expected: isExpected(expectedList, { url, step, status }) })
    }
  })
  page.on('console', (msg) => {
    const type = msg.type()
    const loc = msg.location()
    const location = loc?.url ? `${relUrl(loc.url, base)}:${loc.lineNumber}` : undefined
    if (type === 'error') {
      const text = msg.text()
      log.consoleErrors.push({ width, step: current, type: 'error', text, location, expected: isExpectedConsole(expectedList, def.allowConsole, { text, step: current, location: loc?.url }) })
    } else if (type === 'warning') {
      log.consoleWarnings.push({ width, step: current, text: msg.text(), location })
    }
  })
  page.on('pageerror', (err) => {
    const text = `${err.name}: ${err.message}`
    log.consoleErrors.push({ width, step: current, type: 'pageerror', text, location: err.stack?.split('\n')[1]?.trim(), expected: isExpectedConsole(expectedList, def.allowConsole, { text, step: current }) })
  })
  page.on('load', () => {
    const step = current
    const status = lastDocStatus
    track(
      (async () => {
        const t = (await page.evaluate(NAV_TIMING)) as { url: string; ttfb: number; dcl: number; load: number; lcp: number | null } | null
        if (!t) return
        log.pageLoads.push({
          width,
          step,
          url: relUrl(t.url, base),
          status,
          ttfbMs: round1(t.ttfb),
          domContentLoadedMs: round1(t.dcl),
          loadMs: round1(t.load),
          ...(t.lcp != null ? { lcpMs: round1(t.lcp) } : {}),
        })
      })().catch(() => undefined),
    )
  })

  const step: ScenarioContext['step'] = async (name, fn) => {
    const prev = current
    current = name
    const startedAt = new Date().toISOString()
    const t0 = performance.now()
    try {
      const out = await fn()
      widthLog.steps.push({ name, startedAt, durationMs: round1(performance.now() - t0), ok: true })
      return out
    } catch (err) {
      if (err instanceof StepAbort) throw err
      const e = err as Error
      widthLog.steps.push({ name, startedAt, durationMs: round1(performance.now() - t0), ok: false, error: (e?.stack ?? String(err)).slice(0, 2000) })
      throw new StepAbort(name)
    } finally {
      current = prev === 'setup' ? name : prev
    }
  }

  let shotNo = 0
  const shot: ScenarioContext['shot'] = async (name, o = {}) => {
    shotNo++
    const file = path.join(shotDir, `${String(shotNo).padStart(2, '0')}-${name.replace(/[^\w一-龥-]+/g, '-')}.png`)
    try {
      await page.evaluate('document.fonts ? document.fonts.ready.then(() => true) : true')
    } catch {
      // ignore
    }
    await page.waitForTimeout(o.settleMs ?? 150)
    if (o.selector) await page.locator(o.selector).first().screenshot({ path: file, caret: 'hide' })
    else await page.screenshot({ path: file, fullPage: o.fullPage ?? true, caret: 'hide' })
    const rel = path.relative(outDir, file)
    widthLog.screenshots.push(rel)
    return rel
  }

  const check: ScenarioContext['check'] = (name, passed, details) => {
    log.checks.push({ width, step: current, name, passed: Boolean(passed), ...(details === undefined ? {} : { details }) })
    return Boolean(passed)
  }

  const call = async <T>(method: string, p: string, body?: unknown, expectStatus?: (status: number) => boolean): Promise<ApiResult<T>> => {
    const url = p.startsWith('http') ? p : `${base}${p}`
    const t0 = performance.now()
    const res = await context.request.fetch(url, {
      method,
      data: body === undefined ? undefined : body,
      headers: { origin: base },
      failOnStatusCode: false,
      maxRedirects: 0,
    })
    const durationMs = round1(performance.now() - t0)
    const text = await res.text()
    let json: T | null = null
    try {
      json = JSON.parse(text) as T
    } catch {
      json = null
    }
    const headers = res.headers()
    const status = res.status()
    const serverTimingMs = parseServerTiming(headers['server-timing'])
    log.apiTimings.push({ width, step: current, url: relUrl(url, base), method, status, durationMs, ...(serverTimingMs != null ? { serverTimingMs } : {}) })
    if (status >= 300 && status !== 304) {
      const code = (json as { error?: { code?: string } } | null)?.error?.code
      const expected = Boolean(expectStatus?.(status)) || isExpected(expectedList, { url, step: current, status })
      log.apiNon2xx.push({ width, step: current, url: relUrl(url, base), method, status, code, expected })
    }
    return { status, ok: status >= 200 && status < 300, json, text, headers, durationMs, serverTimingMs }
  }
  const api: ScenarioApi = {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    patch: (p, b) => call('PATCH', p, b),
    put: (p, b) => call('PUT', p, b),
    delete: (p, b) => call('DELETE', p, b),
    raw: context.request,
  }

  const pushBudget = (b: BudgetResult) => {
    log.budgets.push({ ...b, width })
    return b
  }
  const measure: ScenarioMeasure = {
    async page(name, p, o = {}) {
      const { runs, discard, target } = budgetOpts(o)
      const samples: number[] = []
      let missing = false
      let note: string | undefined
      let badStatus: number | null = null
      for (let i = 0; i < runs; i++) {
        const res = await page.goto(p, { waitUntil: 'load', timeout: 60_000 })
        const status = res?.status() ?? null
        const ttfb = (await page.evaluate(TTFB_NOW)) as number | null
        if (i === 0) {
          const finalPath = new URL(page.url()).pathname
          if (finalPath === '/sign-in') {
            badStatus = status
            note = 'redirected to /sign-in (not signed in)'
          } else if (o.missingIf ? await o.missingIf(page) : status === 404 || status === 501 || (await page.getByText(PLACEHOLDER_TEXT).count()) > 0) {
            missing = true
            note = status === 404 || status === 501 ? `HTTP ${status}` : `placeholder page ("${PLACEHOLDER_TEXT}")`
          } else if (status !== null && status >= 400) {
            badStatus = status
            note = `HTTP ${status}`
          }
        }
        if (i >= discard && typeof ttfb === 'number') samples.push(round1(ttfb))
      }
      const statisticMs = median(samples)
      const passed = !missing && badStatus === null && statisticMs !== null && statisticMs <= target
      return pushBudget({ name, kind: 'page-ttfb', target, samplesMs: samples, statisticMs, passed, ...(missing ? { missing } : {}), ...(note ? { note } : {}) })
    },
    async api(name, p, o = {}) {
      const { runs, discard, target } = budgetOpts(o)
      const samples: number[] = []
      let missing = false
      let note: string | undefined
      let bad = false
      for (let i = 0; i < runs; i++) {
        // A 501 stub is reported once as a MISSING budget (which fails the run), not again as an unexpected non-2xx.
        const r = await call('GET', p, undefined, (status) => (o.missingIf ? false : status === 501))
        if (i === 0) {
          if (o.missingIf ? o.missingIf(r) : r.status === 501) {
            missing = true
            note = `HTTP ${r.status} (${(r.json as { error?: { code?: string } } | null)?.error?.code ?? 'no code'})`
          } else if (!r.ok) {
            bad = true
            note = `HTTP ${r.status}`
          }
        }
        if (i >= discard) {
          if (r.serverTimingMs != null) samples.push(round1(r.serverTimingMs))
          else {
            samples.push(r.durationMs)
            note = note ?? 'no Server-Timing header; used client duration'
          }
        }
      }
      const statisticMs = median(samples)
      const passed = !missing && !bad && statisticMs !== null && statisticMs <= target
      return pushBudget({ name, kind: 'api-server-timing', target, samplesMs: samples, statisticMs, passed, ...(missing ? { missing } : {}), ...(note ? { note } : {}) })
    },
    record(name, samplesMs, o = {}) {
      const { target, discard } = budgetOpts(o)
      const kept = samplesMs.slice(discard).map(round1)
      const statisticMs = median(kept)
      return pushBudget({ name, kind: 'custom', target, samplesMs: kept, statisticMs, passed: statisticMs !== null && statisticMs <= target })
    },
  }

  let email: string | null = null
  let authOk = true
  await step('sign in', async () => {
    email = (await ensureAuth(context, base, a.account, a.root, a.fresh)).email
  }).catch(() => {
    authOk = false
  })

  if (authOk) {
    const ctx: ScenarioContext = {
      page,
      context,
      width,
      baseUrl: base,
      account: a.account,
      email,
      step,
      shot,
      check,
      api,
      seed: createSeedAccessor(a.root, a.account),
      measure,
      helpers: createHelpers(page, inflight),
      outDir,
      log: (msg, data) => log.notes.push({ width, step: current, msg, ...(data === undefined ? {} : { data }) }),
    }
    try {
      await def.run(ctx)
    } catch (err) {
      if (!(err instanceof StepAbort)) {
        const e = err as Error
        widthLog.steps.push({ name: `scenario code (outside a step, after "${current}")`, startedAt: new Date().toISOString(), durationMs: 0, ok: false, error: (e?.stack ?? String(err)).slice(0, 2000) })
      }
    }
  }

  // let late console/network events arrive, then flush async recorders
  await page.waitForTimeout(300).catch(() => undefined)
  await Promise.allSettled([...pending])

  const widthFailed =
    widthLog.steps.some((s) => !s.ok) ||
    log.consoleErrors.some((e) => e.width === width && !e.expected) ||
    log.failedRequests.some((e) => e.width === width && !e.expected) ||
    log.apiNon2xx.some((e) => e.width === width && !e.expected) ||
    log.checks.some((c) => c.width === width && !c.passed)
  if (a.trace) {
    if (widthFailed) {
      const tracePath = path.join(outDir, `trace-${width}.zip`)
      await context.tracing.stop({ path: tracePath }).catch(() => undefined)
      widthLog.trace = path.relative(outDir, tracePath)
    } else {
      await context.tracing.stop().catch(() => undefined)
    }
  }
  await context.close()
}

function budgetOpts(o: BudgetOptions) {
  return { runs: o.runs ?? 4, discard: o.discard ?? 1, target: o.targetMs ?? 300 }
}
