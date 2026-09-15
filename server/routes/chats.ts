import { Hono } from 'hono'
import { ChatMessagesQuerySchema, IdParamSchema } from '@/contracts'
import type { AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { notImplemented } from './_stub'

// owner: chat (core bootstrap stub)
const route = new Hono<AppEnv>()
  .get('/chats/:id', validator('param', IdParamSchema), (c) => notImplemented(c))
  .get('/chats/:id/messages', validator('param', IdParamSchema), validator('query', ChatMessagesQuerySchema), (c) =>
    notImplemented(c),
  )
  .get('/attachments/:id', validator('param', IdParamSchema), (c) => notImplemented(c))

export default route
