// POST /api/imports/check and POST /api/imports (overlay step 1 → 2). ARCHITECTURE §1.4 "Import data lifecycle".
import { eq } from 'drizzle-orm'
import type { CreateImportRequest, CreateImportResponse, ImportCheckResponse, ImportStats, MessageKind } from '@/contracts'
import { nowIso } from '@/lib/time'
import { getUserSettings, imports, owned, withOwner, type Db } from '@/server/db'
import { errors } from '@/server/errors'
import { logImport } from './batch'
import { deleteImport } from './delete'
import { toImportDTO } from './dto'
import { deleteStagedPayload, putStagedPayload } from './staging'
import { suggestMapping } from './suggest'

/** Imports that never finished step 2 ('parsed' = a mapping request was in flight). They never block a re-import. */
export const STALE_STATUSES = ['mapping', 'parsed'] as const
const isStale = (s: string) => (STALE_STATUSES as readonly string[]).includes(s)

export async function checkDuplicate(db: Db, ownerId: string, sha256: string): Promise<ImportCheckResponse> {
  const row = await db
    .select({ id: imports.id, status: imports.status })
    .from(imports)
    .where(owned(imports, ownerId, eq(imports.fileSha256, sha256)))
    .get()
  return row && !isStale(row.status) ? { duplicate: true, importId: row.id } : { duplicate: false }
}

export function computeStats(body: Pick<CreateImportRequest, 'messages' | 'media'>): ImportStats {
  const byKind: Partial<Record<MessageKind, number>> = {}
  const bySender: Record<string, number> = {}
  for (const m of body.messages) {
    byKind[m.kind] = (byKind[m.kind] ?? 0) + 1
    bySender[m.senderName] = (bySender[m.senderName] ?? 0) + 1
  }
  const images = { count: 0, bytes: 0 }
  const videos = { count: 0, bytes: 0 }
  for (const f of body.media) {
    const t = f.kind === 'image' ? images : f.kind === 'video' ? videos : null
    if (t) {
      t.count++
      t.bytes += f.byteSize
    }
  }
  return { byKind, bySender, images, videos }
}

/** Senders in first-appearance order, then sorted by count desc (stable) — same order as the step-1 preview. */
export function senderCounts(messages: { senderName: string }[]): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const m of messages) counts.set(m.senderName, (counts.get(m.senderName) ?? 0) + 1)
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}

export async function createImport(db: Db, r2: R2Bucket, ownerId: string, body: CreateImportRequest): Promise<CreateImportResponse> {
  if (body.messages.length === 0) throw errors.validation('这份文件里没有消息')

  const existing = await db
    .select({ id: imports.id, status: imports.status })
    .from(imports)
    .where(owned(imports, ownerId, eq(imports.fileSha256, body.sha256)))
    .get()
  if (existing) {
    if (!isStale(existing.status)) throw errors.duplicateImport(existing.id)
    await deleteImport(db, r2, ownerId, existing.id)
  }

  let dateFrom: string | null = null
  let dateTo: string | null = null
  for (const m of body.messages) {
    if (dateFrom === null || m.sentAt < dateFrom) dateFrom = m.sentAt
    if (dateTo === null || m.sentAt > dateTo) dateTo = m.sentAt
  }
  const mediaNames = new Set(body.media.map((m) => m.name))
  const selectedAttachments = [...new Set(body.selectedAttachments.filter((n) => mediaNames.has(n)))]

  let row: typeof imports.$inferSelect
  try {
    const inserted = await db
      .insert(imports)
      .values(
        withOwner<typeof imports>(ownerId, {
          chatId: null,
          fileName: body.fileName,
          fileSha256: body.sha256,
          exportedAt: body.exportedAt,
          parserVersion: body.parserVersion,
          status: 'mapping',
          messageCount: body.messages.length,
          newMessageCount: 0,
          dateFrom,
          dateTo,
          stats: computeStats(body),
          error: null,
        }),
      )
      .returning()
    row = inserted[0]
  } catch (err) {
    // unique (owner_id, file_sha256): a concurrent request won the race
    const again = await checkDuplicate(db, ownerId, body.sha256)
    if (again.duplicate) throw errors.duplicateImport(again.importId)
    throw err
  }

  try {
    await putStagedPayload(r2, ownerId, row.id, {
      formatVersion: 1,
      importId: row.id,
      parserVersion: body.parserVersion,
      messages: body.messages,
      media: body.media,
      selectedAttachments,
    })
  } catch (err) {
    logImport('error', 'staging_put_failed', { importId: row.id, name: (err as Error)?.name })
    await db.delete(imports).where(owned(imports, ownerId, eq(imports.id, row.id)))
    await deleteStagedPayload(r2, ownerId, row.id).catch(() => undefined)
    throw errors.internal()
  }

  const settings = await getUserSettings(db, ownerId)
  const suggestions = await suggestMapping(db, ownerId, senderCounts(body.messages), settings)
  return { import: toImportDTO({ ...row, updatedAt: row.updatedAt ?? nowIso() }), suggestions }
}
