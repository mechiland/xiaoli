// createLlmClient: modes (live | record | replay), transport retries, deadline, token budget, per-attempt logging.
import type { LlmCallRecord } from '@/contracts'
import { cassetteKey, dirCassetteStore, type CassetteStore } from './cassette'
import { deepseekAttempt, interpretCompletion, type AttemptOutcome } from './deepseek'
import { errorName } from './redact'
import {
  DEFAULT_MAX_TRANSPORT_RETRIES,
  DEFAULT_TIMEOUT_MS,
  LlmRequestError,
  MAX_OUTPUT_TOKENS,
  MIN_DEADLINE_MS,
  RETRYABLE,
  TRANSPORT_RETRY_CODES,
  type LlmCallLogger,
  type LlmClient,
  type LlmEnv,
  type LlmError,
  type LlmErrorCode,
  type LlmJsonRequest,
  type LlmJsonResult,
  type LlmMode,
  type LlmThinking,
  type LlmUsage,
  type TokenBudget,
  type TokenCount,
} from './types'

export interface CreateLlmClientOptions {
  env: LlmEnv
  logger: LlmCallLogger
  mode: LlmMode
  cassetteDir?: string
  /** required non-null for live | record */
  budget: TokenBudget | null
  /** additive hooks for tests / CLI */
  cassetteStore?: CassetteStore
  fetch?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** Backoff before transport retry 1 and 2 (ARCHITECTURE §5). */
export const BACKOFF_MS = [1_000, 3_000] as const
const MAX_RETRY_AFTER_MS = 30_000
/** Error outcomes without a completion that record mode writes, only when no response cassette exists yet. */
const RECORDABLE_ERRORS: ReadonlySet<LlmErrorCode> = new Set<LlmErrorCode>(['timeout', 'network', 'http_5xx', 'rate_limited'])

/** DeepSeek JSON mode needs the word "json" and an example in the prompt (api-docs.deepseek.com/guides/json_mode). */
export function assertJsonRequest(req: LlmJsonRequest, env: Pick<LlmEnv, 'NEXTJS_ENV'>): void {
  if (!req || typeof req !== 'object') throw new LlmRequestError('completeJson: request is required')
  if (!req.model) throw new LlmRequestError('completeJson: model is required')
  if (!req.promptVersion) throw new LlmRequestError('completeJson: promptVersion is required')
  if (!Array.isArray(req.messages) || req.messages.length === 0) throw new LlmRequestError('completeJson: messages must not be empty')
  if (!Number.isInteger(req.maxTokens) || req.maxTokens < 1 || req.maxTokens > MAX_OUTPUT_TOKENS)
    throw new LlmRequestError(`completeJson: maxTokens must be an integer in 1..${MAX_OUTPUT_TOKENS}`)
  const text = req.messages.map((m) => m.content).join('\n')
  const problems: string[] = []
  if (!/json/i.test(text)) problems.push('the word "json"')
  if (!text.includes('{')) problems.push('an example JSON object')
  if (problems.length === 0) return
  const msg = `completeJson(${req.promptVersion}): prompt must contain ${problems.join(' and ')} (DeepSeek JSON mode)`
  if (env.NEXTJS_ENV === 'production') {
    console.log(JSON.stringify({ level: 'warn', msg: 'llm_prompt_not_json_ready', promptVersion: req.promptVersion }))
    return
  }
  throw new LlmRequestError(msg)
}

export function createLlmClient(opts: CreateLlmClientOptions): LlmClient {
  const mode = opts.mode
  if (mode !== 'live' && mode !== 'record' && mode !== 'replay') throw new LlmRequestError(`createLlmClient: unknown mode ${String(mode)}`)
  if (mode !== 'replay' && !opts.budget) throw new LlmRequestError(`createLlmClient: a TokenBudget is required in ${mode} mode`)
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => fetch(input, init))
  const store = opts.cassetteStore ?? (opts.cassetteDir ? dirCassetteStore(opts.cassetteDir) : null)
  const thinking: LlmThinking = opts.env.LLM_THINKING ?? 'disabled'

  async function log(rec: LlmCallRecord): Promise<void> {
    try {
      await opts.logger.log(rec)
    } catch (err) {
      // Never let logging break a call. Only the error class is logged: driver messages can echo bound params (raw output).
      console.log(JSON.stringify({ level: 'error', msg: 'llm_call_log_failed', errorName: errorName(err) }))
    }
  }

  function record(
    req: LlmJsonRequest,
    key: string,
    recMode: LlmMode,
    attempt: number,
    p: { latencyMs: number; usage: LlmUsage | null; raw: string | null; finishReason: string | null; error: { code: LlmErrorCode; message: string } | null },
  ): LlmCallRecord {
    const ctx = req.context ?? {}
    return {
      ownerId: ctx.ownerId ?? null,
      provider: 'deepseek',
      model: req.model,
      promptVersion: req.promptVersion,
      purpose: req.purpose,
      importId: ctx.importId ?? null,
      jobId: ctx.jobId ?? null,
      evalRunId: ctx.evalRunId ?? null,
      inputTokens: p.usage ? p.usage.inputTokens : null,
      outputTokens: p.usage ? p.usage.outputTokens : null,
      cacheHitTokens: p.usage ? p.usage.cacheHitTokens : null,
      latencyMs: Math.max(0, Math.round(p.latencyMs)),
      attempt,
      mode: recMode,
      cassetteKey: key,
      rawOutput: p.raw,
      finishReason: p.finishReason,
      error: p.error,
      createdAt: new Date(now()).toISOString(),
    }
  }

  function fail(
    code: LlmErrorCode,
    message: string,
    extra: { latencyMs: number; raw?: string | null; usage?: LlmUsage | null; finishReason?: string | null; fromCassette?: boolean },
  ): LlmError {
    return {
      ok: false,
      code,
      message,
      raw: extra.raw ?? null,
      retryable: RETRYABLE[code],
      latencyMs: Math.max(0, Math.round(extra.latencyMs)),
      usage: extra.usage ?? null,
      finishReason: extra.finishReason ?? null,
      fromCassette: extra.fromCassette ?? false,
    }
  }

  function attemptCap(req: LlmJsonRequest): { timeoutMs: number; capIsDeadline: boolean } | { deadline: true } {
    let timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS
    let capIsDeadline = false
    if (req.deadlineAt != null) {
      const remaining = req.deadlineAt - now()
      if (remaining < MIN_DEADLINE_MS) return { deadline: true }
      if (remaining < timeoutMs) {
        timeoutMs = remaining
        capIsDeadline = true
      }
    }
    return { timeoutMs, capIsDeadline }
  }

  async function failAndLog(
    req: LlmJsonRequest,
    key: string,
    recMode: LlmMode,
    attempt: number,
    code: LlmErrorCode,
    message: string,
    extra: Parameters<typeof fail>[2],
  ): Promise<LlmError> {
    const e = fail(code, message, extra)
    await log(record(req, key, recMode, attempt, { latencyMs: e.latencyMs, usage: e.usage ?? null, raw: e.raw, finishReason: e.finishReason ?? null, error: { code, message } }))
    return e
  }

  async function replay(req: LlmJsonRequest, key: string): Promise<LlmJsonResult | LlmError> {
    const miss = (message: string) => failAndLog(req, key, 'replay', 1, 'cassette_miss', message, { latencyMs: 0 })
    if (!store) return miss(`replay mode has no cassette directory (${req.promptVersion}/${key}); replay never calls the network`)
    let cas
    try {
      cas = await store.read(req.promptVersion, key)
    } catch (err) {
      return miss(`cassette ${store.describe(req.promptVersion, key)} is unreadable: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`)
    }
    if (!cas) return miss(`no cassette at ${store.describe(req.promptVersion, key)}; replay never calls the network (record it with a --live run)`)
    const cap = attemptCap(req)
    if ('deadline' in cap)
      return failAndLog(req, key, 'replay', 1, 'deadline', `less than ${MIN_DEADLINE_MS} ms left before deadlineAt`, { latencyMs: 0, fromCassette: true })
    if (cas.error) {
      return failAndLog(req, key, 'replay', 1, cas.error.code, cas.error.message || `recorded ${cas.error.code}`, {
        latencyMs: cas.error.latencyMs ?? 0,
        fromCassette: true,
      })
    }
    const r = cas.response!
    const usage: LlmUsage = r.usage ?? { inputTokens: 0, outputTokens: 0, cacheHitTokens: null }
    if (r.latencyMs > cap.timeoutMs) {
      return failAndLog(req, key, 'replay', 1, cap.capIsDeadline ? 'deadline' : 'timeout', `recorded latency ${Math.round(r.latencyMs)} ms exceeds the ${cap.timeoutMs} ms attempt limit`, {
        latencyMs: cap.timeoutMs,
        fromCassette: true,
      })
    }
    const interp = interpretCompletion(r.content, r.finishReason)
    if (!interp.ok) {
      return failAndLog(req, key, 'replay', 1, interp.code, interp.message, { latencyMs: r.latencyMs, raw: r.content, usage, finishReason: r.finishReason, fromCassette: true })
    }
    await log(record(req, key, 'replay', 1, { latencyMs: r.latencyMs, usage, raw: r.content, finishReason: r.finishReason, error: null }))
    return { ok: true, json: interp.json, raw: r.content ?? '', usage, latencyMs: Math.round(r.latencyMs), model: cas.model, finishReason: r.finishReason ?? 'stop', fromCassette: true }
  }

  async function writeCassette(req: LlmJsonRequest, key: string, out: AttemptOutcome): Promise<void> {
    if (!store) return
    const hasCompletion = out.ok || out.finishReason !== null
    if (!hasCompletion && !(out.code && RECORDABLE_ERRORS.has(out.code))) return
    try {
      if (!hasCompletion) {
        const existing = await store.read(req.promptVersion, key).catch(() => null)
        if (existing?.response) return // a transient failure never replaces a recorded completion
      }
      await store.write({
        key,
        recordedAt: new Date(now()).toISOString(),
        model: req.model,
        promptVersion: req.promptVersion,
        purpose: req.purpose,
        request: { messages: req.messages.map((m) => ({ role: m.role, content: m.content })), maxTokens: req.maxTokens, temperature: req.temperature ?? 0, thinking },
        response: hasCompletion ? { content: out.raw, finishReason: out.finishReason, usage: out.usage, latencyMs: Math.round(out.latencyMs) } : null,
        error: hasCompletion ? null : { code: out.code!, message: out.message, latencyMs: Math.round(out.latencyMs) },
      })
    } catch (err) {
      console.log(JSON.stringify({ level: 'error', msg: 'llm_cassette_write_failed', promptVersion: req.promptVersion, key, errorName: errorName(err) }))
    }
  }

  async function callProvider(req: LlmJsonRequest, key: string): Promise<LlmJsonResult | LlmError> {
    const budget = opts.budget!
    const maxAttempts = 1 + Math.max(0, Math.floor(req.maxTransportRetries ?? DEFAULT_MAX_TRANSPORT_RETRIES))
    let last: AttemptOutcome | null = null
    let lastErr: LlmError | null = null
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1 && last) {
        const delay = Math.min(last.retryAfterMs ?? BACKOFF_MS[Math.min(attempt - 2, BACKOFF_MS.length - 1)], MAX_RETRY_AFTER_MS)
        if (req.deadlineAt != null && now() + delay + MIN_DEADLINE_MS > req.deadlineAt) break // never retry past the deadline
        await sleep(delay)
      }
      const cap = attemptCap(req)
      if ('deadline' in cap) return failAndLog(req, key, mode, attempt, 'deadline', `less than ${MIN_DEADLINE_MS} ms left before deadlineAt`, { latencyMs: 0 })

      let used: TokenCount
      try {
        used = await budget.used()
      } catch (err) {
        console.log(JSON.stringify({ level: 'error', msg: 'llm_budget_read_failed', errorName: errorName(err) }))
        return failAndLog(req, key, mode, attempt, 'budget_exceeded', 'token budget could not be read; refusing the live call', { latencyMs: 0 })
      }
      const total = used.inputTokens + used.outputTokens
      if (total >= budget.limit) {
        return failAndLog(req, key, mode, attempt, 'budget_exceeded', `token budget exhausted: ${total} of ${budget.limit} tokens used`, { latencyMs: 0 })
      }
      if (!opts.env.DEEPSEEK_API_KEY) return failAndLog(req, key, mode, attempt, 'http_4xx', 'DEEPSEEK_API_KEY is not configured', { latencyMs: 0 })

      const out = await deepseekAttempt({ env: opts.env, fetch: doFetch, now }, req, { thinking, timeoutMs: cap.timeoutMs, capIsDeadline: cap.capIsDeadline })
      if (out.usage && (out.usage.inputTokens > 0 || out.usage.outputTokens > 0)) {
        try {
          await budget.add({ inputTokens: out.usage.inputTokens, outputTokens: out.usage.outputTokens })
        } catch (err) {
          console.log(JSON.stringify({ level: 'error', msg: 'llm_budget_add_failed', errorName: errorName(err) }))
        }
      }
      await log(
        record(req, key, mode, attempt, {
          latencyMs: out.latencyMs,
          usage: out.usage,
          raw: out.raw,
          finishReason: out.finishReason,
          error: out.ok ? null : { code: out.code!, message: out.message },
        }),
      )
      last = out
      if (out.ok) {
        if (mode === 'record') await writeCassette(req, key, out)
        return {
          ok: true,
          json: out.json,
          raw: out.raw ?? '',
          usage: out.usage ?? { inputTokens: 0, outputTokens: 0, cacheHitTokens: null },
          latencyMs: Math.round(out.latencyMs),
          model: req.model,
          finishReason: out.finishReason ?? 'stop',
          fromCassette: false,
        }
      }
      lastErr = fail(out.code!, out.message, { latencyMs: out.latencyMs, raw: out.raw, usage: out.usage, finishReason: out.finishReason })
      if (!TRANSPORT_RETRY_CODES.has(out.code!)) break
    }
    if (mode === 'record' && last) await writeCassette(req, key, last)
    return lastErr!
  }

  return {
    async completeJson(req) {
      assertJsonRequest(req, opts.env)
      const key = cassetteKey(req, thinking)
      return mode === 'replay' ? replay(req, key) : callProvider(req, key)
    },
  }
}
