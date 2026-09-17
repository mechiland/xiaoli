// DeepSeek transport: one attempt = one POST {base}/chat/completions (OpenAI-compatible), via fetch. Worker-safe.
// Settings and their sources: docs/DECISIONS.md ## llm.
import { errorText, redactSecrets } from './redact'
import { DEFAULT_BASE_URL, type LlmEnv, type LlmErrorCode, type LlmJsonRequest, type LlmThinking, type LlmUsage } from './types'

export interface AttemptOutcome {
  ok: boolean
  json: unknown
  code: LlmErrorCode | null
  message: string
  raw: string | null
  finishReason: string | null
  usage: LlmUsage | null
  latencyMs: number
  retryAfterMs: number | null
}

export function buildRequestBody(req: LlmJsonRequest, thinking: LlmThinking) {
  return {
    model: req.model,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    response_format: { type: 'json_object' as const },
    max_tokens: req.maxTokens,
    temperature: req.temperature ?? 0,
    thinking: { type: thinking },
    stream: false,
  }
}

/** JSON.parse of the content; tolerates surrounding whitespace and a single ```json fence. */
export function parseJsonContent(content: string): { ok: true; json: unknown } | { ok: false } {
  let s = content.trim()
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(s)
  if (fence) s = fence[1].trim()
  try {
    return { ok: true, json: JSON.parse(s) }
  } catch {
    return { ok: false }
  }
}

/** Shared by live and replay so a cassette reproduces the same outcome. */
export function interpretCompletion(
  content: string | null,
  finishReason: string | null,
): { ok: true; json: unknown } | { ok: false; code: LlmErrorCode; message: string } {
  if (finishReason === 'length') return { ok: false, code: 'truncated', message: 'output hit max_tokens (finish_reason=length)' }
  if (finishReason === 'insufficient_system_resource')
    return { ok: false, code: 'http_5xx', message: 'provider stopped generation (finish_reason=insufficient_system_resource)' }
  if (finishReason === 'content_filter') return { ok: false, code: 'http_4xx', message: 'provider content filter stopped generation (finish_reason=content_filter)' }
  if (content == null || content.trim() === '') return { ok: false, code: 'empty_content', message: 'provider returned empty content' }
  const parsed = parseJsonContent(content)
  if (!parsed.ok) return { ok: false, code: 'invalid_json', message: 'content is not valid JSON' }
  return { ok: true, json: parsed.json }
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** usage.prompt_tokens / completion_tokens; cache hits top-level or under prompt_tokens_details (both seen in the docs). */
export function parseUsage(u: unknown): LlmUsage | null {
  const o = asRecord(u)
  const input = num(o.prompt_tokens)
  const output = num(o.completion_tokens)
  if (input === null && output === null) return null
  const details = asRecord(o.prompt_tokens_details)
  return {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    cacheHitTokens: num(o.prompt_cache_hit_tokens) ?? num(details.prompt_cache_hit_tokens) ?? num(details.cached_tokens),
  }
}

export function parseRetryAfter(header: string | null, nowMs: number): number | null {
  if (!header) return null
  const secs = Number(header)
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000)
  const at = Date.parse(header)
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs)
}

function providerErrorMessage(text: string): string {
  try {
    const err = asRecord(asRecord(JSON.parse(text)).error)
    return typeof err.message === 'string' ? err.message : ''
  } catch {
    return ''
  }
}

export async function deepseekAttempt(
  deps: { env: LlmEnv; fetch: typeof fetch; now: () => number },
  req: LlmJsonRequest,
  opts: { thinking: LlmThinking; timeoutMs: number; capIsDeadline: boolean },
): Promise<AttemptOutcome> {
  const key = deps.env.DEEPSEEK_API_KEY ?? ''
  const base = (deps.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const start = deps.now()
  const outcome = (p: Partial<AttemptOutcome>): AttemptOutcome => ({
    ok: false,
    json: null,
    code: null,
    message: '',
    raw: null,
    finishReason: null,
    usage: null,
    retryAfterMs: null,
    ...p,
    latencyMs: Math.max(0, deps.now() - start),
  })

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), Math.max(1, opts.timeoutMs))
  let status = 0
  let text = ''
  let retryAfter: string | null = null
  try {
    const res = await deps.fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(buildRequestBody(req, opts.thinking)),
      signal: ac.signal,
    })
    status = res.status
    retryAfter = res.headers.get('retry-after')
    // Non-streaming requests may receive keep-alive blank lines before the body; the timer covers the whole read.
    text = await res.text()
  } catch (err) {
    if (ac.signal.aborted) {
      return outcome({ code: opts.capIsDeadline ? 'deadline' : 'timeout', message: `no complete response within ${opts.timeoutMs} ms` })
    }
    return outcome({ code: 'network', message: `network error: ${errorText(err, key)}` })
  } finally {
    clearTimeout(timer)
  }

  if (status < 200 || status >= 300) {
    const detail = providerErrorMessage(text)
    // 401/403 = bad or missing key, 402 = no balance: configuration faults, never worth retrying (DECISIONS ## llm L9).
    const code: LlmErrorCode =
      status === 429
        ? 'rate_limited'
        : status >= 500
          ? 'http_5xx'
          : status === 401 || status === 403
            ? 'unauthorized'
            : status === 402
              ? 'insufficient_balance'
              : 'http_4xx'
    return outcome({
      code,
      message: redactSecrets(`DeepSeek HTTP ${status}${detail ? `: ${detail}` : ''}`, key).slice(0, 300),
      retryAfterMs: status === 429 ? parseRetryAfter(retryAfter, deps.now()) : null,
    })
  }

  let envelope: Record<string, unknown>
  try {
    envelope = asRecord(JSON.parse(text))
  } catch {
    return outcome({ code: 'http_5xx', message: 'DeepSeek returned a non-JSON response envelope' })
  }
  const usage = parseUsage(envelope.usage)
  const choices = Array.isArray(envelope.choices) ? envelope.choices : []
  if (choices.length === 0) return outcome({ code: 'http_5xx', message: 'DeepSeek response has no choices', usage })
  const choice = asRecord(choices[0])
  const message = asRecord(choice.message)
  const content = typeof message.content === 'string' ? message.content : null
  const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null
  const interp = interpretCompletion(content, finishReason)
  if (!interp.ok) return outcome({ code: interp.code, message: interp.message, raw: content, finishReason, usage })
  return outcome({ ok: true, json: interp.json, raw: content ?? '', finishReason, usage })
}
