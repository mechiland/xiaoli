// Public entry of the parser module (ARCHITECTURE §1.2). Pure TS: runs in browsers, Workers and Node ≥ 20.
// No Node APIs (fs, Buffer, node:crypto); ZIP via fflate, SHA-256 via crypto.subtle.
import type { MediaFileInfo, ParsedExport } from '@/contracts'
import { buildParsedExport } from './text'

export { PARSER_VERSION } from './version'
export { ParseError, isParseError, type ParseErrorCode } from './errors'
export { fingerprint, fingerprintBody, sha256Hex, messagesDigest } from './hash'
export { classifyBody, extractMentions, STICKER_CODES } from './classify'
export { parseExportZip, readMediaFiles } from './zip'
export { summarize } from './summarize'
export type { ExportPreview, MediaFileInfo, ParsedExport, ParsedMessage, MessageKind, MessageMeta } from '@/contracts'

/**
 * Parse `聊天记录.txt` content without a ZIP. `sha256` is '' (no file bytes); media come from `opts.mediaFiles`.
 * Throws ParseError('no_messages') when no message start is found.
 */
export function parseExportText(txt: string, opts: { fileName?: string; mediaFiles?: MediaFileInfo[] } = {}): ParsedExport {
  return buildParsedExport(txt, { fileName: opts.fileName, mediaFiles: opts.mediaFiles })
}
