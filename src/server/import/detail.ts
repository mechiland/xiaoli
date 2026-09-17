// GET /api/imports/:id and PUT /api/imports/:id/attachments/:name.
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, type AttachmentDTO, type ImportDetailResponse } from '@/contracts'
import { nowIso } from '@/lib/time'
import { attachments, chats, getOwnedOr404, imports, owned, type Db } from '@/server/db'
import { errors } from '@/server/errors'
import { chatDTOs, importAttachmentsCondition, jobProgress, toAttachmentDTO, toImportDTO, uploadSummary } from './dto'

export async function getImportDetail(db: Db, ownerId: string, importId: number): Promise<ImportDetailResponse> {
  const imp = await getOwnedOr404(db, imports, ownerId, importId)
  let chat: ImportDetailResponse['chat'] = null
  if (imp.chatId !== null) {
    const row = await db.select().from(chats).where(owned(chats, ownerId, eq(chats.id, imp.chatId))).get()
    if (row) chat = (await chatDTOs(db, ownerId, [row]))[0]
  }
  const persons = await db.all<{ id: number; label: string }>(sql`
    select p.id as id, p.label as label from persons p
    where p.owner_id = ${ownerId} and p.merged_into_id is null and (
      p.import_id = ${importId} or p.id in (
        select h.person_id from handles h
        join messages m on m.sender_handle_id = h.id
        join import_messages im on im.message_id = m.id
        where im.import_id = ${importId} and im.owner_id = ${ownerId} and h.person_id is not null))
    order by p.label_sort`)
  return {
    import: toImportDTO(imp),
    chat,
    progress: await jobProgress(db, ownerId, importId),
    uploads: await uploadSummary(db, ownerId, importId),
    persons: persons.map((p) => ({ id: Number(p.id), label: p.label })),
  }
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function attachmentKey(ownerId: string, importId: number, nameSha: string, name: string): string {
  return `u/${ownerId}/att/${importId}/${nameSha}-${name}`
}

/** Idempotent: an already uploaded name answers the same DTO without rewriting R2. */
export async function uploadAttachment(
  db: Db,
  r2: R2Bucket,
  ownerId: string,
  importId: number,
  name: string,
  read: () => Promise<ArrayBuffer>,
  contentType: string | null,
  contentLength: number | null,
): Promise<AttachmentDTO> {
  const imp = await getOwnedOr404(db, imports, ownerId, importId)
  if (imp.status === 'mapping' || imp.status === 'parsed') throw errors.conflict('还没有确认聊天和发送者')

  const rows = await db
    .select()
    .from(attachments)
    .where(and(importAttachmentsCondition(ownerId, importId), eq(attachments.fileName, name), eq(attachments.selected, true)))
  if (rows.length === 0) throw errors.notFound('这次导入里没有这个附件')
  const done = rows.find((r) => r.r2Key !== null)
  if (done) return toAttachmentDTO(done)

  const limit = rows[0].kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
  if (contentLength !== null && contentLength > limit) throw errors.payloadTooLarge()
  const bytes = await read()
  if (bytes.byteLength > limit) throw errors.payloadTooLarge()
  if (bytes.byteLength === 0) throw errors.validation('附件是空的')

  const mime = contentType && contentType !== 'application/octet-stream' ? contentType : (rows[0].mime ?? 'application/octet-stream')
  const key = attachmentKey(ownerId, importId, await sha256Hex(name), name)
  await r2.put(key, bytes, { httpMetadata: { contentType: mime } })
  const now = nowIso()
  await db
    .update(attachments)
    .set({ r2Key: key, byteSize: bytes.byteLength, mime, updatedAt: now })
    .where(and(importAttachmentsCondition(ownerId, importId), eq(attachments.fileName, name), eq(attachments.selected, true)))
  const updated = await db
    .select()
    .from(attachments)
    .where(owned(attachments, ownerId, eq(attachments.id, rows[0].id), isNotNull(attachments.r2Key)))
    .get()
  return toAttachmentDTO(updated ?? { ...rows[0], r2Key: key, byteSize: bytes.byteLength, mime })
}
