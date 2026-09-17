import { Hono } from 'hono'
import { PeopleIndexQuerySchema, type PeopleIndexResponse } from '@/contracts'
import { requireUser, type AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { listPeopleIndex } from '@/server/search'

// owner: search — GET /api/people?index=pinyin (ARCHITECTURE §2.4). `index` is optional; pinyin grouping is the only index.
const route = new Hono<AppEnv>().get('/people', validator('query', PeopleIndexQuerySchema), async (c) => {
  const user = requireUser(c)
  const body: PeopleIndexResponse = await listPeopleIndex(c.var.db, user.id)
  return c.json(body)
})

export default route
