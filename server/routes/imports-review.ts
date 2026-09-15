import { Hono } from 'hono'
import { IdParamSchema } from '@/contracts'
import type { AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { notImplemented } from './_stub'

// owner: review (core bootstrap stub)
const route = new Hono<AppEnv>().get('/imports/:id/review', validator('param', IdParamSchema), (c) => notImplemented(c))

export default route
