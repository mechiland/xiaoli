// Image type from magic bytes, for attachments whose stored mime came from the file name only (DECISIONS chat C14).
// WeChat exports can hold HEIC photos named 微信图片_….jpg. Pure (no server imports). Owner: chat.

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'])
const HEIF_BRANDS = new Set(['mif1', 'msf1'])
const AVIF_BRANDS = new Set(['avif', 'avis'])

/** bytes needed to recognise every type below (ftyp boxes list their brands in the first few dozen bytes) */
export const SNIFF_BYTES = 64

/** `image/*` type of the leading bytes, or null when they are not a known raster image */
export function sniffImageMime(head: Uint8Array): string | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head.length >= 8 && head[0] === 0x89 && ascii(head, 1, 4) === 'PNG' && head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a) return 'image/png'
  if (head.length >= 6 && (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a')) return 'image/gif'
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'image/webp'
  if (head.length >= 2 && ascii(head, 0, 2) === 'BM') return 'image/bmp'
  // ISO-BMFF: [size u32][ 'ftyp' ][major brand][minor version u32][compatible brands…]
  if (head.length >= 12 && ascii(head, 4, 8) === 'ftyp') {
    const size = ((head[0] << 24) >>> 0) + (head[1] << 16) + (head[2] << 8) + head[3]
    const end = Math.min(size >= 16 ? size : 16, head.length)
    const brands = [ascii(head, 8, 12)]
    for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(head, i, i + 4))
    if (brands.some((b) => AVIF_BRANDS.has(b))) return 'image/avif'
    if (brands.some((b) => HEIC_BRANDS.has(b))) return 'image/heic'
    if (brands.some((b) => HEIF_BRANDS.has(b))) return 'image/heif'
  }
  return null
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
}

/** file name whose extension matches the sniffed type (`微信图片_1.jpg` holding HEIC → `微信图片_1.heic`) */
export function fileNameForMime(fileName: string, mime: string): string {
  const ext = EXT[mime]
  if (!ext) return fileName
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const cur = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
  if (cur === ext || (ext === 'jpg' && cur === 'jpeg')) return fileName
  return `${stem}.${ext}`
}

/** `content-disposition: attachment` with an ASCII fallback and the UTF-8 name (RFC 6266 / 5987) */
export function attachmentDisposition(fileName: string | null): string {
  if (!fileName) return 'attachment'
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

/**
 * Reads at least `want` bytes off the front of `body` and returns them with a stream that still yields every byte
 * (the peeked chunks first). Cancelling the returned stream cancels the source.
 */
export async function peekStream(body: ReadableStream<Uint8Array>, want: number): Promise<{ head: Uint8Array; body: ReadableStream<Uint8Array> }> {
  const reader = body.getReader()
  let pending: Uint8Array[] = []
  let total = 0
  let done = false
  while (total < want) {
    const r = await reader.read()
    if (r.done) {
      done = true
      break
    }
    pending.push(r.value)
    total += r.value.byteLength
  }
  const head = new Uint8Array(Math.min(total, want))
  let off = 0
  for (const c of pending) {
    if (off >= head.length) break
    const part = c.subarray(0, head.length - off)
    head.set(part, off)
    off += part.length
  }
  const out = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (pending.length) {
        for (const c of pending) controller.enqueue(c)
        pending = []
        if (done) controller.close()
        return
      }
      if (done) return controller.close()
      const r = await reader.read()
      if (r.done) controller.close()
      else controller.enqueue(r.value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
  return { head, body: out }
}
