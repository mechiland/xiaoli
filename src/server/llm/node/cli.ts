// CLI client factory (eval, extract:offline, smoke). Node only. Callers load .env.local first (core loadEnvLocal).
import path from 'node:path'
import { parseServerEnv } from '@/server/env'
import { createLlmClient } from '../client'
import { jsonlCallLogger, memoryCallLogger, teeCallLogger } from '../loggers'
import { summarizeUsage, type UsageSummary } from '../usage'
import type { LlmCallRecord, LlmClient, LlmMode } from '../types'
import { createFileBudget } from './file-budget'

export interface CliLlmOptions {
  mode: LlmMode
  /** log file = <runsDir>/<runId>/llm-calls.jsonl */
  runId: string
  /** default 'eval/runs' (gitignored) */
  runsDir?: string
  /** fixtures/cassettes/synthetic | fixtures/cassettes/real | a module fixture dir */
  cassetteDir?: string
  /** default .dev/llm-budget.json */
  budgetPath?: string
  /** default process.env */
  env?: Record<string, unknown>
}

export interface CliLlm {
  llm: LlmClient
  logPath: string
  records: LlmCallRecord[]
  summary(): UsageSummary
}

export async function createCliLlm(opts: CliLlmOptions): Promise<CliLlm> {
  const env = parseServerEnv(opts.env ?? process.env)
  const runId = opts.runId.replace(/[^A-Za-z0-9._-]/g, '_')
  const logPath = path.join(opts.runsDir ?? 'eval/runs', runId, 'llm-calls.jsonl')
  const memory = memoryCallLogger()
  const llm = createLlmClient({
    env,
    logger: teeCallLogger(jsonlCallLogger(logPath), memory),
    mode: opts.mode,
    cassetteDir: opts.cassetteDir,
    budget: opts.mode === 'replay' ? null : await createFileBudget(opts.budgetPath),
  })
  return { llm, logPath, records: memory.records, summary: () => summarizeUsage(memory.records) }
}
