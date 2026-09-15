// GET /api/attachments/:id — owner-checked R2 stream (ARCHITECTURE §1.11). Owner: chat.
import { eq } from 'drizzle-orm'
import { attachments, owned, type Db } from '@/server/db'
import { errors } from '@/server/errors'

/**
 * Types served inline. Anything else (including a client-supplied text/html or image/svg+xml, which could run script on
 * this origin) is sent as an opaque download. DECISIONS chat C6.
 */
const INLINE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/bmp',
  'video/mp4',
  'video/quicktime',
  'video/webm',
])

export interface AttachmentStream {
  body: ReadableStream | null
  headers: Record<string, string>
  notModified: boolean
}

export async function getAttachmentStream(
  db: Db,
  r2: R2Bucket,
  ownerId: string,
  attachmentId: number,
  opts: { ifNoneMatch?: string | null } = {},
): Promise<AttachmentStream> {
  const row = await db.select().from(attachments).where(owned(attachments, ownerId, eq(attachments.id, attachmentId))).get()
  if (!row) throw errors.notFound()
  if (!row.r2Key) throw errors.attachmentMissing()
  // Keys live under u/<ownerId>/ (ARCHITECTURE §11); refuse anything else even if a row were corrupted.
  if (!row.r2Key.startsWith(`u/${ownerId}/`)) throw errors.attachmentMissing()

  const mime = (row.mime ?? '').toLowerCase().split(';')[0].trim()
  const inline = INLINE_TYPES.has(mime)
  const headers: Record<string, string> = {
    'content-type': inline ? mime : 'application/octet-stream',
    'content-disposition': inline ? 'inline' : 'attachment',
    'x-content-type-options': 'nosniff',
    // The bytes behind an attachment id never change (uploads are idempotent), but the response is per user.
    'cache-control': 'private, max-age=31536000, immutable',
  }

  const obj = await r2.get(row.r2Key)
  if (!obj) throw errors.attachmentMissing()
  headers.etag = obj.httpEtag
  if (opts.ifNoneMatch && opts.ifNoneMatch === obj.httpEtag) {
    await obj.body?.cancel()
    return { body: null, headers, notModified: true }
  }
  headers['content-length'] = String(obj.size)
  return { body: obj.body as ReadableStream, headers, notModified: false }
}
