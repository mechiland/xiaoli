import { z } from 'zod'
import { Id } from '../common'
import { ChatDTOSchema, ImportDTOSchema, MessageDTOSchema, PersonRefDTOSchema } from '../entities'

export const ChatsListQuerySchema = z.object({
  /** comma-separated sender names, for recommendation */
  senders: z.string().optional(),
})
export type ChatsListQuery = z.infer<typeof ChatsListQuerySchema>
export const ChatsListResponseSchema = z.object({
  chats: z.array(ChatDTOSchema.extend({ matchReason: z.string().nullable(), score: z.number() })),
})
export type ChatsListResponse = z.infer<typeof ChatsListResponseSchema>

export const ChatDetailResponseSchema = z.object({
  chat: ChatDTOSchema,
  participants: z.array(PersonRefDTOSchema.extend({ messageCount: z.number().int().nonnegative() })),
  imports: z.array(ImportDTOSchema.pick({ id: true, dateFrom: true, dateTo: true, createdAt: true, newMessageCount: true })),
})
export type ChatDetailResponse = z.infer<typeof ChatDetailResponseSchema>

export const ChatMessagesQuerySchema = z.object({
  around: z.coerce.number().int().positive().optional(),
  before: z.coerce.number().int().min(0).max(500).optional(),
  after: z.coerce.number().int().min(0).max(500).optional(),
  cursor: z.coerce.number().int().optional(),
  dir: z.enum(['older', 'newer']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  personId: z.coerce.number().int().positive().optional(),
})
export type ChatMessagesQuery = z.infer<typeof ChatMessagesQuerySchema>

export const ChatMessagesResponseSchema = z.object({
  messages: z.array(MessageDTOSchema),
  hasOlder: z.boolean(),
  hasNewer: z.boolean(),
  anchorId: Id.nullable(),
})
export type ChatMessagesResponse = z.infer<typeof ChatMessagesResponseSchema>
