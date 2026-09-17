import { Hono } from 'hono'
import { SearchQuerySchema, type SearchResponse } from '@/contracts'
import { requireUser, type AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { searchAll } from '@/server/search'

// owner: search — GET /api/search?q=&limit=&types= (ARCHITECTURE §2.4)
const route = new Hono<AppEnv>().get('/search', validator('query', SearchQuerySchema), async (c) => {
  const user = requireUser(c)
  const { q, limit, types } = c.req.valid('query')
  const body: SearchResponse = await searchAll(c.var.db, user.id, q, { limit, types })
  return c.json(body)
})

export default route
