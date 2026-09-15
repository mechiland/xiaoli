import { Hono } from 'hono'
import { ChatMessagesQuerySchema, IdParamSchema, type ChatDetailResponse, type ChatMessagesResponse } from '@/contracts'
import { getAttachmentStream, getChatDetail, listChatMessages } from '@/server/chat'
import { getR2, requireUser, type AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'

// owner: chat
const route = new Hono<AppEnv>()
  .get('/chats/:id', validator('param', IdParamSchema), async (c) => {
    const user = requireUser(c)
    return c.json((await getChatDetail(c.var.db, user.id, c.req.valid('param').id)) satisfies ChatDetailResponse)
  })
  .get('/chats/:id/messages', validator('param', IdParamSchema), validator('query', ChatMessagesQuerySchema), async (c) => {
    const user = requireUser(c)
    const res = await listChatMessages(c.var.db, user.id, c.req.valid('param').id, c.req.valid('query'))
    return c.json(res satisfies ChatMessagesResponse)
  })
  .get('/attachments/:id', validator('param', IdParamSchema), async (c) => {
    const user = requireUser(c)
    const s = await getAttachmentStream(c.var.db, getR2(c), user.id, c.req.valid('param').id, { ifNoneMatch: c.req.header('if-none-match'), download: c.req.query('download') === '1' })
    if (s.notModified) return c.body(null, 304, s.headers)
    return c.body(s.body as ReadableStream, 200, s.headers)
  })

export default route
