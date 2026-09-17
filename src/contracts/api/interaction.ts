import { z } from 'zod'
import { Id, LoopCloseReason, MsgTime } from '../common'
import { ConversationDTOSchema, LoopDTOSchema, RhythmDTOSchema, SegmentDTOSchema } from '../entities'

// Interaction API (ARCHITECTURE §2.4; SPEC §7 交互层, §9.5「来往」, §9.9「这次聊了什么」).

export const InteractionQuerySchema = z.object({
  /** conversations to return; 'all' is the 更早 expansion */
  timeline: z.union([z.coerce.number().int().min(0).max(200), z.literal('all')]).optional(),
})
export type InteractionQuery = z.infer<typeof InteractionQuerySchema>

export const InteractionResponseSchema = z.object({
  rhythm: RhythmDTOSchema,
  /** open + expired, oldest first; done/dropped live in `closed` */
  loops: z.array(LoopDTOSchema),
  /** closed ones, for the person page 历史 */
  closed: z.array(LoopDTOSchema),
  conversations: z.array(ConversationDTOSchema),
  hasMore: z.boolean(),
})
export type InteractionResponse = z.infer<typeof InteractionResponseSchema>

export const ImportInteractionResponseSchema = z.object({
  conversations: z.array(ConversationDTOSchema),
})
export type ImportInteractionResponse = z.infer<typeof ImportInteractionResponseSchema>

export const CloseLoopRequestSchema = z.object({ reason: LoopCloseReason })
export type CloseLoopRequest = z.infer<typeof CloseLoopRequestSchema>

export const LoopResponseSchema = z.object({ loop: LoopDTOSchema })
export type LoopResponse = z.infer<typeof LoopResponseSchema>

export const PatchSegmentRequestSchema = z
  .object({ summary: z.string().trim().min(1).max(300).optional(), hidden: z.boolean().optional() })
  .refine((v) => v.summary !== undefined || v.hidden !== undefined, { message: 'nothing to patch' })
export type PatchSegmentRequest = z.infer<typeof PatchSegmentRequestSchema>

export const SegmentResponseSchema = z.object({ segment: SegmentDTOSchema })
export type SegmentResponse = z.infer<typeof SegmentResponseSchema>

/** A 来往 hit in the search overlay (SPEC §9.8). */
export const InteractionSearchHitSchema = z.object({
  kind: z.enum(['segment', 'loop']),
  id: Id,
  person: z.object({ id: Id, label: z.string() }).nullable(),
  chatId: Id.nullable(),
  chatTitle: z.string().nullable(),
  at: MsgTime,
  text: z.string(),
  href: z.string(),
  highlights: z.array(z.tuple([z.number().int(), z.number().int()])),
})
export type InteractionSearchHit = z.infer<typeof InteractionSearchHitSchema>
