// Shared dev/CLI token counter `.dev/llm-budget.json` (ARCHITECTURE §5). Node only.
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_BUDGET_TOKENS, type TokenBudget } from '../types'
import { writeFileAtomic } from './fs-io'

export const DEFAULT_BUDGET_PATH = '.dev/llm-budget.json'
const LOCK_STALE_MS = 2_000
const LOCK_WAIT_MS = 10_000

export interface BudgetFile {
  loopId: string
  startedAt: string
  limit: number
  inputTokens: number
  outputTokens: number
}

export function envBudgetLimit(): number {
  const n = Number(process.env.LLM_BUDGET_TOKENS)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_BUDGET_TOKENS
}

export function resolveBudgetPath(p?: string): string {
  return path.resolve(process.cwd(), p ?? DEFAULT_BUDGET_PATH)
}

function lockPathOf(file: string): string {
  return file.endsWith('.json') ? `${file.slice(0, -'.json'.length)}.lock` : `${file}.lock`
}

/** null when missing; throws on a corrupt file (callers fail closed). */
export async function readBudgetFile(p?: string): Promise<BudgetFile | null> {
  const file = resolveBudgetPath(p)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  const o = JSON.parse(text) as Partial<BudgetFile>
  const ok =
    typeof o.loopId === 'string' &&
    typeof o.startedAt === 'string' &&
    Number.isInteger(o.limit) &&
    (o.limit as number) > 0 &&
    Number.isFinite(o.inputTokens) &&
    Number.isFinite(o.outputTokens)
  if (!ok) throw new Error(`invalid budget file ${path.relative(process.cwd(), file)}`)
  return o as BudgetFile
}

async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lock = lockPathOf(file)
  await mkdir(path.dirname(lock), { recursive: true })
  const started = Date.now()
  for (;;) {
    try {
      const h = await open(lock, 'wx')
      await h.close()
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      const st = await stat(lock).catch(() => null)
      if (st && Date.now() - st.mtimeMs > LOCK_STALE_MS) {
        await rm(lock, { force: true })
        continue
      }
      if (Date.now() - started > LOCK_WAIT_MS) throw new Error('timed out waiting for the budget lock')
      await new Promise((r) => setTimeout(r, 15 + Math.random() * 20))
    }
  }
  try {
    return await fn()
  } finally {
    await rm(lock, { force: true })
  }
}

function fresh(loopId: string, limit: number): BudgetFile {
  return { loopId, startedAt: new Date().toISOString(), limit, inputTokens: 0, outputTokens: 0 }
}

export async function createFileBudget(p?: string): Promise<TokenBudget & { file: string }> {
  const file = resolveBudgetPath(p)
  const initial = await readBudgetFile(file)
  const budget = {
    file,
    limit: initial?.limit ?? envBudgetLimit(),
    async used() {
      const s = await readBudgetFile(file)
      if (s) budget.limit = s.limit
      return { inputTokens: s?.inputTokens ?? 0, outputTokens: s?.outputTokens ?? 0 }
    },
    async add(u: { inputTokens: number; outputTokens: number }) {
      await withLock(file, async () => {
        const s = (await readBudgetFile(file)) ?? fresh('unset', envBudgetLimit())
        s.inputTokens += u.inputTokens
        s.outputTokens += u.outputTokens
        await writeFileAtomic(file, `${JSON.stringify(s, null, 2)}\n`)
        budget.limit = s.limit
      })
    },
  }
  return budget
}

/** Start of a loop: zero the counters, set loopId/startedAt (and limit, default env LLM_BUDGET_TOKENS or 3M). */
export async function resetFileBudget(p: string | undefined, opts: { loopId: string; limit?: number }): Promise<BudgetFile> {
  const file = resolveBudgetPath(p)
  const next = fresh(opts.loopId, opts.limit ?? envBudgetLimit())
  await withLock(file, () => writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`))
  return next
}
