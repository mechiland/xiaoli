import { z } from 'zod'
import {
  Category,
  ChatKind,
  ClaimStatusReason,
  DayString,
  ExtractModel,
  HandleKind,
  Id,
  ImportStatus,
  IsoString,
  JobStatus,
  MessageKind,
  MsgTime,
  PartialDate,
  ReviewAction,
  SourceKind,
  Status,
  TargetType,
} from './common'

// Entity DTOs (ARCHITECTURE §2.2). ownerId is never serialized.

const timestamps = { createdAt: IsoString, updatedAt: IsoString }

export const ChatDTOSchema = z.object({
  id: Id,
  title: z.string(),
  kind: ChatKind,
  note: z.string().nullable(),
  messageCount: z.number().int().nonnegative(),
  lastMessageAt: MsgTime.nullable(),
  ...timestamps,
})
export type ChatDTO = z.infer<typeof ChatDTOSchema>

export const ImportStatsSchema = z.object({
  byKind: z.partialRecord(MessageKind, z.number().int().nonnegative()),
  bySender: z.record(z.string(), z.number().int().nonnegative()),
  images: z.object({ count: z.number().int().nonnegative(), bytes: z.number().nonnegative() }),
  videos: z.object({ count: z.number().int().nonnegative(), bytes: z.number().nonnegative() }),
})
export type ImportStats = z.infer<typeof ImportStatsSchema>

export const ImportDTOSchema = z.object({
  id: Id,
  chatId: Id.nullable(),
  fileName: z.string(),
  fileSha256: z.string(),
  exportedAt: IsoString.nullable(),
  status: ImportStatus,
  messageCount: z.number().int().nonnegative(),
  newMessageCount: z.number().int().nonnegative(),
  dateFrom: MsgTime.nullable(),
  dateTo: MsgTime.nullable(),
  stats: ImportStatsSchema,
  error: z.string().nullable(),
  ...timestamps,
})
export type ImportDTO = z.infer<typeof ImportDTOSchema>

export const MessageMetaSchema = z.object({
  durationSec: z.number().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
  fileName: z.string().optional(),
  label: z.string().optional(),
  transferState: z.string().optional(),
  greeting: z.string().optional(),
  quoted: z.object({ senderName: z.string(), body: z.string() }).optional(),
})
export type MessageMeta = z.infer<typeof MessageMetaSchema>

export const AttachmentKind = z.enum(['image', 'video', 'file'])
export type AttachmentKind = z.infer<typeof AttachmentKind>

export const AttachmentDTOSchema = z.object({
  id: Id,
  messageId: Id,
  kind: AttachmentKind,
  fileName: z.string().nullable(),
  selected: z.boolean(),
  uploaded: z.boolean(),
  byteSize: z.number().int().nonnegative().nullable(),
  mime: z.string().nullable(),
  /** `/api/attachments/:id` when uploaded */
  url: z.string().nullable(),
})
export type AttachmentDTO = z.infer<typeof AttachmentDTOSchema>

export const MessageDTOSchema = z.object({
  id: Id,
  chatId: Id,
  seq: z.number().int(),
  sentAt: MsgTime,
  kind: MessageKind,
  body: z.string(),
  meta: MessageMetaSchema.nullable(),
  senderHandleId: Id.nullable(),
  senderName: z.string(),
  senderPersonId: Id.nullable(),
  senderLabel: z.string().nullable(),
  attachments: z.array(AttachmentDTOSchema),
})
export type MessageDTO = z.infer<typeof MessageDTOSchema>

export const PersonDTOSchema = z.object({
  id: Id,
  label: z.string(),
  isSelf: z.boolean(),
  mergedIntoId: Id.nullable(),
  pinned: z.boolean(),
  avatarUrl: z.string().nullable(),
  lastMessageAt: MsgTime.nullable(),
  ...timestamps,
})
export type PersonDTO = z.infer<typeof PersonDTOSchema>

export const PersonRefDTOSchema = z.object({ id: Id, label: z.string() })
export type PersonRefDTO = z.infer<typeof PersonRefDTOSchema>

export const HandleDTOSchema = z.object({
  id: Id,
  personId: Id.nullable(),
  kind: HandleKind,
  value: z.string(),
  chatId: Id.nullable(),
  chatTitle: z.string().nullable(),
  status: Status,
  importId: Id.nullable(),
  sourceKind: SourceKind,
  evidenceCount: z.number().int().nonnegative(),
  createdAt: IsoString,
})
export type HandleDTO = z.infer<typeof HandleDTOSchema>

export const RelationDTOSchema = z.object({
  id: Id,
  fromPersonId: Id,
  toPersonId: Id,
  from: PersonRefDTOSchema,
  to: PersonRefDTOSchema,
  type: z.string(),
  label: z.string().nullable(),
  status: Status,
  importId: Id.nullable(),
  sourceKind: SourceKind,
  evidenceCount: z.number().int().nonnegative(),
  createdAt: IsoString,
})
export type RelationDTO = z.infer<typeof RelationDTOSchema>

export const ClaimDTOSchema = z.object({
  id: Id,
  personId: Id,
  statement: z.string(),
  category: Category,
  validFrom: PartialDate.nullable(),
  validTo: PartialDate.nullable(),
  learnedAt: IsoString,
  /** null for manual claims */
  confidence: z.number().min(0).max(1).nullable(),
  sensitive: z.boolean(),
  status: Status,
  supersedesClaimId: Id.nullable(),
  supersededByClaimId: Id.nullable(),
  importId: Id.nullable(),
  sourceKind: SourceKind,
  mentions: z.array(PersonRefDTOSchema),
  evidenceCount: z.number().int().nonnegative(),
  createdAt: IsoString,
  statusChangedAt: IsoString,
  statusReason: ClaimStatusReason.nullable(),
})
export type ClaimDTO = z.infer<typeof ClaimDTOSchema>

export const EventDTOSchema = z.object({
  id: Id,
  summary: z.string(),
  happenedAt: PartialDate.nullable(),
  place: z.string().nullable(),
  status: Status,
  importId: Id.nullable(),
  sourceKind: SourceKind,
  participants: z.array(PersonRefDTOSchema),
  evidenceCount: z.number().int().nonnegative(),
  createdAt: IsoString,
})
export type EventDTO = z.infer<typeof EventDTOSchema>

export const CalendarSchema = z.enum(['solar', 'lunar'])
export type Calendar = z.infer<typeof CalendarSchema>

export const NextOccurrenceSchema = z.object({
  solar: DayString,
  lunarLabel: z.string().nullable(),
  days: z.number().int().nonnegative(),
})
export type NextOccurrence = z.infer<typeof NextOccurrenceSchema>

export const ImportantDateDTOSchema = z.object({
  id: Id,
  personId: Id,
  kind: z.string(),
  day: z.number().int().nullable(),
  month: z.number().int().nullable(),
  year: z.number().int().nullable(),
  calendar: CalendarSchema,
  isLeapMonth: z.boolean(),
  label: z.string().nullable(),
  status: Status,
  importId: Id.nullable(),
  sourceKind: SourceKind,
  next: NextOccurrenceSchema.nullable(),
  evidenceCount: z.number().int().nonnegative(),
  createdAt: IsoString,
})
export type ImportantDateDTO = z.infer<typeof ImportantDateDTOSchema>

export const ExtractionJobDTOSchema = z.object({
  id: Id,
  importId: Id,
  windowStartSeq: z.number().int(),
  windowEndSeq: z.number().int(),
  status: JobStatus,
  attempts: z.number().int().nonnegative(),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
  error: z.string().nullable(),
})
export type ExtractionJobDTO = z.infer<typeof ExtractionJobDTOSchema>

export const ReviewLogDTOSchema = z.object({
  id: Id,
  targetType: TargetType,
  targetId: Id,
  action: ReviewAction,
  before: z.unknown(),
  after: z.unknown(),
  createdAt: IsoString,
})
export type ReviewLogDTO = z.infer<typeof ReviewLogDTOSchema>

export const DEFAULT_HIGH_CONFIDENCE_THRESHOLD = 0.8

export const SettingsDTOSchema = z.object({
  selfDisplayNames: z.array(z.string()),
  /** null = not chosen → env EXTRACT_MODEL → 'deepseek-flash' (resolveExtractModel). Never default-filled. */
  extractModel: ExtractModel.nullable(),
  /** 0..1, default 0.8 */
  highConfidenceThreshold: z.number().min(0).max(1),
  onboardedAt: IsoString.nullable(),
})
export type SettingsDTO = z.infer<typeof SettingsDTOSchema>

export const EvidenceMessageDTOSchema = MessageDTOSchema.extend({ isEvidence: z.boolean() })
export type EvidenceMessageDTO = z.infer<typeof EvidenceMessageDTOSchema>

export const EvidenceItemDTOSchema = z.object({
  messageId: Id,
  chatId: Id,
  chatTitle: z.string(),
  messages: z.array(EvidenceMessageDTOSchema),
})
export type EvidenceItemDTO = z.infer<typeof EvidenceItemDTOSchema>
