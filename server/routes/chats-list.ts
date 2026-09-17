import { Hono } from 'hono'
import { ChatsListQuerySchema, type ChatsListResponse } from '@/contracts'
import { requireUser, type AppEnv } from '@/server/context'
import { recommendChats } from '@/server/import/suggest'
import { validator } from '@/server/middleware/validate'

// owner: import — GET /api/chats?senders=a,b (every chat of the owner, recommended first)
const route = new Hono<AppEnv>().get('/chats', validator('query', ChatsListQuerySchema), async (c) => {
  const user = requireUser(c)
  const senders = (c.req.valid('query').senders ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200)
  const chats = await recommendChats(c.var.db, user.id, senders)
  return c.json({ chats } satisfies ChatsListResponse)
})

export default route
