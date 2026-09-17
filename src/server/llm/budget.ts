// Token budgets (ARCHITECTURE §5 "Budget semantics"). D1/memory variants are Worker-safe; the file budget is Node only.
import { and, count, gte, ne, sql } from 'drizzle-orm'
import { llmCalls, type Db } from '@/server/db'
import type { AppContext } from '@/server/context'
import { DEFAULT_BUDGET_TOKENS, type TokenBudget, type TokenCount } from './types'

/** First instant of the current UTC month, ISO. */
export function monthStartIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

/** Sum of non-replay tokens in llm_calls since `since` (all owners: the budget is per deployment). */
export async function sumD1Usage(db: Db, opts: { since: string }): Promise<TokenCount & { calls: number }> {
  const [row] = await db
    .select({
      inputTokens: sql<number>`coalesce(sum(${llmCalls.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${llmCalls.outputTokens}), 0)`,
      calls: count(),
    })
    .from(llmCalls)
    .where(and(ne(llmCalls.mode, 'replay'), gte(llmCalls.createdAt, opts.since)))
  return { inputTokens: Number(row?.inputTokens ?? 0), outputTokens: Number(row?.outputTokens ?? 0), calls: Number(row?.calls ?? 0) }
}

/** Deployed budget: sum over llm_calls rows. `add` is a no-op because d1CallLogger already wrote the row. */
export function d1Budget(db: Db, opts: { since: string; limit: number }): TokenBudget {
  return {
    limit: opts.limit,
    async used() {
      const u = await sumD1Usage(db, { since: opts.since })
      return { inputTokens: u.inputTokens, outputTokens: u.outputTokens }
    },
    async add() {},
  }
}

/** In-process budget (tests, one-off scripts). */
export function memoryBudget(limit: number = DEFAULT_BUDGET_TOKENS, initial: TokenCount = { inputTokens: 0, outputTokens: 0 }): TokenBudget & { state: TokenCount } {
  const state = { ...initial }
  return {
    limit,
    state,
    async used() {
      return { ...state }
    },
    async add(u) {
      state.inputTokens += u.inputTokens
      state.outputTokens += u.outputTokens
    },
  }
}

/** Shared dev/CLI counter at `.dev/llm-budget.json` (default). Node only: node:fs is loaded through this dynamic import. */
export async function fileBudget(path?: string): Promise<TokenBudget> {
  const m = await import('./node/file-budget')
  return m.createFileBudget(path)
}

/** NEXTJS_ENV=development → fileBudget (shared with CLI); otherwise d1Budget since LLM_BUDGET_SINCE ?? current UTC month. */
export async function appBudget(c: AppContext): Promise<TokenBudget> {
  const env = c.get('env')
  if (env.NEXTJS_ENV === 'development') return fileBudget()
  return d1Budget(c.get('db'), { since: env.LLM_BUDGET_SINCE ?? monthStartIso(), limit: env.LLM_BUDGET_TOKENS ?? DEFAULT_BUDGET_TOKENS })
}
