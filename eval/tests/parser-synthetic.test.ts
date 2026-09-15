// The real parser (lib/wechat-export, same wave) over the committed synthetic ZIPs: message split must agree with the
// independent §6 splitter and with the generator's planted counts; SPEC §6 kinds must match the generator's declaration.
// Guessed formats (quote/recall/system/file/link/location/contact_card/forward) are compared but only reported.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseExportZip } from '@/lib/wechat-export'
import { generateEvalExports, OUT_DIR } from '../../scripts/synthetic/generate'
import { TXT_NAME } from '../../scripts/synthetic/lib'
import { PERF_FILE } from '../../scripts/synthetic/perf'
import { splitExportText } from '../../scripts/synthetic/split'
import { REPO_ROOT } from '../src/paths'

const SPEC_KINDS = new Set(['text', 'sticker_code', 'image', 'video', 'voice', 'transfer', 'red_packet', 'mini_program', 'channels', 'animated_sticker', 'video_call', 'unknown'])
const files = [...generateEvalExports().map((e) => e.file), PERF_FILE]

describe.each(files)('parser on %s', (file) => {
  it('splits exactly like the §6 splitter, and SPEC kinds match the generator', async () => {
    const bytes = new Uint8Array(readFileSync(path.join(REPO_ROOT, OUT_DIR, file)))
    const parsed = await parseExportZip(bytes, { fileName: file })
    const expected = splitExportText(strFromU8(unzipSync(bytes)[TXT_NAME]))
    expect(parsed.messages.map((m) => [m.idx, m.senderName, m.sentAt, m.body])).toEqual(expected.map((m) => [m.idx, m.senderName, m.sentAt, m.body]))
    if (file === PERF_FILE) return
    const intent = JSON.parse(readFileSync(path.join(REPO_ROOT, OUT_DIR, file.replace(/\.zip$/, '.intent.json')), 'utf8')) as { messageCount: number; kinds: Record<string, number>; guessedFormats: { idx: number; kind: string }[] }
    expect(parsed.messages).toHaveLength(intent.messageCount)
    const byKind: Record<string, number> = {}
    for (const m of parsed.messages) byKind[m.kind] = (byKind[m.kind] ?? 0) + 1
    const guessed = new Set(intent.guessedFormats.map((g) => g.idx))
    const specOnly = (counts: Record<string, number>) => Object.fromEntries(Object.entries(counts).filter(([k]) => SPEC_KINDS.has(k)))
    const parsedSpec: Record<string, number> = {}
    for (const m of parsed.messages) if (!guessed.has(m.idx) && SPEC_KINDS.has(m.kind)) parsedSpec[m.kind] = (parsedSpec[m.kind] ?? 0) + 1
    expect(parsedSpec).toEqual(specOnly(intent.kinds))
    expect(parsed.exportedAt).not.toBeNull()
  })
})
