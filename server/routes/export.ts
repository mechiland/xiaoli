import { Hono } from 'hono'
import { DeleteAllRequestSchema } from '@/contracts'
import type { AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { notImplemented } from './_stub'

// owner: settings (core bootstrap stub)
const route = new Hono<AppEnv>()
  .get('/export', (c) => notImplemented(c))
  .delete('/data', validator('json', DeleteAllRequestSchema), (c) => notImplemented(c))

export default route
