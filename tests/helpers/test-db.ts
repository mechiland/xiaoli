// Backend test helpers (ARCHITECTURE §4.3). Tests never touch the dev server's D1 state:
// each createTestDb() is an in-memory getPlatformProxy with drizzle/*.sql applied in order.
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { buildApp } from '@/server/app'
import { createDb, user, type Db } from '@/server/db'
import type { LlmClient, LlmError, LlmJsonRequest, LlmJsonResult } from '@/server/llm'

const ROOT = path.resolve(__dirname, '..', '..')
export const TEST_AUTH_SECRET = 'test-only-secret-not-used-anywhere-else-000000'

export function migrationStatements(dir = path.join(ROOT, 'drizzle')): string[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const statements: string[] = []
  for (const f of files) {
    const sql = readFileSync(path.join(dir, f), 'utf8')
    for (const chunk of sql.split('--> statement-breakpoint')) {
      const stmt = chunk
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .trim()
      if (stmt) statements.push(stmt)
    }
  }
  return statements
}

export async function createTestDb(): Promise<{ db: Db; d1: D1Database; r2: R2Bucket; dispose(): Promise<void> }> {
  const proxy = await getPlatformProxy<CloudflareEnv>({ configPath: path.join(ROOT, 'wrangler.jsonc'), persist: false })
  const d1 = proxy.env.DB
  for (const stmt of migrationStatements()) {
    await d1.prepare(stmt).run()
  }
  return { db: createDb(d1), d1, r2: proxy.env.R2, dispose: () => proxy.dispose() }
}

/** Inserts a Better Auth user row directly (no password; use the auth routes to test sign-in). */
export async function createTestUser(db: Db, email: string, name = email.split('@')[0]): Promise<{ id: string; email: string; name: string }> {
  const id = randomUUID()
  const now = new Date()
  await db.insert(user).values({ id, email, name, emailVerified: false, createdAt: now, updatedAt: now })
  return { id, email, name }
}

/** Minimal structural LLM client for tests without cassettes (the real interface lives in @/server/llm). */
export type ScriptedLlmStep = LlmJsonResult | LlmError | ((req: LlmJsonRequest) => LlmJsonResult | LlmError | Promise<LlmJsonResult | LlmError>)
export type ScriptedLlmClient = LlmClient & { calls: LlmJsonRequest[] }

/** Returns scripted results in order (last one repeats); a function entry receives the request. (core request llm#1) */
export function fakeLlm(script: ScriptedLlmStep[]): ScriptedLlmClient {
  const calls: LlmJsonRequest[] = []
  return {
    calls,
    async completeJson(req: LlmJsonRequest) {
      calls.push(req)
      const step = script[Math.min(calls.length - 1, script.length - 1)]
      return typeof step === 'function' ? step(req) : step
    },
  }
}

/**
 * Hono app wired to a test DB. With `userId`, requests are authenticated as that user (no cookies needed);
 * without it, the real Better Auth session middleware runs (use the /api/auth routes).
 */
export function createTestApp(opts: { db: Db; r2?: R2Bucket; llm?: LlmClient; userId?: string | null; env?: Record<string, unknown> }) {
  const d1 = (opts.db as unknown as { $client: D1Database }).$client
  const platform = {
    DB: d1,
    R2: opts.r2,
    BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
    BETTER_AUTH_URL: 'http://localhost:3000',
    NEXTJS_ENV: 'test',
    ...opts.env,
  }
  return buildApp({
    platformEnv: () => platform,
    llmOverride: opts.llm,
    resolveUser:
      opts.userId === undefined
        ? undefined
        : async (_c, db) => {
            if (!opts.userId) return null
            const row = await db.query.user.findFirst({ where: (u, { eq }) => eq(u.id, opts.userId!) })
            return row ? { id: row.id, email: row.email, name: row.name } : null
          },
  })
}
