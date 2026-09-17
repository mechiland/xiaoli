import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { Context, MiddlewareHandler } from 'hono'
import { getAuth } from '@/server/auth'
import type { AppEnv, SessionUser } from '@/server/context'
import { createDb, type Db } from '@/server/db'
import { EnvValidationError, parseServerEnv, type ServerEnv } from '@/server/env'
import { errors } from '@/server/errors'
import { log } from './log'

/** Paths reachable without a session (DECISIONS A5 #31). */
export const PUBLIC_API_PATHS = ['/api/health'] as const

export interface AppDeps {
  /** Source of bindings/vars; default getCloudflareContext().env. Tests pass a getPlatformProxy env. */
  platformEnv?: () => Record<string, unknown>
  /** Test override: resolve the user without Better Auth cookies. */
  resolveUser?: (c: Context<AppEnv>, db: Db) => Promise<SessionUser | null>
  /** Test override: scripted LlmClient exposed as c.var.llmOverride. */
  llmOverride?: unknown
}

// Env is validated once per source object (per isolate in production, per process in dev).
const envCache = new WeakMap<object, ServerEnv>()

function resolveEnv(source: Record<string, unknown>): ServerEnv {
  const cached = envCache.get(source)
  if (cached) return cached
  const parsed = parseServerEnv(source)
  envCache.set(source, parsed)
  return parsed
}

/** Sets c.var.env and c.var.db for every /api request (auth handler included). */
export function platformMiddleware(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let env: ServerEnv
    try {
      const source = deps.platformEnv ? deps.platformEnv() : (getCloudflareContext().env as unknown as Record<string, unknown>)
      env = resolveEnv(source)
      if (!env.DB) throw new EnvValidationError(['DB'])
    } catch (err) {
      const variables = err instanceof EnvValidationError ? err.variables : ['<platform>']
      log('error', 'env_invalid', { variables })
      return c.json(errors.internal().toBody(), 500)
    }
    c.set('env', env)
    c.set('db', createDb(env.DB!))
    if (deps.llmOverride !== undefined) c.set('llmOverride', deps.llmOverride)
    await next()
  }
}

/** Resolves the session; rejects every non-public path without a user (401 envelope), so no route can forget auth. */
export function sessionMiddleware(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const db = c.get('db')
    let user: SessionUser | null = null
    if (deps.resolveUser) {
      user = await deps.resolveUser(c, db)
    } else {
      const session = await getAuth(c.get('env'), db).api.getSession({ headers: c.req.raw.headers })
      if (session) user = { id: session.user.id, email: session.user.email, name: session.user.name }
    }
    c.set('user', user)
    if (!user && !(PUBLIC_API_PATHS as readonly string[]).includes(c.req.path)) {
      return c.json(errors.unauthorized().toBody(), 401)
    }
    await next()
  }
}
