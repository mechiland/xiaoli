import { Hono } from 'hono'
import {
  AddClaimRequestSchema,
  AddDateRequestSchema,
  AddEventRequestSchema,
  AddRelationRequestSchema,
  CreatePersonRequestSchema,
  IdParamSchema,
  MergePersonRequestSchema,
  SplitPersonRequestSchema,
} from '@/contracts'
import type { AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { notImplemented } from './_stub'

// owner: review (core bootstrap stub). Registered before people.ts so /people/:id/<action> wins.
const route = new Hono<AppEnv>()
  .post('/people', validator('json', CreatePersonRequestSchema), (c) => notImplemented(c))
  .post('/people/:id/merge', validator('param', IdParamSchema), validator('json', MergePersonRequestSchema), (c) =>
    notImplemented(c),
  )
  .post('/people/:id/split', validator('param', IdParamSchema), validator('json', SplitPersonRequestSchema), (c) =>
    notImplemented(c),
  )
  .post('/people/:id/claims', validator('param', IdParamSchema), validator('json', AddClaimRequestSchema), (c) =>
    notImplemented(c),
  )
  .post('/people/:id/dates', validator('param', IdParamSchema), validator('json', AddDateRequestSchema), (c) =>
    notImplemented(c),
  )
  .post('/people/:id/relations', validator('param', IdParamSchema), validator('json', AddRelationRequestSchema), (c) =>
    notImplemented(c),
  )
  .post('/people/:id/events', validator('param', IdParamSchema), validator('json', AddEventRequestSchema), (c) =>
    notImplemented(c),
  )

export default route
