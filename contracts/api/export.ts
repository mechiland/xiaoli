import { z } from 'zod'
import { IsoString } from '../common'
import { SettingsDTOSchema } from '../entities'

/** Row arrays are raw rows, camelCase, ownerId omitted (ARCHITECTURE §2.4 / §11). */
const Rows = z.array(z.record(z.string(), z.unknown()))

export const ExportDumpSchema = z.object({
  exportedAt: IsoString,
  version: z.literal(1),
  user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
  settings: SettingsDTOSchema,
  chats: Rows,
  imports: Rows,
  importMessages: Rows,
  messages: Rows,
  /** metadata only, no bytes */
  attachments: Rows,
  persons: Rows,
  handles: Rows,
  relations: Rows,
  claims: Rows,
  claimMentions: Rows,
  events: Rows,
  eventParticipants: Rows,
  importantDates: Rows,
  evidence: Rows,
  /** incl. rawOutput */
  extractionJobs: Rows,
  reviewLog: Rows,
  /** incl. rawOutput */
  llmCalls: Rows,
})
export type ExportDump = z.infer<typeof ExportDumpSchema>

export const DELETE_ALL_CONFIRM_TEXT = '删除全部数据'
export const DeleteAllRequestSchema = z.object({ confirm: z.literal(DELETE_ALL_CONFIRM_TEXT) })
export type DeleteAllRequest = z.infer<typeof DeleteAllRequestSchema>
export const DeleteAllResponseSchema = z.object({
  deleted: z.record(z.string(), z.number().int().nonnegative()),
  r2Objects: z.number().int().nonnegative(),
})
export type DeleteAllResponse = z.infer<typeof DeleteAllResponseSchema>
