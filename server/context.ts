import type { Context } from 'hono'
import type { Db } from '@/server/db'
import type { ServerEnv } from '@/server/env'
import { errors } from '@/server/errors'

export interface SessionUser {
  id: string
  email: string
  name: string
}

/** Hono env for every router (ARCHITECTURE §1, §3). */
export type AppEnv = {
  Variables: {
    /** validated server env incl. DB/R2 bindings */
    env: ServerEnv
    /** one Drizzle client per request */
    db: Db
    /** null only on the unauthenticated paths (/api/auth/*, /api/health) */
    user: SessionUser | null
    /**
     * Test-only hook: createTestApp() puts a scripted LlmClient here so `getAppLlm(c)` (llm module) can return it.
     * Always undefined in the running app.
     */
    llmOverride?: unknown
  }
}

export type AppContext = Context<AppEnv>

/** The signed-in user; throws 401 when absent (the session middleware already rejects those requests centrally). */
export function requireUser(c: Context<AppEnv>): SessionUser {
  const user = c.get('user')
  if (!user) throw errors.unauthorized()
  return user
}

export function getR2(c: Context<AppEnv>): R2Bucket {
  const r2 = c.get('env').R2
  if (!r2) throw errors.internal()
  return r2
}
