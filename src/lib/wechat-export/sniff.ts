// Image type from magic bytes. WeChat exports can hold HEIC photos named 微信图片_….jpg, so the extension alone would
// store image/jpeg. Pure copy of the chat module's sniffImageMime (server/chat/sniff.ts); the parser must not import
// server code (ARCHITECTURE §1.2). DECISIONS parser P15.

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
