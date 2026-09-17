import { getCloudflareContext } from '@opennextjs/cloudflare'
import { drizzle } from 'drizzle-orm/d1'
import { cache } from 'react'
import type { Db } from './owned'
import * as schema from './schema'

/** CLI/tests/middleware: wrap a D1 binding. One per request — never a module-level singleton. */
export function createDb(d1: D1Database): Db {
  return drizzle(d1, { schema })
}

/** Server Components: one Db per React render (cache()). Hono handlers use `c.var.db` instead. */
export const getDb = cache((): Db => createDb(getCloudflareContext().env.DB))
