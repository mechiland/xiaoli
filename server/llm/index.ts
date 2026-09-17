// Public entry `@/server/llm` (ARCHITECTURE §5). Worker-safe at import time: Node-only pieces load via dynamic import().
import type { BudgetFile } from './node/file-budget'
import type { CliLlm, CliLlmOptions } from './node/cli'
import type { LlmCallRecord } from './types'

export type {
  LlmMessage,
  LlmJsonRequest,
  LlmJsonResult,
  LlmError,
  LlmErrorCode,
  LlmClient,
  LlmMode,
  LlmEnv,
  LlmThinking,
  LlmUsage,
  LlmPurpose,
  LlmCallLogger,
  LlmCallRecord,
  LlmRequestContext,
  TokenBudget,
  TokenCount,
} from './types'
export {
  LlmRequestError,
  isLlmError,
  RETRYABLE,
  TRANSPORT_RETRY_CODES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_TRANSPORT_RETRIES,
  DEFAULT_BUDGET_TOKENS,
  DEFAULT_MODEL,
  MAX_OUTPUT_TOKENS,
} from './types'
export { createLlmClient, assertJsonRequest, BACKOFF_MS, type CreateLlmClientOptions } from './client'
export { d1CallLogger, jsonlCallLogger, memoryCallLogger, teeCallLogger } from './loggers'
export { getAppLlm, type HonoContext } from './app'
export { cassetteKey, cassetteDirFor, cassetteRelPath, CassetteSchema, dirCassetteStore, memoryCassetteStore, CASSETTE_ROOT, type Cassette, type CassetteStore } from './cassette'
export { fileBudget, d1Budget, appBudget, memoryBudget, sumD1Usage, monthStartIso } from './budget'
export { summarizeUsage, type UsageSummary, type UsageBucket } from './usage'
export { llmModeFromArgs } from './modes'
export { buildRequestBody } from './deepseek'
export type { CliLlm, CliLlmOptions, BudgetFile }

/** Node only. CLI client: JSONL logger at <runsDir>/<runId>/llm-calls.jsonl, file budget for live/record. */
export async function createCliLlm(opts: CliLlmOptions): Promise<CliLlm> {
  const m = await import('./node/cli')
  return m.createCliLlm(opts)
}

/** Node only. Reads a JSONL call log written by jsonlCallLogger. */
export async function readCallLog(path: string): Promise<LlmCallRecord[]> {
  const m = await import('./node/fs-io')
  return (await m.readJsonl(path)) as LlmCallRecord[]
}

/** Node only. Current `.dev/llm-budget.json` state, null when never written. */
export async function readFileBudget(path?: string): Promise<BudgetFile | null> {
  const m = await import('./node/file-budget')
  return m.readBudgetFile(path)
}

/** Node only. Zero the shared counter at the start of a loop. */
export async function resetFileBudget(path: string | undefined, opts: { loopId: string; limit?: number }): Promise<BudgetFile> {
  const m = await import('./node/file-budget')
  return m.resetFileBudget(path, opts)
}
