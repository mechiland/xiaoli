// Re-export dedup fixture (DECISIONS eval-synthetic E19): the same private chat exported twice, with images/videos named
// by EXPORT time as WeChat does, so every overlapping photo/video has a different file name in each export.
// Import dedup (SPEC §8.4) = parser fingerprint + `alignMessages`; importing both exports into one chat must add 0 duplicates.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { ParsedMessage } from '@/contracts'
import { parseExportZip } from '@/lib/wechat-export'
import { fnv1a64Hex } from '@/lib/wechat-export/hash'
import { alignMessages, SEQ_STEP } from '@/server/import/align'
import { REEXPORT_FIRST, REEXPORT_SECOND } from '../../scripts/synthetic/chats/private-reexport'
import { generateReexportExports, notAnnotatedZips, OUT_DIR } from '../../scripts/synthetic/generate'
import { exportMinute, MEDIA_DIR } from '../../scripts/synthetic/lib'
import { evalPaths, goldPathFor, REPO_ROOT } from '../src/paths'
import { NOT_ANNOTATED_ZIPS } from '../src/run'

type Overlap = { with: string; messages: number; media: { messages: number; renamed: number }; thisIdxRange: [number, number]; otherIdxRange: [number, number] }
const zipPath = (file: string) => path.join(REPO_ROOT, OUT_DIR, file)
const intentOf = (file: string) => JSON.parse(readFileSync(zipPath(file).replace(/\.zip$/, '.intent.json'), 'utf8')) as { overlaps: Overlap[]; messageCount: number }

async function load(file: string) {
  const bytes = new Uint8Array(readFileSync(zipPath(file)))
  const parsed = await parseExportZip(bytes, { fileName: file })
  const entries = unzipSync(bytes)
  const sha = (name: string) => createHash('sha256').update(entries[`${MEDIA_DIR}/${name}`]).digest('hex')
  return { parsed, entries, sha }
}
type Loaded = Awaited<ReturnType<typeof load>>

const GENERATED = /微信(图片|视频)_(\d{12})_(\d+)\.(jpg|mp4)/
const MEDIA_KINDS = new Set(['image', 'video'])

/** What a person sees as "the same message": sender, minute, kind, and for media the file BYTES (not its name). */
function identity(l: Loaded, m: ParsedMessage): string {
  const content = m.attachmentName ? `sha:${l.sha(m.attachmentName)}` : m.body.replace(GENERATED, '微信$1_*')
  return `${m.senderName}|${m.sentAt}|${m.kind}|${content}`
}

/** parser@1 (committed until the overall-critic round 1): FNV-1a over the literal body, file name included. */
const fingerprintV1 = (m: ParsedMessage) => fnv1a64Hex(`${m.senderName}${m.sentAt}${m.kind}${m.body}`)
const fingerprintParser = (m: ParsedMessage) => m.fingerprint

/** Stores `stored` as a chat, aligns `incoming` against it as import mapping does, returns the merged chat in seq order. */
function importInto(stored: Loaded, incoming: Loaded, fp: (m: ParsedMessage) => string) {
  const existing = stored.parsed.messages.map((m, i) => ({ id: i + 1, seq: (i + 1) * SEQ_STEP, fingerprint: fp(m), sentAt: m.sentAt }))
  const r = alignMessages(
    existing,
    incoming.parsed.messages.map((m) => ({ ...m, fingerprint: fp(m) })),
  )
  const seq = new Map(existing.map((e) => [e.id, e.seq]))
  for (const x of r.resequence) seq.set(x.messageId, x.seq)
  const rows = [
    ...stored.parsed.messages.map((m, i) => ({ seq: seq.get(i + 1)!, key: identity(stored, m) })),
    ...r.insert.map((x) => ({ seq: x.seq, key: identity(incoming, incoming.parsed.messages[x.incomingIdx]) })),
  ].sort((a, b) => a.seq - b.seq)
  expect(new Set(rows.map((x) => x.seq)).size).toBe(rows.length)
  return { result: r, merged: rows.map((x) => x.key) }
}

/** Messages in `merged` beyond what the union of both exports contains (multiset difference). */
function duplicates(merged: string[], expected: string[]): string[] {
  const left = new Map<string, number>()
  for (const k of expected) left.set(k, (left.get(k) ?? 0) + 1)
  const extra: string[] = []
  for (const k of merged) {
    const n = left.get(k) ?? 0
    if (n > 0) left.set(k, n - 1)
    else extra.push(k)
  }
  return extra
}

describe('re-export dedup fixture (media named by export time)', async () => {
  const first = await load(REEXPORT_FIRST)
  const second = await load(REEXPORT_SECOND)
  const ov = intentOf(REEXPORT_FIRST).overlaps.find((o) => o.with === REEXPORT_SECOND)!
  const overlapA = first.parsed.messages.slice(ov.thisIdxRange[0], ov.thisIdxRange[1] + 1)
  const overlapB = second.parsed.messages.slice(ov.otherIdxRange[0], ov.otherIdxRange[1] + 1)
  // union of both exports in chat order: the first export, then what only the second has
  const union = [...first.parsed.messages.map((m) => identity(first, m)), ...second.parsed.messages.slice(ov.messages).map((m) => identity(second, m))]

  it('is generated, not annotated, and skipped by eval without a warning', () => {
    expect(generateReexportExports().map((e) => e.file)).toEqual([REEXPORT_FIRST, REEXPORT_SECOND])
    expect(NOT_ANNOTATED_ZIPS).toEqual(new Set(notAnnotatedZips()))
    const paths = evalPaths(REPO_ROOT)
    for (const f of [REEXPORT_FIRST, REEXPORT_SECOND]) expect(existsSync(goldPathFor(paths, 'synthetic', f))).toBe(false)
  })

  it.each([REEXPORT_FIRST, REEXPORT_SECOND])('%s names every image/video by its own export minute, n = 1, 2, … per type', async (file) => {
    const l = file === REEXPORT_FIRST ? first : second
    const counters: Record<string, number> = {}
    const named = l.parsed.messages.filter((m) => MEDIA_KINDS.has(m.kind) && GENERATED.test(m.body))
    expect(named.length).toBeGreaterThanOrEqual(10)
    for (const m of named) {
      const [, , stamp, n, ext] = GENERATED.exec(m.body)!
      expect(stamp).toBe(exportMinute(file))
      counters[ext] = (counters[ext] ?? 0) + 1
      expect(+n).toBe(counters[ext])
    }
    for (const x of l.parsed.media.filter((x) => x.kind !== 'file')) expect(x.name.includes(`_${exportMinute(file)}_`)).toBe(true)
  })

  it('the overlap is the same messages, mostly photos/videos, each renamed with identical bytes', () => {
    expect(ov.messages).toBe(overlapA.length)
    expect(overlapB).toHaveLength(ov.messages)
    expect(overlapA.map((m) => identity(first, m))).toEqual(overlapB.map((m) => identity(second, m)))
    const renamed = overlapA.filter((m, i) => MEDIA_KINDS.has(m.kind) && m.body !== overlapB[i].body)
    expect(renamed.length).toBe(ov.media.renamed)
    expect(renamed.length).toBeGreaterThanOrEqual(10)
    expect(overlapA.filter((m) => m.kind === 'video').length).toBeGreaterThanOrEqual(3)
    // linked files: different names, same bytes
    const linked = overlapA.flatMap((m, i) => (m.attachmentName ? [[m.attachmentName, overlapB[i].attachmentName!] as const] : []))
    expect(linked.length).toBeGreaterThanOrEqual(10)
    for (const [a, b] of linked) {
      if (MEDIA_KINDS.has(first.parsed.messages.find((m) => m.attachmentName === a)!.kind)) expect(a).not.toBe(b)
      expect(first.sha(a)).toBe(second.sha(b))
    }
    // hard cases inside the overlap: same sender + same minute photo burst (identical media-independent fingerprints),
    // both senders sending a photo in one minute, a photo missing from the ZIP, an empty image name, a file
    const burst = overlapA.some((m, i) => i >= 2 && [overlapA[i - 2], overlapA[i - 1]].every((p) => p.kind === 'image' && m.kind === 'image' && p.senderName === m.senderName && p.sentAt === m.sentAt))
    expect(burst).toBe(true)
    expect(overlapA.some((m, i) => i > 0 && m.kind === 'image' && overlapA[i - 1].kind === 'image' && overlapA[i - 1].sentAt === m.sentAt && overlapA[i - 1].senderName !== m.senderName)).toBe(true)
    expect(overlapA.some((m) => m.kind === 'image' && GENERATED.test(m.body) && !m.attachmentName)).toBe(true)
    expect(overlapA.some((m) => m.kind === 'image' && m.body.trim() === '[图片]')).toBe(true)
    expect(overlapA.some((m) => m.kind === 'file' && m.attachmentName)).toBe(true)
  })

  it('catches a file-name-sensitive fingerprint: with parser@1 fingerprints every renamed photo/video is inserted again', () => {
    const { merged } = importInto(first, second, fingerprintV1)
    expect(duplicates(merged, union)).toHaveLength(ov.media.renamed)
  })

  it('parser + alignMessages: importing the later export into the chat adds 0 duplicates and loses nothing', () => {
    const { result, merged } = importInto(first, second, fingerprintParser)
    expect(duplicates(merged, union)).toEqual([])
    expect(merged).toEqual(union)
    expect(result.reuse).toHaveLength(ov.messages)
    expect(result.insert).toHaveLength(second.parsed.messages.length - ov.messages)
  })

  it('parser + alignMessages: importing the earlier export after the later one adds 0 duplicates and loses nothing', () => {
    const { result, merged } = importInto(second, first, fingerprintParser)
    expect(duplicates(merged, union)).toEqual([])
    expect(merged).toEqual(union)
    expect(result.reuse).toHaveLength(ov.messages)
    expect(result.insert).toHaveLength(first.parsed.messages.length - ov.messages)
  })

  it('parser + alignMessages: importing the same export twice reuses every message', () => {
    for (const l of [first, second]) {
      const { result } = importInto(l, l, fingerprintParser)
      expect(result.insert).toEqual([])
      expect(result.reuse).toHaveLength(l.parsed.messages.length)
    }
  })
})

