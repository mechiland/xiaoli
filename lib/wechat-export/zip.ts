import { unzipSync, type UnzipFileInfo } from 'fflate'
import type { MediaFileInfo, ParsedExport } from '@/contracts'
import { ParseError } from './errors'
import { sha256Hex } from './hash'
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

const CHAT_TXT = '聊天记录.txt'

export async function parseExportZip(
  zip: Uint8Array | ArrayBuffer,
  opts: { fileName?: string; onProgress?: (p: number) => void } = {},
): Promise<ParsedExport> {
  const progress = opts.onProgress ?? (() => {})
  const bytes = toU8(zip)
  progress(0)
  const entries: Entry[] = []
  const files = safeUnzip(bytes, (f) => {
    const path = decodeEntryName(f.name)
    if (isJunk(path)) return false
    entries.push({ rawName: f.name, path, name: basename(path), originalSize: f.originalSize })
    // only text files are inflated; media are listed by size without decompressing
    return path.toLowerCase().endsWith('.txt') && (f.compression === 0 || f.compression === 8)
  })
  progress(0.3)

  const txts = entries.filter((e) => files[e.rawName] !== undefined)
  if (txts.length === 0) throw new ParseError('no_txt')
  const chosen =
    txts.filter((e) => e.name === CHAT_TXT).sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0] ??
    [...txts].sort((a, b) => b.originalSize - a.originalSize)[0]

  const warnings: Warning[] = []
  if (txts.length > 1) warnings.push({ line: 0, code: 'multiple_txt' })
  const text = decodeText(files[chosen.rawName], warnings)
  progress(0.4)

  const sha256 = await sha256Hex(bytes)
  progress(0.7)

  const mediaFiles: MediaFileInfo[] = entries
    .filter((e) => e !== chosen)
    .map((e) => ({ name: e.name, path: e.path, ...mediaKindAndMime(e.name), byteSize: e.originalSize, referenced: false }))

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
