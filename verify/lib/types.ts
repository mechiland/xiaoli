// Types for `pnpm verify` scenarios and the JSON log (ARCHITECTURE §8). Owner: verify-seed.
import type { APIRequestContext, BrowserContext, Page } from 'playwright'

export type AccountName = 'seed' | 'seed2' | 'empty' | 'fresh' | 'anonymous'

export interface ExpectedFailure {
  /** substring of the URL, or a RegExp */
  urlPattern: string | RegExp
  /** HTTP status (apiNon2xx) — omit to match any status; ignored for network failures */
  status?: number
  /** only while this step is running — omit for any step */
  step?: string
  /** also matches console errors whose text includes this (e.g. Chrome's "Failed to load resource" for the stubbed 500) */
  consoleText?: string
}

export interface ShotOptions {
  /** default true */
  fullPage?: boolean
  /** screenshot only this locator/selector instead of the page */
  selector?: string
  /** extra settle time before the shot, ms (default 150) */
  settleMs?: number
}

export interface ApiResult<T = unknown> {
  status: number
  ok: boolean
  json: T | null
  text: string
  headers: Record<string, string>
  durationMs: number
  serverTimingMs: number | null
}

export interface ScenarioApi {
  get<T = unknown>(path: string): Promise<ApiResult<T>>
  post<T = unknown>(path: string, body?: unknown): Promise<ApiResult<T>>
  patch<T = unknown>(path: string, body?: unknown): Promise<ApiResult<T>>
  put<T = unknown>(path: string, body?: unknown): Promise<ApiResult<T>>
  delete<T = unknown>(path: string, body?: unknown): Promise<ApiResult<T>>
  /** the underlying Playwright request context (shares the browser context's cookies) */
  raw: APIRequestContext
}

export interface SeedRef {
  id: number
  label?: string
  title?: string
  personId?: number
  chatId?: number
  statement?: string
  /** loop 正文 (SPEC §7 交互层) */
  text?: string
}

export interface ScenarioSeed {
  /** tag → row from .dev/seed-manifest.json for the scenario's account; throws if the tag is missing */
  person(tag: string): Promise<SeedRef>
  import(tag: string): Promise<SeedRef>
  chat(tag: string): Promise<SeedRef>
  claim(tag: string): Promise<SeedRef>
  /** 段落 (SPEC §7 交互层) */
  segment(tag: string): Promise<SeedRef>
  /** 未结事项 */
  loop(tag: string): Promise<SeedRef>
  /** the whole manifest entry for the account (null when seed has not run) */
  manifest(): Promise<unknown>
}

export interface BudgetOptions {
  /** default 300 */
  targetMs?: number
  /** total runs, default 4 */
  runs?: number
  /** leading runs discarded as warm-up, default 1 */
  discard?: number
}

export interface BudgetResult {
  name: string
  kind: 'page-ttfb' | 'api-server-timing' | 'custom'
  target: number
  samplesMs: number[]
  statisticMs: number | null
  passed: boolean
  /** true when the page/route does not exist yet (placeholder page or 501) — never counts as passing */
  missing?: boolean
  note?: string
}

export interface ScenarioMeasure {
  /** 4 sequential navigations, first discarded, median of the rest of document TTFB (ARCHITECTURE §8) */
  page(name: string, path: string, opts?: BudgetOptions & { missingIf?: (page: Page) => Promise<boolean> }): Promise<BudgetResult>
  /** same statistic over `Server-Timing: app;dur=` of an API GET */
  api(name: string, path: string, opts?: BudgetOptions & { missingIf?: (r: ApiResult) => boolean }): Promise<BudgetResult>
  /** record an arbitrary budget from samples you measured yourself */
  record(name: string, samplesMs: number[], opts?: BudgetOptions): BudgetResult
}

export interface DropFileInput {
  /** a path on disk, or in-memory bytes */
  path?: string
  name?: string
  mimeType?: string
  buffer?: Buffer | Uint8Array
}

export interface ScenarioHelpers {
  /** page.goto(path) + wait for load + fonts + a short network-quiet period; returns the document status */
  goto(path: string, opts?: { waitFor?: string; timeoutMs?: number }): Promise<number | null>
  /** wait until no request has been in flight for `quietMs` (default 400), capped at `timeoutMs` (default 5000) */
  settle(opts?: { quietMs?: number; timeoutMs?: number }): Promise<void>
  /** delay matching requests by `ms` (loading-state showcase). Returns an unroute function. */
  simulateLoading(urlPattern: string | RegExp, ms?: number): Promise<() => Promise<void>>
  /** answer matching requests with an error envelope (error-state showcase). Declare it in expectedFailures too. */
  simulateError(urlPattern: string | RegExp, opts?: { status?: number; code?: string; message?: string }): Promise<() => Promise<void>>
  /** fulfil matching requests with a JSON body */
  stubJson(urlPattern: string | RegExp, body: unknown, opts?: { status?: number }): Promise<() => Promise<void>>
  /** remove all routes installed on the page */
  clearRoutes(): Promise<void>
  /** simulate dragging files from the OS onto `target` (default 'body'): dragenter → dragover → drop */
  dropFiles(files: DropFileInput[], opts?: { target?: string; release?: boolean }): Promise<void>
  /** dragenter + dragover only (to screenshot the "松开以导入" layer); call dropFiles to finish */
  dragOver(files: DropFileInput[], opts?: { target?: string }): Promise<void>
  /** set files on an <input type=file> */
  setInputFiles(selector: string, files: DropFileInput[]): Promise<void>
  /** 'Mod+K' → Meta+K on macOS, Control+K elsewhere; other keys passed to keyboard.press */
  press(keys: string): Promise<void>
  /** type text with the keyboard (focus must already be set) */
  type(text: string, opts?: { delayMs?: number }): Promise<void>
}

export interface ScenarioContext {
  page: Page
  context: BrowserContext
  width: number
  baseUrl: string
  account: AccountName
  /** email of the signed-in account (null for anonymous) */
  email: string | null
  step<T>(name: string, fn: () => Promise<T>): Promise<T>
  shot(name: string, opts?: ShotOptions): Promise<string>
  /** scenario-declared check; a failing check fails the run but does not stop it */
  check(name: string, passed: boolean, details?: unknown): boolean
  api: ScenarioApi
  seed: ScenarioSeed
  measure: ScenarioMeasure
  helpers: ScenarioHelpers
  /** artifacts dir of this run */
  outDir: string
  log(msg: string, data?: unknown): void
}

export interface ScenarioDefinition {
  id: string
  description?: string
  /** default 'seed' */
  account?: AccountName
  /** default [1440, 390] */
  widths?: number[]
  /** true → verify re-seeds the account after the run (and before it, if `requiredTags` are missing) */
  destructive?: boolean
  /** manifest tags this scenario needs, e.g. ['person:long-profile', 'import:delete-me'] */
  requiredTags?: string[]
  expectedFailures?: ExpectedFailure[]
  /** record a Playwright trace (kept only when the width fails). Default true; perf scenarios turn it off. */
  trace?: boolean
  /** console error substrings that are not failures (use sparingly, say why in the scenario) */
  allowConsole?: string[]
  run(ctx: ScenarioContext): Promise<void>
}

// ---- log.json ----
export interface StepLog {
  name: string
  startedAt: string
  durationMs: number
  ok: boolean
  error?: string
}
export interface WidthLog {
  width: number
  steps: StepLog[]
  screenshots: string[]
  trace?: string
}
export interface VerifyLog {
  scenario: string
  description: string | null
  startedAt: string
  finishedAt: string
  baseUrl: string
  account: AccountName
  commit: string | null
  passed: boolean
  failureReasons: string[]
  widths: WidthLog[]
  consoleErrors: { width: number; step: string; type: 'error' | 'pageerror'; text: string; location?: string; expected?: boolean }[]
  consoleWarnings: { width: number; step: string; text: string; location?: string }[]
  failedRequests: { width: number; step: string; url: string; method: string; failure: string; expected: boolean }[]
  abortedRequests: { width: number; step: string; url: string; method: string; resourceType: string }[]
  apiNon2xx: { width: number; step: string; url: string; method: string; status: number; code?: string; expected: boolean }[]
  pageLoads: { width: number; step: string; url: string; status: number | null; ttfbMs: number; domContentLoadedMs: number; loadMs: number; lcpMs?: number }[]
  apiTimings: { width: number; step: string; url: string; method: string; status: number; durationMs: number; serverTimingMs?: number }[]
  budgets: (BudgetResult & { width: number })[]
  checks: { width: number; step: string; name: string; passed: boolean; details?: unknown }[]
  notes: { width: number; step: string; msg: string; data?: unknown }[]
}
