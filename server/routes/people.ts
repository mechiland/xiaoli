import { Hono } from 'hono'
import { IdParamSchema, PatchPersonRequestSchema } from '@/contracts'
import type { AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { notImplemented } from './_stub'

// owner: person (core bootstrap stub)
const route = new Hono<AppEnv>()
  .get('/people/:id', validator('param', IdParamSchema), (c) => notImplemented(c))
  .patch('/people/:id', validator('param', IdParamSchema), validator('json', PatchPersonRequestSchema), (c) =>
    notImplemented(c),
  )
  .delete('/people/:id', validator('param', IdParamSchema), (c) => notImplemented(c))

export default route
