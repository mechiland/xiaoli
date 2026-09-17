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
  type MergePersonResponse,
  type SplitPersonResponse,
} from '@/contracts'
import { requireUser, type AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { addClaim, addDate, addEvent, addRelation, createPerson, mergePersons, splitHandle } from '@/server/review'

// owner: review. Registered before people.ts so /people/:id/<action> wins.
const route = new Hono<AppEnv>()
  .post('/people', validator('json', CreatePersonRequestSchema), async (c) => {
    const user = requireUser(c)
    return c.json({ person: await createPerson(c.var.db, user.id, c.req.valid('json').label) }, 201)
  })
  .post('/people/:id/merge', validator('param', IdParamSchema), validator('json', MergePersonRequestSchema), async (c) => {
    const user = requireUser(c)
    const res = await mergePersons(c.var.db, user.id, c.req.valid('param').id, c.req.valid('json').intoId)
    return c.json(res satisfies MergePersonResponse)
  })
  .post('/people/:id/split', validator('param', IdParamSchema), validator('json', SplitPersonRequestSchema), async (c) => {
    const user = requireUser(c)
    const body = c.req.valid('json')
    const res = await splitHandle(c.var.db, user.id, c.req.valid('param').id, body.handleId, body.into)
    return c.json(res satisfies SplitPersonResponse)
  })
  .post('/people/:id/claims', validator('param', IdParamSchema), validator('json', AddClaimRequestSchema), async (c) => {
    const user = requireUser(c)
    return c.json({ claim: await addClaim(c.var.db, user.id, c.req.valid('param').id, c.req.valid('json')) }, 201)
  })
  .post('/people/:id/dates', validator('param', IdParamSchema), validator('json', AddDateRequestSchema), async (c) => {
    const user = requireUser(c)
    return c.json({ date: await addDate(c.var.db, user.id, c.req.valid('param').id, c.req.valid('json')) }, 201)
  })
  .post('/people/:id/relations', validator('param', IdParamSchema), validator('json', AddRelationRequestSchema), async (c) => {
    const user = requireUser(c)
    return c.json({ relation: await addRelation(c.var.db, user.id, c.req.valid('param').id, c.req.valid('json')) }, 201)
  })
  .post('/people/:id/events', validator('param', IdParamSchema), validator('json', AddEventRequestSchema), async (c) => {
    const user = requireUser(c)
    return c.json({ event: await addEvent(c.var.db, user.id, c.req.valid('param').id, c.req.valid('json')) }, 201)
  })

export default route
