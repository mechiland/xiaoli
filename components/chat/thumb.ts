// How an image sits in the fixed 180×135 chat thumbnail box (DECISIONS chat C13). Owner: chat.

/** height / width above which an image counts as a tall (phone) screenshot */
export const TALL_RATIO = 1.6

/**
 * `center`: object-cover centre crop (photos, wide images).
 * `top`: object-cover anchored to the top — a tall phone screenshot's middle band is often empty (white chat
 * background), so a centre crop reads as a blank box; the top holds the title bar and the first lines.
 */
export type ThumbFit = 'center' | 'top'

export function thumbFit(naturalWidth: number, naturalHeight: number): ThumbFit {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return 'center'
  return naturalHeight / naturalWidth > TALL_RATIO ? 'top' : 'center'
}

/**
 * Short format name for an image the browser could not decode ("这张图片无法预览（HEIC）"), from the served or stored
 * type or, failing that, the file extension. Null for ordinary types (then the reason is unknown). DECISIONS chat C14.
 */
export function undecodableFormatLabel(mime: string | null | undefined, fileName?: string | null): string | null {
  const m = (mime ?? '').toLowerCase().split(';')[0].trim()
  if (m === 'image/heic' || m === 'image/heif' || m === 'image/heic-sequence' || m === 'image/heif-sequence') return 'HEIC'
  if (m === 'image/avif') return 'AVIF'
  if (m === 'image/tiff') return 'TIFF'
  const ext = (fileName ?? '').includes('.') ? (fileName ?? '').split('.').pop()!.toLowerCase() : ''
  if (ext === 'heic' || ext === 'heif') return 'HEIC'
  if (ext === 'avif') return 'AVIF'
  if (ext === 'tif' || ext === 'tiff') return 'TIFF'
  return null
}

/** "下载原图": the attachment stream as a download (server sends content-disposition: attachment); other URLs as-is */
export function downloadHref(url: string): string {
  return /^\/api\/attachments\/\d+$/.test(url) ? `${url}?download=1` : url
}
