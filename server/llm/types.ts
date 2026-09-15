// Adapter types (ARCHITECTURE §5). Pure: no Node or Worker-only imports.
import type { LlmCallRecord, LlmErrorCode, LlmModeName, LlmPurpose } from '@/contracts'

export type { LlmCallRecord, LlmErrorCode, LlmPurpose }

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmRequestContext {
  ownerId?: string | null
  importId?: number | null
  jobId?: number | null
  evalRunId?: string | null
}

export interface LlmJsonRequest {
  purpose: LlmPurpose
  /** e.g. 'extract.v1' */
  promptVersion: string
  /** required; callers resolve it (extract: resolveExtractModel) */
  model: string
  /** must contain the word "json" and an example object (asserted; throws outside production) */
  messages: LlmMessage[]
  /** required; extract 8192, dedup 1024, judge 1024 */
  maxTokens: number
  /** default 0 */
  temperature?: number
  /** per attempt, default 25_000 */
  timeoutMs?: number
  /** epoch ms; each attempt is capped at deadlineAt - now; < 1000 ms left → code 'deadline' */
  deadlineAt?: number
  /** extra attempts for network / http_5xx / rate_limited / empty_content; default 2 */
  maxTransportRetries?: number
  context?: LlmRequestContext
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  cacheHitTokens: number | null
}

export interface LlmJsonResult {
  ok: true
  json: unknown
  raw: string
  usage: LlmUsage
  latencyMs: number
  model: string
  finishReason: string
  fromCassette: boolean
}

export interface LlmError {
  ok: false
  code: LlmErrorCode
  /** never contains the API key or message bodies */
  message: string
  /** model content when there was a completion (invalid_json, truncated, empty_content), else null */
  raw: string | null
  /** whether the same request may succeed if repeated (see RETRYABLE) */
  retryable: boolean
  latencyMs: number
  /** additive: tokens billed for this failed call, when the provider reported them */
  usage?: LlmUsage | null
  finishReason?: string | null
  fromCassette?: boolean
}

export interface LlmClient {
  /** never throws for provider errors; throws LlmRequestError for malformed requests (programmer error) */
  completeJson(req: LlmJsonRequest): Promise<LlmJsonResult | LlmError>
}

export type LlmMode = LlmModeName
export type LlmThinking = 'enabled' | 'disabled'

/** Subset of ServerEnv the adapter reads. `parseServerEnv(...)` output satisfies it. */
export interface LlmEnv {
  DEEPSEEK_API_KEY?: string
  DEEPSEEK_BASE_URL?: string
  LLM_THINKING?: LlmThinking
  NEXTJS_ENV?: string
}

export interface LlmCallLogger {
  log(rec: LlmCallRecord): Promise<void>
}

export interface TokenCount {
  inputTokens: number
  outputTokens: number
}

export interface TokenBudget {
  limit: number
  used(): Promise<TokenCount>
  add(u: TokenCount): Promise<void>
}

export const DEFAULT_TIMEOUT_MS = 25_000
export const DEFAULT_MAX_TRANSPORT_RETRIES = 2
export const DEFAULT_BUDGET_TOKENS = 3_000_000
export const MAX_OUTPUT_TOKENS = 384_000
export const MIN_DEADLINE_MS = 1_000
export const DEFAULT_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_MODEL = 'deepseek-flash'

/** Whether repeating the identical request can plausibly succeed (DECISIONS ## llm L6). */
export const RETRYABLE: Record<LlmErrorCode, boolean> = {
  timeout: true,
  network: true,
  http_5xx: true,
  rate_limited: true,
  empty_content: true,
  invalid_json: true,
  http_4xx: false,
  truncated: false,
  cassette_miss: false,
  budget_exceeded: false,
  deadline: false,
}

/** Codes the adapter itself retries (ARCHITECTURE §5 "Retries — ownership split"). */
export const TRANSPORT_RETRY_CODES: ReadonlySet<LlmErrorCode> = new Set<LlmErrorCode>(['network', 'http_5xx', 'rate_limited', 'empty_content'])

/** Malformed request (programmer error), thrown synchronously from completeJson. */
export class LlmRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmRequestError'
  }
}

export function isLlmError(r: LlmJsonResult | LlmError): r is LlmError {
  return r.ok === false
}
