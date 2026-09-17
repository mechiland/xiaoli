import { z } from 'zod'

// Primitives (ARCHITECTURE §2.1). Each schema is exported under its short name (value + type share the name)
// and as `<Name>Schema` for callers that prefer the suffix convention.

export const Id = z.number().int().positive()
export type Id = z.infer<typeof Id>
export const IdSchema = Id

export const IdParamSchema = z.object({ id: z.coerce.number().int().positive() })
export type IdParam = z.infer<typeof IdParamSchema>

export const IsoString = z.iso.datetime({ offset: true })
export type IsoString = z.infer<typeof IsoString>
export const IsoStringSchema = IsoString

/** 'YYYY-MM-DD HH:MM' local wall time as in the export (no tz). */
export const MsgTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
export type MsgTime = z.infer<typeof MsgTime>
export const MsgTimeSchema = MsgTime

/** 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD' */
export const PartialDate = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)
export type PartialDate = z.infer<typeof PartialDate>
export const PartialDateSchema = PartialDate

/** 'YYYY-MM-DD' */
export const DayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export type DayString = z.infer<typeof DayString>

export const Status = z.enum(['proposed', 'confirmed', 'rejected', 'superseded'])
export type Status = z.infer<typeof Status>
export const StatusSchema = Status

export const SourceKind = z.enum(['ai', 'manual'])
export type SourceKind = z.infer<typeof SourceKind>
export const SourceKindSchema = SourceKind

export const Category = z.enum(['work', 'location', 'education', 'family', 'preference', 'life_event', 'other'])
export type Category = z.infer<typeof Category>
export const CategorySchema = Category

export const TargetType = z.enum(['handle', 'relation', 'claim', 'event', 'date', 'segment', 'loop'])
export type TargetType = z.infer<typeof TargetType>
export const TargetTypeSchema = TargetType

export const MessageKind = z.enum([
  'text',
  'sticker_code',
  'image',
  'video',
  'voice',
  'transfer',
  'red_packet',
  'mini_program',
  'channels',
  'animated_sticker',
  'video_call',
  'quote',
  'recall',
  'system',
  'file',
  'link',
  'location',
  'contact_card',
  'forward',
  'unknown',
])
export type MessageKind = z.infer<typeof MessageKind>
export const MessageKindSchema = MessageKind

export const HandleKind = z.enum(['display_private', 'display_group', 'mentioned', 'real_name', 'address_term'])
export type HandleKind = z.infer<typeof HandleKind>
export const HandleKindSchema = HandleKind

export const LoopDirection = z.enum(['mine', 'theirs', 'mutual'])
export type LoopDirection = z.infer<typeof LoopDirection>
export const LoopDirectionSchema = LoopDirection

export const LoopKind = z.enum(['promise', 'question', 'plan', 'request'])
export type LoopKind = z.infer<typeof LoopKind>
export const LoopKindSchema = LoopKind

export const LoopCloseReason = z.enum(['done', 'dropped'])
export type LoopCloseReason = z.infer<typeof LoopCloseReason>
export const LoopCloseReasonSchema = LoopCloseReason

export const LoopState = z.enum(['open', 'done', 'dropped'])
export type LoopState = z.infer<typeof LoopState>

/**
 * Session boundary (SPEC §8.5 分窗 and §7 交互层 会话聚合). The single definition: `planWindows` cuts windows here
 * and `groupSegments` groups segments into conversations here. Neither redefines it.
 */
export const SESSION_GAP_HOURS = 3

/** Below this many conversations a rhythm is noise, so the person page states the last contact only (SPEC §9.5). */
export const MIN_RHYTHM_CONVERSATIONS = 5

/** A loop with a dueAt is "expired" this many days after it (SPEC §7 交互层). */
export const LOOP_EXPIRY_DAYS_WITH_DUE = 14
/** A loop without a dueAt is "expired" this many days after it opened. */
export const LOOP_EXPIRY_DAYS_NO_DUE = 90

export const ChatKind = z.enum(['private', 'group'])
export type ChatKind = z.infer<typeof ChatKind>
export const ChatKindSchema = ChatKind

export const ImportStatus = z.enum(['parsed', 'mapping', 'extracting', 'reviewing', 'done', 'failed'])
export type ImportStatus = z.infer<typeof ImportStatus>
export const ImportStatusSchema = ImportStatus

export const JobStatus = z.enum(['pending', 'running', 'done', 'failed'])
export type JobStatus = z.infer<typeof JobStatus>
export const JobStatusSchema = JobStatus

export const ReviewAction = z.enum(['accept', 'reject', 'edit', 'merge', 'split', 'supersede', 'delete'])
export type ReviewAction = z.infer<typeof ReviewAction>
export const ReviewActionSchema = ReviewAction

export const ExtractModel = z.enum(['deepseek-flash', 'deepseek-v4-pro'])
export type ExtractModel = z.infer<typeof ExtractModel>
export const ExtractModelSchema = ExtractModel

export const ClaimStatusReason = z.enum(['superseded', 'outdated', 'edited'])
export type ClaimStatusReason = z.infer<typeof ClaimStatusReason>

export const ApiErrorCode = z.enum([
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_failed',
  'duplicate_import',
  'conflict',
  'payload_too_large',
  'attachment_missing',
  'not_implemented',
  'llm_unavailable',
  'budget_exceeded',
  'internal',
])
export type ApiErrorCode = z.infer<typeof ApiErrorCode>

export const ApiErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
})
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>
export const ApiErrorBody = ApiErrorBodySchema

export const ProgressSchema = z.object({
  total: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  /** additive: why the failed windows failed, so the page can name the cause (WindowErrorCode, counted) */
  failures: z.array(z.object({ code: z.string(), n: z.number().int().positive() })).optional(),
})
export type Progress = z.infer<typeof ProgressSchema>
export const Progress = ProgressSchema
