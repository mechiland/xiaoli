import { z } from 'zod'
import { Id, IsoString, MessageKind, MsgTime } from './common'
import { AttachmentKind, MessageMetaSchema } from './entities'

// Parsed export (ARCHITECTURE §2.3): produced by parser, uploaded by import.

export const ParsedMessageSchema = z.object({
  /** 0-based order in file */
  idx: z.number().int().nonnegative(),
  senderName: z.string(),
  sentAt: MsgTime,
  kind: MessageKind,
  body: z.string(),
  meta: MessageMetaSchema.nullable(),
  fingerprint: z.string(),
  attachmentName: z.string().nullable(),
})
export type ParsedMessage = z.infer<typeof ParsedMessageSchema>

export const MediaFileInfoSchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: AttachmentKind,
  byteSize: z.number().int().nonnegative(),
  mime: z.string(),
  referenced: z.boolean(),
})
export type MediaFileInfo = z.infer<typeof MediaFileInfoSchema>

export const SenderCountSchema = z.object({ name: z.string(), count: z.number().int().nonnegative() })
export type SenderCount = z.infer<typeof SenderCountSchema>

export const ParsedExportSchema = z.object({
  formatVersion: z.literal(1),
  parserVersion: z.string(),
  fileName: z.string(),
  /** from 聊天记录_YYYYMMDD_HHMMSS, Asia/Shanghai local → ISO Z */
  exportedAt: IsoString.nullable(),
  sha256: z.string(),
  messages: z.array(ParsedMessageSchema),
  senders: z.array(SenderCountSchema),
  media: z.array(MediaFileInfoSchema),
  dateFrom: MsgTime.nullable(),
  dateTo: MsgTime.nullable(),
  warnings: z.array(z.object({ line: z.number().int(), code: z.string() })),
})
export type ParsedExport = z.infer<typeof ParsedExportSchema>

const CountBytes = z.object({ count: z.number().int().nonnegative(), bytes: z.number().nonnegative() })

export const ExportPreviewSchema = z.object({
  messageCount: z.number().int().nonnegative(),
  dateFrom: MsgTime.nullable(),
  dateTo: MsgTime.nullable(),
  senders: z.array(SenderCountSchema),
  byKind: z.partialRecord(MessageKind, z.number().int().nonnegative()),
  images: CountBytes,
  videos: CountBytes,
})
export type ExportPreview = z.infer<typeof ExportPreviewSchema>

/** R2 `u/<ownerId>/imp/<importId>/parsed.json`, written by POST /api/imports, read by mapping, deleted after status → extracting. */
export const StagedImportPayloadSchema = z.object({
  formatVersion: z.literal(1),
  importId: Id,
  parserVersion: z.string(),
  messages: z.array(ParsedMessageSchema),
  media: z.array(MediaFileInfoSchema),
  selectedAttachments: z.array(z.string()),
})
export type StagedImportPayload = z.infer<typeof StagedImportPayloadSchema>
