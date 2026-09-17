import type { MediaFileInfo, MessageMeta, ParsedExport, ParsedMessage } from '@/contracts'
import { parseWechatTime } from '@/lib/time'
import { classifyBody } from './classify'
import { ParseError } from './errors'
import { fingerprint } from './hash'
import { PARSER_VERSION } from './version'

/** SPEC §6: a line starting with `·` whose NEXT line fully matches this is a message start. */
export const TIME_LINE_RE = /^\d{4}年\d{2}月\d{2}日 \d{2}:\d{2}$/
const SENDER_MARK = 0x00b7 // '·'

export type Warning = { line: number; code: string }

export interface RawMessage {
  /** 1-based line number of the `·sender` line (after BOM strip / newline normalisation). */
  line: number
  senderName: string
  sentAt: string
  body: string
}

/** Strip BOM, normalise CRLF / lone CR to LF. */
export function normalizeText(txt: string): string {
  let s = txt
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  if (s.includes('\r')) s = s.replace(/\r\n?/g, '\n')
  return s
}

function isBlank(l: string): boolean {
  return l.trim() === ''
}

/** Time line tolerance: trailing spaces/tabs are ignored (DECISIONS parser P2). */
function timeLine(l: string | undefined): string | null {
  if (l === undefined) return null
  const t = l.charCodeAt(l.length - 1) === 32 || l.charCodeAt(l.length - 1) === 9 ? l.replace(/[ \t]+$/, '') : l
  return TIME_LINE_RE.test(t) ? t : null
}

/** Split normalised export text into raw messages by the exact SPEC §6 rule. Never throws. */
export function splitMessages(txt: string, warnings: Warning[] = []): RawMessage[] {
  const lines = normalizeText(txt).split('\n')
  const starts: { i: number; time: string }[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].charCodeAt(0) !== SENDER_MARK) continue
    const t = timeLine(lines[i + 1])
    if (t !== null) {
      starts.push({ i, time: t })
      i++ // the time line cannot itself start a message
    }
  }
  if (starts.length > 0) {
    for (let j = 0; j < starts[0].i; j++) {
      if (!isBlank(lines[j])) {
        warnings.push({ line: j + 1, code: 'preamble_text' })
        break
      }
    }
  }
  const out: RawMessage[] = new Array(starts.length)
  for (let k = 0; k < starts.length; k++) {
    const { i, time } = starts[k]
    const end = k + 1 < starts.length ? starts[k + 1].i : lines.length
    let a = i + 2
    let b = end - 1
    while (a <= b && isBlank(lines[a])) a++
    while (b >= a && isBlank(lines[b])) b--
    const body = a > b ? '' : a === b ? lines[a] : lines.slice(a, b + 1).join('\n')
    const senderName = lines[i].slice(1)
    if (senderName.trim() === '') warnings.push({ line: i + 1, code: 'empty_sender' })
    out[k] = { line: i + 1, senderName, sentAt: parseWechatTime(time), body }
  }
  return out
}

/** `聊天记录_YYYYMMDD_HHMMSS(.zip)` → ISO Z, interpreted as Asia/Shanghai (UTC+8, no DST). */
export function exportedAtFromFileName(fileName: string | undefined): string | null {
  if (!fileName) return null
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  const m = /(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(base)
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number)
  if (h > 23 || mi > 59 || s > 59) return null
  const local = new Date(Date.UTC(y, mo - 1, d, h, mi, s))
  // reject out-of-range dates that Date.UTC would roll over (month 13, Feb 31, …)
  if (local.getUTCFullYear() !== y || local.getUTCMonth() !== mo - 1 || local.getUTCDate() !== d) return null
  return new Date(local.getTime() - 8 * 3600_000).toISOString()
}

const ATTACHMENT_KINDS = new Set(['image', 'video', 'file'])

export interface BuildOptions {
  fileName?: string
  mediaFiles?: MediaFileInfo[]
  sha256?: string
  warnings?: Warning[]
}

/** Shared assembly for parseExportText / parseExportZip. Throws ParseError('no_messages'). */
export function buildParsedExport(txt: string, opts: BuildOptions = {}): ParsedExport {
  const warnings: Warning[] = [...(opts.warnings ?? [])]
  const raw = splitMessages(txt, warnings)
  if (raw.length === 0) throw new ParseError('no_messages')

  const media = (opts.mediaFiles ?? []).map((m) => ({ ...m, referenced: false }))
  const byName = new Map<string, number>()
  const byLower = new Map<string, number>()
  media.forEach((m, idx) => {
    const key = m.name.normalize('NFC')
    if (byName.has(key)) warnings.push({ line: 0, code: 'duplicate_media_name' })
    else byName.set(key, idx)
    if (!byLower.has(key.toLowerCase())) byLower.set(key.toLowerCase(), idx)
  })

  const senderCounts = new Map<string, number>()
  const messages: ParsedMessage[] = new Array(raw.length)
  let dateFrom: string | null = null
  let dateTo: string | null = null
  let prevAt = ''
  for (let idx = 0; idx < raw.length; idx++) {
    const r = raw[idx]
    const { kind, meta } = classifyBody(r.body)
    let attachmentName: string | null = null
    if (ATTACHMENT_KINDS.has(kind)) {
      const fn = meta.fileName?.normalize('NFC')
      if (!fn) {
        warnings.push({ line: r.line, code: 'attachment_no_name' })
      } else {
        const hit = byName.get(fn) ?? byLower.get(fn.toLowerCase())
        if (hit === undefined) {
          warnings.push({ line: r.line, code: 'attachment_missing' })
        } else {
          media[hit].referenced = true
          attachmentName = media[hit].name
        }
      }
    }
    if (kind === 'unknown') warnings.push({ line: r.line, code: 'unknown_kind' })
    if (prevAt && r.sentAt < prevAt) warnings.push({ line: r.line, code: 'time_out_of_order' })
    prevAt = r.sentAt
    if (dateFrom === null || r.sentAt < dateFrom) dateFrom = r.sentAt
    if (dateTo === null || r.sentAt > dateTo) dateTo = r.sentAt
    senderCounts.set(r.senderName, (senderCounts.get(r.senderName) ?? 0) + 1)
    messages[idx] = {
      idx,
      senderName: r.senderName,
      sentAt: r.sentAt,
      kind,
      body: r.body,
      meta: hasKeys(meta) ? meta : null,
      fingerprint: fingerprint({ senderName: r.senderName, sentAt: r.sentAt, kind, body: r.body }),
      attachmentName,
    }
  }

  return {
    formatVersion: 1,
    parserVersion: PARSER_VERSION,
    fileName: opts.fileName ?? '',
    exportedAt: exportedAtFromFileName(opts.fileName),
    sha256: opts.sha256 ?? '',
    messages,
    // first-appearance order (stable); summarize() sorts by count for display
    senders: [...senderCounts].map(([name, count]) => ({ name, count })),
    media,
    dateFrom,
    dateTo,
    warnings,
  }
}

function hasKeys(m: MessageMeta): boolean {
  for (const _ in m) return true
  return false
}
