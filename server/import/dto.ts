// Row → DTO helpers and small shared queries for the import module.
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { AttachmentDTO, ChatDTO, ImportDTO, ImportStats, Progress } from '@/contracts'
import { attachments, chats, extractionJobs, getOwnedOr404, imports, messages, owned, type Db } from '@/server/db'

export function toImportDTO(row: typeof imports.$inferSelect): ImportDTO {
  return {
    id: row.id,
    chatId: row.chatId ?? null,
    fileName: row.fileName,
    fileSha256: row.fileSha256,
    exportedAt: row.exportedAt ?? null,
    status: row.status,
    messageCount: row.messageCount,
    newMessageCount: row.newMessageCount,
    dateFrom: row.dateFrom ?? null,
    dateTo: row.dateTo ?? null,
    stats: row.stats as ImportStats,
    error: row.error ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function toAttachmentDTO(row: typeof attachments.$inferSelect): AttachmentDTO {
  return {
    id: row.id,
    messageId: row.messageId,
    kind: row.kind,
    fileName: row.fileName ?? null,
    selected: row.selected,
    uploaded: row.r2Key !== null,
    byteSize: row.byteSize ?? null,
    mime: row.mime ?? null,
    url: row.r2Key !== null ? `/api/attachments/${row.id}` : null,
  }
}

/** ChatDTOs with message counts and last message time, in the order of `chatRows`. */
export async function chatDTOs(db: Db, ownerId: string, chatRows: (typeof chats.$inferSelect)[]): Promise<ChatDTO[]> {
  if (chatRows.length === 0) return []
  const stats = new Map<number, { n: number; last: string | null }>()
  for (let i = 0; i < chatRows.length; i += 90) {
    const ids = chatRows.slice(i, i + 90).map((c) => c.id)
    const rows = await db
      .select({ chatId: messages.chatId, n: sql<number>`count(*)`, last: sql<string | null>`max(${messages.sentAt})` })
      .from(messages)
      .where(owned(messages, ownerId, inArray(messages.chatId, ids)))
      .groupBy(messages.chatId)
    for (const r of rows) stats.set(r.chatId, { n: Number(r.n), last: r.last })
  }
  return chatRows.map((c) => ({
    id: c.id,
    title: c.title,
    kind: c.kind,
    note: c.note ?? null,
    messageCount: stats.get(c.id)?.n ?? 0,
    lastMessageAt: stats.get(c.id)?.last ?? null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }))
}

export async function jobProgress(db: Db, ownerId: string, importId: number): Promise<Progress> {
  const rows = await db
    .select({ status: extractionJobs.status, n: sql<number>`count(*)` })
    .from(extractionJobs)
    .where(owned(extractionJobs, ownerId, eq(extractionJobs.importId, importId)))
    .groupBy(extractionJobs.status)
  const p: Progress = { total: 0, done: 0, failed: 0, pending: 0, running: 0 }
  for (const r of rows) {
    p[r.status] = Number(r.n)
    p.total += Number(r.n)
  }
  // The result page prefers this progress over the review one, so the cause of failed windows has to be
  // here too, or it shows a bare count (DECISIONS ## import-result). `error` is `<code>: <message>`;
  // only the code leaves the server.
  if (p.failed > 0) {
    const failedRows = await db
      .select({ error: extractionJobs.error, n: sql<number>`count(*)` })
      .from(extractionJobs)
      .where(owned(extractionJobs, ownerId, eq(extractionJobs.importId, importId), eq(extractionJobs.status, 'failed')))
      .groupBy(extractionJobs.error)
    const byCode = new Map<string, number>()
    for (const r of failedRows) {
      const code = (r.error ?? '').split(':')[0].trim() || 'llm_error'
      byCode.set(code, (byCode.get(code) ?? 0) + Number(r.n))
    }
    p.failures = [...byCode].map(([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n)
  }
  return p
}

/** Stored attachment rows that belong to an import (through import_messages). */
export function importAttachmentsCondition(ownerId: string, importId: number) {
  return owned(
    attachments,
    ownerId,
    sql`${attachments.messageId} in (select message_id from import_messages where import_id = ${importId} and owner_id = ${ownerId})`,
  )
}

export async function uploadSummary(db: Db, ownerId: string, importId: number) {
  const rows = await db
    .select({ fileName: attachments.fileName, r2Key: attachments.r2Key })
    .from(attachments)
    .where(and(importAttachmentsCondition(ownerId, importId), eq(attachments.selected, true), isNotNull(attachments.fileName)))
  const pendingNames = [...new Set(rows.filter((r) => r.r2Key === null).map((r) => r.fileName!))]
  return { selected: rows.length, uploaded: rows.filter((r) => r.r2Key !== null).length, pendingNames }
}

/** NFKC, lowercase, trimmed — same normalisation as handles.value_norm. */
export function normName(s: string): string {
  return s.normalize('NFKC').toLowerCase().trim()
}

export function getImportOr404(db: Db, ownerId: string, importId: number) {
  return getOwnedOr404(db, imports, ownerId, importId)
}
