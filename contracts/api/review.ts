import { z } from 'zod'
import { Category, Id, IsoString, LoopDirection, LoopKind, PartialDate, SourceKind, TargetType } from '../common'
import {
  CalendarSchema,
  ClaimDTOSchema,
  EventDTOSchema,
  EvidenceItemDTOSchema,
  HandleDTOSchema,
  ImportantDateDTOSchema,
  LoopDTOSchema,
  RelationDTOSchema,
} from '../entities'

export const ReviewParamSchema = z.object({ type: TargetType, id: z.coerce.number().int().positive() })
export type ReviewParam = z.infer<typeof ReviewParamSchema>

export const ReviewRequestSchema = z.object({
  action: z.enum(['accept', 'reject', 'edit', 'supersede', 'delete']),
  patch: z
    .object({
      statement: z.string().trim().min(1).max(500).optional(),
      category: Category.optional(),
      validFrom: PartialDate.optional(),
      value: z.string().trim().min(1).max(60).optional(),
      label: z.string().max(60).optional(),
      type: z.string().min(1).max(30).optional(),
      summary: z.string().trim().min(1).max(200).optional(),
      happenedAt: PartialDate.optional(),
      place: z.string().max(60).optional(),
      month: z.number().int().min(1).max(12).optional(),
      day: z.number().int().min(1).max(31).optional(),
      year: z.number().int().optional(),
      calendar: CalendarSchema.optional(),
      // loop (SPEC §7 交互层). `text` rather than `statement`: a loop is a thing to do, not an assertion.
      text: z.string().trim().min(1).max(300).optional(),
      /** null clears the due date */
      dueAt: PartialDate.nullable().optional(),
      kind: LoopKind.optional(),
      direction: LoopDirection.optional(),
    })
    .optional(),
  /** supersede "现在的情况" */
  replacement: z.object({ statement: z.string().trim().min(1).max(500) }).optional(),
})
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>

export const ReviewResponseSchema = z.object({
  item: z.union([ClaimDTOSchema, HandleDTOSchema, RelationDTOSchema, EventDTOSchema, ImportantDateDTOSchema, LoopDTOSchema]),
  superseded: z.array(ClaimDTOSchema).optional(),
  created: ClaimDTOSchema.optional(),
})
export type ReviewResponse = z.infer<typeof ReviewResponseSchema>

export const BulkReviewRequestSchema = z.object({
  items: z.array(z.object({ type: TargetType, id: Id })).min(1).max(500),
  action: z.enum(['accept', 'reject']),
})
export type BulkReviewRequest = z.infer<typeof BulkReviewRequestSchema>
export const BulkReviewResponseSchema = z.object({
  updated: z.number().int().nonnegative(),
  failed: z.array(z.object({ type: TargetType, id: Id, code: z.string() })),
})
export type BulkReviewResponse = z.infer<typeof BulkReviewResponseSchema>

export const EvidenceParamSchema = ReviewParamSchema
export const EvidenceQuerySchema = z.object({ context: z.coerce.number().int().min(0).max(10).optional() })
export type EvidenceQuery = z.infer<typeof EvidenceQuerySchema>

export const EvidenceResponseSchema = z.object({
  target: z.object({ type: TargetType, id: Id }),
  sourceKind: SourceKind,
  manualAddedAt: IsoString.nullable(),
  items: z.array(EvidenceItemDTOSchema),
})
export type EvidenceResponse = z.infer<typeof EvidenceResponseSchema>
