import { Hono } from 'hono'
import { PeopleIndexQuerySchema } from '@/contracts'
import type { AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { notImplemented } from './_stub'

// owner: search (core bootstrap stub)
const route = new Hono<AppEnv>().get('/people', validator('query', PeopleIndexQuerySchema), (c) => notImplemented(c))

export default route
