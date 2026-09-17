import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import type { HealthResponse, MeResponse } from '@/contracts'
import { requireUser, type AppEnv } from '@/server/context'
import { getUserSettings } from '@/server/db'

// owner: core — GET /api/health (public), GET /api/me
const route = new Hono<AppEnv>()
  .get('/health', async (c) => {
    let db = false
    try {
      await c.var.db.run(sql`select 1`)
      db = true
    } catch {
      db = false
    }
    return c.json({ ok: true, db } satisfies HealthResponse)
  })
  .get('/me', async (c) => {
    const user = requireUser(c)
    const settings = await getUserSettings(c.var.db, user.id)
    return c.json({ user: { id: user.id, email: user.email, name: user.name }, settings } satisfies MeResponse)
  })

export default route
