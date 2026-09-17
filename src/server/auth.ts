import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { createDb, type Db } from '@/server/db'
import * as authSchema from '@/server/db/schema/auth'
import { EnvValidationError, type ServerEnv } from '@/server/env'
import { authOptions } from './auth.config'

/**
 * Better Auth instance per request (SPEC §4): the D1 binding only exists inside a request.
 * Pass the request's `db` so auth and handlers share one Drizzle wrapper (avoids local WAL write-lock contention).
 */
export function getAuth(env: Pick<ServerEnv, 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL' | 'DB'>, db?: Db) {
  if (!env.BETTER_AUTH_SECRET) throw new EnvValidationError(['BETTER_AUTH_SECRET'])
  const database = db ?? (env.DB ? createDb(env.DB) : null)
  if (!database) throw new EnvValidationError(['DB'])
  const baseURL = env.BETTER_AUTH_URL ?? 'http://localhost:3000'
  return betterAuth({
    ...authOptions,
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(database, { provider: 'sqlite', schema: authSchema }),
  })
}

export type Auth = ReturnType<typeof getAuth>
