import { Hono } from 'hono'
import { EvidenceParamSchema, EvidenceQuerySchema, type EvidenceResponse } from '@/contracts'
import { requireUser, type AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { getEvidence } from '@/server/review'

// owner: review
const route = new Hono<AppEnv>().get(
  '/evidence/:type/:id',
  validator('param', EvidenceParamSchema),
  validator('query', EvidenceQuerySchema),
  async (c) => {
    const user = requireUser(c)
    const { type, id } = c.req.valid('param')
    const { context } = c.req.valid('query')
    return c.json((await getEvidence(c.var.db, user.id, type, id, context ?? 2)) satisfies EvidenceResponse)
  },
)

export default route
