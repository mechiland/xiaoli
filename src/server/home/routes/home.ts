import { Hono } from 'hono'
import type { HomeResponse } from '@/contracts'
import { requireUser, type AppEnv } from '@/server/context'
import { getHome } from '@/server/home'

// owner: home — GET /api/home (ARCHITECTURE §1.9, §2.4)
const route = new Hono<AppEnv>().get('/home', async (c) => {
  const user = requireUser(c)
  const body: HomeResponse = await getHome(c.var.db, user.id, { tz: c.var.env.APP_TZ })
  return c.json(body)
})

export default route
