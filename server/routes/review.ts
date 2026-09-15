import { Hono } from 'hono'
import { BulkReviewRequestSchema, ReviewParamSchema, ReviewRequestSchema, type BulkReviewResponse, type ReviewResponse } from '@/contracts'
import { requireUser, type AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { applyReview, bulkReview } from '@/server/review'

// owner: review. bulk is registered before :type/:id.
const route = new Hono<AppEnv>()
  .post('/review/bulk', validator('json', BulkReviewRequestSchema), async (c) => {
    const user = requireUser(c)
    const body = c.req.valid('json')
    return c.json((await bulkReview(c.var.db, user.id, body.items, body.action)) satisfies BulkReviewResponse)
  })
  .post('/review/:type/:id', validator('param', ReviewParamSchema), validator('json', ReviewRequestSchema), async (c) => {
    const user = requireUser(c)
    const { type, id } = c.req.valid('param')
    const body = c.req.valid('json')
    const res = await applyReview(c.var.db, user.id, { type, id }, body.action, body.patch, { replacement: body.replacement })
    return c.json(res satisfies ReviewResponse)
  })

export default route
