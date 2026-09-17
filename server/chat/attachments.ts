// GET /api/attachments/:id — owner-checked R2 stream (ARCHITECTURE §1.11). Owner: chat.
import { eq } from 'drizzle-orm'
import { attachments, owned, type Db } from '@/server/db'
import { errors } from '@/server/errors'
import { attachmentDisposition, fileNameForMime, peekStream, sniffImageMime, SNIFF_BYTES } from './sniff'

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
  opts: { ifNoneMatch?: string | null; download?: boolean } = {},
): Promise<AttachmentStream> {
  const row = await db.select().from(attachments).where(owned(attachments, ownerId, eq(attachments.id, attachmentId))).get()
  if (!row) throw errors.notFound()
  if (!row.r2Key) throw errors.attachmentMissing()
  // Keys live under u/<ownerId>/ (ARCHITECTURE §11); refuse anything else even if a row were corrupted.
  if (!row.r2Key.startsWith(`u/${ownerId}/`)) throw errors.attachmentMissing()

  const storedMime = (row.mime ?? '').toLowerCase().split(';')[0].trim()
  const inline = INLINE_TYPES.has(storedMime)
  const headers: Record<string, string> = {
    'content-type': inline ? storedMime : 'application/octet-stream',
    'content-disposition': inline && !opts.download ? 'inline' : 'attachment',
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
  let body = obj.body as ReadableStream<Uint8Array>
  let fileName = row.fileName
  // The stored mime of an image comes from its file name; a HEIC photo named .jpg would be served as image/jpeg.
  // Only an inline image type is ever replaced, and only by another raster image type (DECISIONS chat C14).
  if (inline && storedMime.startsWith('image/') && body) {
    const peek = await peekStream(body, SNIFF_BYTES)
    body = peek.body
    const sniffed = sniffImageMime(peek.head)
    if (sniffed && sniffed !== storedMime && INLINE_TYPES.has(sniffed)) {
      headers['content-type'] = sniffed
      if (fileName) fileName = fileNameForMime(fileName, sniffed)
    }
  }
  if (opts.download) headers['content-disposition'] = attachmentDisposition(fileName)
  return { body, headers, notModified: false }
}
