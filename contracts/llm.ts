import { z } from 'zod'
import { Id, IsoString } from './common'

// LLM call record (ARCHITECTURE §2.6).

export const LlmErrorCodeSchema = z.enum([
  'timeout',
  'http_4xx',
  'http_5xx',
  'rate_limited',
  'empty_content',
  'invalid_json',
  'truncated',
  'network',
  'cassette_miss',
  'budget_exceeded',
  'deadline',
  // configuration faults: the same request can never succeed until the owner fixes the setup
  'no_api_key',
  'unauthorized',
  'insufficient_balance',
])
export type LlmErrorCode = z.infer<typeof LlmErrorCodeSchema>

export const LlmPurposeSchema = z.enum(['extract', 'dedup', 'judge', 'other'])
export type LlmPurpose = z.infer<typeof LlmPurposeSchema>

export const LlmModeSchema = z.enum(['live', 'record', 'replay'])
export type LlmModeName = z.infer<typeof LlmModeSchema>

export const LlmCallRecordSchema = z.object({
  id: Id.optional(),
  ownerId: z.string().nullable(),
  provider: z.literal('deepseek'),
  model: z.string(),
  promptVersion: z.string(),
  purpose: LlmPurposeSchema,
  importId: Id.nullable(),
  jobId: Id.nullable(),
  evalRunId: z.string().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cacheHitTokens: z.number().int().nonnegative().nullable(),
  latencyMs: z.number().nonnegative(),
  attempt: z.number().int().positive(),
  mode: LlmModeSchema,
  cassetteKey: z.string().nullable(),
  rawOutput: z.string().nullable(),
  finishReason: z.string().nullable(),
  error: z.object({ code: LlmErrorCodeSchema, message: z.string() }).nullable(),
  createdAt: IsoString,
})
export type LlmCallRecord = z.infer<typeof LlmCallRecordSchema>
export type LlmCallDTO = LlmCallRecord
