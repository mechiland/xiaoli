import { Hono } from 'hono'
import { BulkReviewRequestSchema, ReviewParamSchema, ReviewRequestSchema } from '@/contracts'
import type { AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { notImplemented } from './_stub'

// owner: review (core bootstrap stub). bulk is registered before :type/:id.
const route = new Hono<AppEnv>()
  .post('/review/bulk', validator('json', BulkReviewRequestSchema), (c) => notImplemented(c))
  .post('/review/:type/:id', validator('param', ReviewParamSchema), validator('json', ReviewRequestSchema), (c) =>
    notImplemented(c),
  )

export default route
