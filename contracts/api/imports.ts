import { z } from 'zod'
import { ChatKind, Id, ImportStatus, IsoString, JobStatus, MsgTime, ProgressSchema, TargetType } from '../common'
import {
  AttachmentDTOSchema,
  ChatDTOSchema,
  ClaimDTOSchema,
  EventDTOSchema,
  HandleDTOSchema,
  ImportantDateDTOSchema,
  ImportDTOSchema,
  LoopDTOSchema,
  PersonRefDTOSchema,
  RelationDTOSchema,
} from '../entities'
import { MediaFileInfoSchema, ParsedMessageSchema } from '../parsed-export'

export const MAX_IMPORT_MESSAGES = 50_000

export const ImportCheckRequestSchema = z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) })
export type ImportCheckRequest = z.infer<typeof ImportCheckRequestSchema>
export const ImportCheckResponseSchema = z.union([
  z.object({ duplicate: z.literal(false) }),
  z.object({ duplicate: z.literal(true), importId: Id }),
])
export type ImportCheckResponse = z.infer<typeof ImportCheckResponseSchema>

export const CreateImportRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  exportedAt: IsoString.nullable(),
  parserVersion: z.string(),
  messages: z.array(ParsedMessageSchema).max(MAX_IMPORT_MESSAGES),
  media: z.array(MediaFileInfoSchema),
  /** attachment names */
  selectedAttachments: z.array(z.string()),
})
export type CreateImportRequest = z.infer<typeof CreateImportRequestSchema>

const SuggestionCandidate = z.object({ personId: Id, label: z.string(), reason: z.string() })

export const MappingSuggestionsSchema = z.object({
  chats: z.array(ChatDTOSchema.extend({ matchReason: z.string(), score: z.number() })),
  senders: z.array(
    z.object({
      senderName: z.string(),
      count: z.number().int().nonnegative(),
      suggested: z.union([z.object({ self: z.literal(true) }), SuggestionCandidate]).nullable(),
      candidates: z.array(SuggestionCandidate),
    }),
  ),
  preselectKind: ChatKind.nullable(),
})
export type MappingSuggestions = z.infer<typeof MappingSuggestionsSchema>

export const CreateImportResponseSchema = z.object({ import: ImportDTOSchema, suggestions: MappingSuggestionsSchema })
export type CreateImportResponse = z.infer<typeof CreateImportResponseSchema>

export const AttachmentNameParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  name: z.string().min(1),
})
export const UploadAttachmentResponseSchema = z.object({ attachment: AttachmentDTOSchema })
export type UploadAttachmentResponse = z.infer<typeof UploadAttachmentResponseSchema>
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024

export const ImportDetailResponseSchema = z.object({
  import: ImportDTOSchema,
  chat: ChatDTOSchema.nullable(),
  progress: ProgressSchema,
  uploads: z.object({
    selected: z.number().int().nonnegative(),
    uploaded: z.number().int().nonnegative(),
    pendingNames: z.array(z.string()),
  }),
  persons: z.array(PersonRefDTOSchema),
})
export type ImportDetailResponse = z.infer<typeof ImportDetailResponseSchema>

export const MappingSenderTargetSchema = z.union([
  z.object({ self: z.literal(true) }),
  z.object({ personId: Id }),
  z.object({ newPerson: z.object({ label: z.string().trim().min(1).max(60) }) }),
])
export type MappingSenderTarget = z.infer<typeof MappingSenderTargetSchema>

export const MappingRequestSchema = z.object({
  chat: z.union([
    z.object({ existingChatId: Id }),
    z.object({ new: z.object({ title: z.string().trim().min(1).max(80), kind: ChatKind }) }),
  ]),
  senders: z.array(z.object({ senderName: z.string(), target: MappingSenderTargetSchema })).min(1),
})
export type MappingRequest = z.infer<typeof MappingRequestSchema>

export const MappingResponseSchema = z.object({
  import: ImportDTOSchema,
  chat: ChatDTOSchema,
  jobsCreated: z.number().int().nonnegative(),
  newMessageCount: z.number().int().nonnegative(),
})
export type MappingResponse = z.infer<typeof MappingResponseSchema>

export const JobsNextRequestSchema = z.object({}).strict()
export type JobsNextRequest = z.infer<typeof JobsNextRequestSchema>
export const JobsNextResponseSchema = z.object({
  processed: z
    .object({ jobId: Id, status: JobStatus, itemsCreated: z.number().int().nonnegative(), code: z.string().optional() })
    .nullable(),
  progress: ProgressSchema,
  importStatus: ImportStatus,
})
export type JobsNextResponse = z.infer<typeof JobsNextResponseSchema>

export const JobsRetryRequestSchema = z.object({ jobIds: z.array(Id).optional() }).strict()
export type JobsRetryRequest = z.infer<typeof JobsRetryRequestSchema>
export const JobsRetryResponseSchema = z.object({ reset: z.number().int().nonnegative(), progress: ProgressSchema })
export type JobsRetryResponse = z.infer<typeof JobsRetryResponseSchema>

export const ReviewItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('claim'), item: ClaimDTOSchema, replaces: ClaimDTOSchema.nullable() }),
  z.object({ type: z.literal('handle'), item: HandleDTOSchema }),
  z.object({ type: z.literal('relation'), item: RelationDTOSchema }),
  z.object({ type: z.literal('date'), item: ImportantDateDTOSchema }),
  z.object({ type: z.literal('event'), item: EventDTOSchema }),
  z.object({ type: z.literal('loop'), item: LoopDTOSchema }),
])
export type ReviewItem = z.infer<typeof ReviewItemSchema>

export const ImportReviewSectionSchema = z.object({
  person: PersonRefDTOSchema.extend({ isNew: z.boolean() }),
  newCount: z.number().int().nonnegative(),
  newClaims: z.array(ReviewItemSchema),
  changes: z.array(ReviewItemSchema),
  aliasesAndRelations: z.array(ReviewItemSchema),
  dates: z.array(ReviewItemSchema),
  events: z.array(ReviewItemSchema),
  /** SPEC §9.9 未结事项. Counted in newCount/allHandled, never in highConfidence (a loop has no confidence). */
  loops: z.array(ReviewItemSchema),
})
export type ImportReviewSection = z.infer<typeof ImportReviewSectionSchema>

/** sections order: isNew desc, then newCount desc, then label pinyin.
 *  highConfidence = proposed CLAIMS of this import with confidence >= threshold AND sensitive = false. */
export const ImportReviewResponseSchema = z.object({
  import: ImportDTOSchema,
  chat: ChatDTOSchema.nullable(),
  progress: ProgressSchema,
  sections: z.array(ImportReviewSectionSchema),
  highConfidence: z.array(z.object({ type: z.literal('claim'), id: Id })),
  highConfidenceCount: z.number().int().nonnegative(),
  allHandled: z.boolean(),
  empty: z.boolean(),
})
export type ImportReviewResponse = z.infer<typeof ImportReviewResponseSchema>

export const DeleteImportResultSchema = z.object({
  deletedMessages: z.number().int().nonnegative(),
  reassignedMessages: z.number().int().nonnegative(),
  deletedItems: z.record(TargetType, z.number().int().nonnegative()),
  detachedEvidence: z.number().int().nonnegative(),
  deletedPersons: z.number().int().nonnegative(),
})
export type DeleteImportResult = z.infer<typeof DeleteImportResultSchema>

export const RecentImportSchema = z.object({
  id: Id,
  chatTitle: z.string().nullable(),
  dateFrom: MsgTime.nullable(),
  dateTo: MsgTime.nullable(),
  createdAt: IsoString,
  status: ImportStatus,
})
export type RecentImport = z.infer<typeof RecentImportSchema>
