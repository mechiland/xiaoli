import { Hono } from 'hono'
import { IdParamSchema, PatchPersonRequestSchema, type DeletePersonResponse, type PersonResponse } from '@/contracts'
import { requireUser, type AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { deletePerson, getProfile, patchPerson } from '@/server/person'

// owner: person (ARCHITECTURE §1.7). people-actions (review) registers /people/:id/<action> before this file.
const route = new Hono<AppEnv>()
  .get('/people/:id', validator('param', IdParamSchema), async (c) => {
    const user = requireUser(c)
    return c.json(await getProfile(c.var.db, user.id, c.req.valid('param').id))
  })
  .patch('/people/:id', validator('param', IdParamSchema), validator('json', PatchPersonRequestSchema), async (c) => {
    const user = requireUser(c)
    const person = await patchPerson(c.var.db, user.id, c.req.valid('param').id, c.req.valid('json'))
    return c.json({ person } satisfies PersonResponse)
  })
  .delete('/people/:id', validator('param', IdParamSchema), async (c) => {
    const user = requireUser(c)
    const res = await deletePerson(c.var.db, c.var.env.R2, user.id, c.req.valid('param').id)
    return c.json(res satisfies DeletePersonResponse)
  })

export default route
