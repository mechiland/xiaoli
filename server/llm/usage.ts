// Usage totals across logged calls (STATUS.json llmUsage, eval reports, smoke output). Pure.
import type { LlmCallRecord } from '@/contracts'

type UsageRecord = Pick<LlmCallRecord, 'mode' | 'purpose' | 'model' | 'inputTokens' | 'outputTokens' | 'cacheHitTokens'> & { error?: LlmCallRecord['error'] }

export interface UsageBucket {
  calls: number
  inputTokens: number
  outputTokens: number
}

export interface UsageSummary extends UsageBucket {
  /** input + output */
  totalTokens: number
  cacheHitTokens: number
  liveCalls: number
  replayCalls: number
  errorCalls: number
  errorsByCode: Record<string, number>
  byPurpose: Record<string, UsageBucket>
  byModel: Record<string, UsageBucket>
}

/**
 * Token sums count only calls that reached the provider (mode live|record), matching the budget;
 * pass includeReplay to also sum tokens recorded in replayed cassettes. `calls` counts every record.
 */
export function summarizeUsage(records: readonly UsageRecord[], opts: { includeReplay?: boolean } = {}): UsageSummary {
  const s: UsageSummary = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    liveCalls: 0,
    replayCalls: 0,
    errorCalls: 0,
    errorsByCode: {},
    byPurpose: {},
    byModel: {},
  }
  const bump = (map: Record<string, UsageBucket>, k: string, i: number, o: number) => {
    const b = (map[k] ??= { calls: 0, inputTokens: 0, outputTokens: 0 })
    b.calls++
    b.inputTokens += i
    b.outputTokens += o
  }
  for (const r of records) {
    s.calls++
    if (r.mode === 'replay') s.replayCalls++
    else s.liveCalls++
    if (r.error) {
      s.errorCalls++
      s.errorsByCode[r.error.code] = (s.errorsByCode[r.error.code] ?? 0) + 1
    }
    const counts = r.mode !== 'replay' || opts.includeReplay
    const i = counts ? (r.inputTokens ?? 0) : 0
    const o = counts ? (r.outputTokens ?? 0) : 0
    s.inputTokens += i
    s.outputTokens += o
    s.cacheHitTokens += counts ? (r.cacheHitTokens ?? 0) : 0
    bump(s.byPurpose, r.purpose, i, o)
    bump(s.byModel, r.model, i, o)
  }
  s.totalTokens = s.inputTokens + s.outputTokens
  return s
}
