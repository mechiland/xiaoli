import { Hono } from 'hono'
import { IdParamSchema, type ImportReviewResponse } from '@/contracts'
import { requireUser, type AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { getImportReview } from '@/server/review'

// owner: review
const route = new Hono<AppEnv>().get('/imports/:id/review', validator('param', IdParamSchema), async (c) => {
  const user = requireUser(c)
  const { id } = c.req.valid('param')
  return c.json((await getImportReview(c.var.db, user.id, id)) satisfies ImportReviewResponse)
})

export default route
