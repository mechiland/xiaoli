// Call loggers: D1 (in-app), JSONL (CLI, Node), memory and tee (tests / CLI summaries).
import type { LlmCallRecord } from '@/contracts'
import { llmCalls, type Db } from '@/server/db'
import type { LlmCallLogger } from './types'

export function llmCallRow(r: LlmCallRecord): typeof llmCalls.$inferInsert {
  return {
    ownerId: r.ownerId,
    provider: r.provider,
    model: r.model,
    promptVersion: r.promptVersion,
    purpose: r.purpose,
    importId: r.importId,
    jobId: r.jobId,
    evalRunId: r.evalRunId,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheHitTokens: r.cacheHitTokens,
    latencyMs: Math.round(r.latencyMs),
    attempt: r.attempt,
    mode: r.mode,
    cassetteKey: r.cassetteKey,
    rawOutput: r.rawOutput,
    finishReason: r.finishReason,
    errorCode: r.error?.code ?? null,
    errorMessage: r.error?.message ?? null,
    createdAt: r.createdAt,
  }
}

/** In-app → llm_calls table. */
export function d1CallLogger(db: Db): LlmCallLogger {
  return {
    async log(rec) {
      await db.insert(llmCalls).values(llmCallRow(rec))
    },
  }
}

/** CLI → one JSON line per attempt (e.g. eval/runs/<runId>/llm-calls.jsonl, gitignored). Node only at call time. */
export function jsonlCallLogger(path: string): LlmCallLogger {
  return {
    async log(rec) {
      const { appendJsonl } = await import('./node/fs-io')
      await appendJsonl(path, rec)
    },
  }
}

export function memoryCallLogger(): LlmCallLogger & { records: LlmCallRecord[] } {
  const records: LlmCallRecord[] = []
  return {
    records,
    async log(rec) {
      records.push(rec)
    },
  }
}

/** Logs to every logger; one failing logger does not stop the others (the first error is rethrown). */
export function teeCallLogger(...loggers: LlmCallLogger[]): LlmCallLogger {
  return {
    async log(rec) {
      const results = await Promise.allSettled(loggers.map((l) => l.log(rec)))
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failed) throw failed.reason
    },
  }
}
