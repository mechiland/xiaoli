import { Hono } from 'hono'
import { EvidenceParamSchema, EvidenceQuerySchema } from '@/contracts'
import type { AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { notImplemented } from './_stub'

// owner: review (core bootstrap stub)
const route = new Hono<AppEnv>().get(
  '/evidence/:type/:id',
  validator('param', EvidenceParamSchema),
  validator('query', EvidenceQuerySchema),
  (c) => notImplemented(c),
)

export default route
