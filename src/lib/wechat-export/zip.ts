import { Inflate, unzipSync, type UnzipFileInfo } from 'fflate'
import type { MediaFileInfo, ParsedExport } from '@/contracts'
import { ParseError } from './errors'
import { sha256Hex } from './hash'
import { SNIFF_BYTES, sniffImageMime } from './sniff'
import { buildParsedExport, type Warning } from './text'

export function toU8(zip: Uint8Array | ArrayBuffer): Uint8Array {
  return zip instanceof Uint8Array ? zip : new Uint8Array(zip)
}

function looksLikeZip(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7)
}

/**
 * fflate decodes entry names as latin1 when the ZIP's UTF-8 flag (bit 11) is unset — WeChat iOS writes UTF-8 names
 * without that flag. Re-decode: UTF-8 (strict) → GBK (strict, if the runtime supports it) → leave as is.
 */
export function decodeEntryName(name: string): string {
  let high = false
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)
    if (c > 0xff) return name // already decoded as UTF-8 by fflate
    if (c >= 0x80) high = true
  }
  if (!high) return name
  const bytes = new Uint8Array(name.length)
  for (let i = 0; i < name.length; i++) bytes[i] = name.charCodeAt(i)
  for (const enc of ['utf-8', 'gbk']) {
    try {
      return new TextDecoder(enc, { fatal: true }).decode(bytes)
    } catch {
      /* try next */
    }
  }
  return name
}

/** Decode the chat text: BOM-sniffed UTF-16, else strict UTF-8, else strict GBK (warning), else ParseError. */
export function decodeText(bytes: Uint8Array, warnings: Warning[]): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    try {
      return new TextDecoder('utf-16be').decode(bytes)
    } catch {
      throw new ParseError('bad_encoding')
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    /* fall through */
  }
  try {
    const s = new TextDecoder('gbk', { fatal: true }).decode(bytes)
    warnings.push({ line: 0, code: 'decoded_gbk' })
    return s
  } catch {
    throw new ParseError('bad_encoding')
  }
}

const IMAGE_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp',
}
const VIDEO_EXT: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', '3gp': 'video/3gpp', webm: 'video/webm',
}
const FILE_EXT: Record<string, string> = {
  pdf: 'application/pdf', txt: 'text/plain', doc: 'application/msword', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', amr: 'audio/amr', silk: 'application/octet-stream',
}

export function mediaKindAndMime(name: string): { kind: MediaFileInfo['kind']; mime: string } {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  if (IMAGE_EXT[ext]) return { kind: 'image', mime: IMAGE_EXT[ext] }
  if (VIDEO_EXT[ext]) return { kind: 'video', mime: VIDEO_EXT[ext] }
  return { kind: 'file', mime: FILE_EXT[ext] ?? 'application/octet-stream' }
}

interface Entry {
  rawName: string
  path: string
  name: string
  originalSize: number
  /** position in the central directory (fflate calls the filter once per directory entry, in order) */
  index: number
  compression: number
  /** compressed size */
  size: number
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 2 ** 32

/**
 * Local header offset of every central directory entry, in directory order (ZIP64 aware). [] when the directory
 * cannot be read — callers then simply skip byte sniffing. fflate's UnzipFileInfo has no offset, hence this reader.
 */
export function localHeaderOffsets(b: Uint8Array): number[] {
  const min = Math.max(0, b.length - 65558)
  let e = b.length - 22
  while (e >= min && u32(b, e) !== 0x06054b50) e--
  if (e < min) return []
  let count = u16(b, e + 10)
  let o = u32(b, e + 16)
  if (e >= 20 && u32(b, e - 20) === 0x07064b50) {
    const ze = u64(b, e - 12)
    if (ze + 56 <= b.length && u32(b, ze) === 0x06064b50) {
      count = u64(b, ze + 32)
      o = u64(b, ze + 48)
    }
  }
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    if (o + 46 > b.length || u32(b, o) !== 0x02014b50) return []
    const n = u16(b, o + 28)
    const x = u16(b, o + 30)
    const c = u16(b, o + 32)
    let off = u32(b, o + 42)
    if (off === 0xffffffff) {
      // ZIP64 extra (id 1): present fields in order uncompressed, compressed, offset
      for (let p = o + 46 + n, end = p + x; p + 4 <= end; p += 4 + u16(b, p + 2)) {
        if (u16(b, p) !== 1) continue
        let f = p + 4
        if (u32(b, o + 24) === 0xffffffff) f += 8
        if (u32(b, o + 20) === 0xffffffff) f += 8
        off = u64(b, f)
        break
      }
    }
    out.push(off)
    o += 46 + n + x + c
  }
  return out
}

/** Up to `want` leading bytes of an entry's content without inflating the rest; null when unreadable. */
export function entryHead(b: Uint8Array, localOffset: number, compression: number, size: number, want = SNIFF_BYTES): Uint8Array | null {
  try {
    if (localOffset + 30 > b.length || u32(b, localOffset) !== 0x04034b50) return null
    const start = localOffset + 30 + u16(b, localOffset + 26) + u16(b, localOffset + 28)
    const end = Math.min(b.length, start + size)
    if (compression === 0) return b.slice(start, Math.min(end, start + want))
    if (compression !== 8) return null
    const head = new Uint8Array(want)
    let got = 0
    const inflate = new Inflate((chunk) => {
      const part = chunk.subarray(0, want - got)
      head.set(part, got)
      got += part.length
    })
    for (let p = start; p < end && got < want; p += 1024) {
      const q = Math.min(end, p + 1024)
      inflate.push(b.subarray(p, q), q === end)
    }
    return head.slice(0, got)
  } catch {
    return null
  }
}

function basename(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1]
}

function isJunk(path: string): boolean {
  return path.endsWith('/') || path.startsWith('__MACOSX/') || basename(path).startsWith('._') || basename(path) === '.DS_Store'
}

function safeUnzip(bytes: Uint8Array, filter: (f: UnzipFileInfo) => boolean): Record<string, Uint8Array> {
  if (!looksLikeZip(bytes)) throw new ParseError('not_zip')
  try {
    return unzipSync(bytes, { filter })
  } catch {
    throw new ParseError('not_zip')
  }
}

const CHAT_TXT_NAMES = new Set(['聊天记录.txt', 'chat history.txt'])

export async function parseExportZip(
  zip: Uint8Array | ArrayBuffer,
  opts: { fileName?: string; onProgress?: (p: number) => void } = {},
): Promise<ParsedExport> {
  const progress = opts.onProgress ?? (() => {})
  const bytes = toU8(zip)
  progress(0)
  const entries: Entry[] = []
  let index = 0
  const files = safeUnzip(bytes, (f) => {
    const path = decodeEntryName(f.name)
    const at = index++
    if (isJunk(path)) return false
    entries.push({ rawName: f.name, path, name: basename(path), originalSize: f.originalSize, index: at, compression: f.compression, size: f.size })
    // only text files are inflated; media are listed by size without decompressing
    return path.toLowerCase().endsWith('.txt') && (f.compression === 0 || f.compression === 8)
  })
  progress(0.3)

  const txts = entries.filter((e) => files[e.rawName] !== undefined)
  if (txts.length === 0) throw new ParseError('no_txt')
  const chosen =
    txts.filter((e) => CHAT_TXT_NAMES.has(e.name.toLowerCase())).sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0] ??
    [...txts].sort((a, b) => b.originalSize - a.originalSize)[0]

  const warnings: Warning[] = []
  if (txts.length > 1) warnings.push({ line: 0, code: 'multiple_txt' })
  const text = decodeText(files[chosen.rawName], warnings)
  progress(0.4)

  const sha256 = await sha256Hex(bytes)
  progress(0.7)

  // Images: the mime comes from the leading bytes when they name a format (HEIC photos are exported as 微信图片_….jpg);
  // only those bytes are inflated. Everything else, and unrecognised bytes, keep the extension's mime. DECISIONS P15.
  let offsets: number[] | null = null
  const mediaFiles: MediaFileInfo[] = entries
    .filter((e) => e !== chosen)
    .map((e) => {
      const km = mediaKindAndMime(e.name)
      if (km.kind === 'image') {
        offsets ??= localHeaderOffsets(bytes)
        const off = offsets.length === index ? offsets[e.index] : undefined
        const head = off === undefined ? null : entryHead(bytes, off, e.compression, e.size)
        const sniffed = head ? sniffImageMime(head) : null
        if (sniffed) km.mime = sniffed
      }
      return { name: e.name, path: e.path, ...km, byteSize: e.originalSize, referenced: false }
    })

  const parsed = buildParsedExport(text, { fileName: opts.fileName, mediaFiles, sha256, warnings })
  progress(1)
  return parsed
}

/** Bytes of selected media, keyed by the requested name (media[].name or media[].path). Missing names are omitted. */
export async function readMediaFiles(zip: Uint8Array | ArrayBuffer, names: string[]): Promise<Map<string, Uint8Array>> {
  const wanted = new Set(names)
  const out = new Map<string, Uint8Array>()
  if (wanted.size === 0) return out
  const keyOf = new Map<string, string>()
  const files = safeUnzip(toU8(zip), (f) => {
    const path = decodeEntryName(f.name)
    if (isJunk(path)) return false
    const key = wanted.has(path) ? path : wanted.has(basename(path)) ? basename(path) : null
    if (key === null || [...keyOf.values()].includes(key)) return false
    if (f.compression !== 0 && f.compression !== 8) return false
    keyOf.set(f.name, key)
    return true
  })
  for (const [raw, key] of keyOf) {
    const data = files[raw]
    if (data) out.set(key, data)
  }
  return out
}
