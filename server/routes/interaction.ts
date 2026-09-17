import { Hono } from 'hono'
import {
  CloseLoopRequestSchema,
  IdParamSchema,
  InteractionQuerySchema,
  PatchSegmentRequestSchema,
  type ImportInteractionResponse,
  type InteractionResponse,
  type LoopResponse,
  type SegmentResponse,
} from '@/contracts'
import { requireUser, type AppEnv } from '@/server/context'
import { closeLoop, getImportInteraction, getPersonInteraction, patchSegment, reopenLoop } from '@/server/interaction'
import { validator } from '@/server/middleware/validate'

// interaction module (ARCHITECTURE §1.17). Registered before people.ts / imports.ts so the more specific
// paths win.
const route = new Hono<AppEnv>()
  .get('/people/:id/interaction', validator('param', IdParamSchema), validator('query', InteractionQuerySchema), async (c) => {
    const user = requireUser(c)
    const body = await getPersonInteraction(c.var.db, user.id, c.req.valid('param').id, { timeline: c.req.valid('query').timeline })
    return c.json(body satisfies InteractionResponse)
  })
  .get('/imports/:id/interaction', validator('param', IdParamSchema), async (c) => {
    const user = requireUser(c)
    const body = await getImportInteraction(c.var.db, user.id, c.req.valid('param').id)
    return c.json(body satisfies ImportInteractionResponse)
  })
  .post('/loops/:id/close', validator('param', IdParamSchema), validator('json', CloseLoopRequestSchema), async (c) => {
    const user = requireUser(c)
    const loop = await closeLoop(c.var.db, user.id, c.req.valid('param').id, c.req.valid('json').reason)
    return c.json({ loop } satisfies LoopResponse)
  })
  .post('/loops/:id/reopen', validator('param', IdParamSchema), async (c) => {
    const user = requireUser(c)
    const loop = await reopenLoop(c.var.db, user.id, c.req.valid('param').id)
    return c.json({ loop } satisfies LoopResponse)
  })
  .patch('/segments/:id', validator('param', IdParamSchema), validator('json', PatchSegmentRequestSchema), async (c) => {
    const user = requireUser(c)
    const segment = await patchSegment(c.var.db, user.id, c.req.valid('param').id, c.req.valid('json'))
    return c.json({ segment } satisfies SegmentResponse)
  })

export default route
