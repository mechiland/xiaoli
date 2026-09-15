import { Hono } from 'hono'
import { ChatsListQuerySchema } from '@/contracts'
import type { AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { notImplemented } from './_stub'

// owner: import (core bootstrap stub)
const route = new Hono<AppEnv>().get('/chats', validator('query', ChatsListQuerySchema), (c) => notImplemented(c))

export default route
