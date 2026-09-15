// fixtures/synthetic: determinism, SPEC §6 format (validated with the minimal splitter, independent of the parser),
// coverage of every message kind and edge case, overlap between the two private exports, perf zip size.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { checkCommitted, generateAll, generateEvalExports, OUT_DIR } from '../../scripts/synthetic/generate'
import { declaredKind, MEDIA_DIR, TXT_NAME } from '../../scripts/synthetic/lib'
import { PERF_FILE } from '../../scripts/synthetic/perf'
import { HEADER_TIME, splitExportText } from '../../scripts/synthetic/split'
import { REPO_ROOT } from '../src/paths'
import { sensitiveHits } from '../src/text'

const exportsList = generateEvalExports()
const readZip = (file: string) => unzipSync(new Uint8Array(readFileSync(path.join(REPO_ROOT, OUT_DIR, file))))
type Intent = {
  messageCount: number
  chat: { kind: string }
  kinds: Record<string, number>
  edgeCases: Record<string, number[]>
  planted: { id: string; type: string; supersedes?: string; idx: number[]; text: string; value?: string; label?: string }[]
  negatives: { kind: string; description: string; forbidden?: string }[]
  sensitiveValues: string[]
  media: { included: string[]; missing: string[]; unreferenced: string[] }
  overlaps: { with: string; messages: number; sentAtRange: [string, string]; thisIdxRange: [number, number]; otherIdxRange: [number, number] }[]
  textFile: { bom: boolean; lineEnding: 'lf' | 'crlf'; trailingNewline: boolean }
}
const intentOf = (file: string) => JSON.parse(readFileSync(path.join(REPO_ROOT, OUT_DIR, file.replace(/\.zip$/, '.intent.json')), 'utf8')) as Intent

describe('synthetic generator', () => {
  it('is deterministic and the committed files match a fresh generation', () => {
    const a = generateAll()
    const b = generateAll()
    expect(a.map((f) => f.path)).toEqual(b.map((f) => f.path))
    a.forEach((f, i) => expect(Buffer.from(f.bytes).equals(Buffer.from(b[i].bytes))).toBe(true))
    expect(checkCommitted(REPO_ROOT, a)).toEqual([])
  })

  it('has one private and two group chats, each a few hundred messages', () => {
    const kinds = exportsList.map((e) => e.kind)
    expect(kinds.filter((k) => k === 'private').length).toBeGreaterThanOrEqual(2)
    expect(kinds.filter((k) => k === 'group').length).toBeGreaterThanOrEqual(2)
    for (const e of exportsList) {
      expect(e.messageCount).toBeGreaterThanOrEqual(150)
      expect(e.messageCount).toBeLessThanOrEqual(400)
      expect(e.file).toMatch(/^聊天记录_\d{8}_\d{6}\.zip$/)
    }
  })
})

describe.each(exportsList.map((e) => e.file))('%s', (file) => {
  const zip = readZip(file)
  const intent = intentOf(file)
  const raw = zip[TXT_NAME]
  const txt = strFromU8(raw) // TextDecoder drops a leading BOM
  const messages = splitExportText(txt)

  it('matches the SPEC §6 layout and splits into the planted message count', () => {
    expect(Object.keys(zip)[0]).toBe(TXT_NAME)
    expect(Object.keys(zip).filter((k) => k !== TXT_NAME).every((k) => k.startsWith(`${MEDIA_DIR}/`))).toBe(true)
    expect(txt.replace(/^\uFEFF/, '').startsWith('·')).toBe(true)
    expect(messages).toHaveLength(intent.messageCount)
    for (let i = 1; i < messages.length; i++) expect(messages[i].sentAt >= messages[i - 1].sentAt).toBe(true)
    for (const m of messages) expect(HEADER_TIME.test(m.time)).toBe(true)
  })

  it('text-file edge cases (BOM, CRLF, final newline) are exactly what intent.textFile declares', () => {
    const hasBom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf
    expect(hasBom).toBe(intent.textFile.bom)
    const cr = raw.filter((b) => b === 0x0d).length
    const lf = raw.filter((b) => b === 0x0a).length
    if (intent.textFile.lineEnding === 'crlf') expect(cr).toBe(lf)
    else expect(cr).toBe(0)
    expect(raw[raw.length - 1] === 0x0a).toBe(intent.textFile.trailingNewline)
    expect(intent.edgeCases.bom.length > 0).toBe(intent.textFile.bom)
    expect(intent.edgeCases.crlf.length).toBe(intent.textFile.lineEnding === 'crlf' ? messages.length : 0)
    expect(intent.edgeCases.noTrailingNewline).toEqual(intent.textFile.trailingNewline ? [] : [messages.length - 1])
  })

  it('reads like a real chat: no text body repeated more than twice, time words fit the clock', () => {
    const ack = /^(收到|好的|谢谢|哈+)$/
    const counts = new Map<string, number>()
    for (const m of messages) {
      if (declaredKind(m.body).kind !== 'text' || [...m.body].length < 4 || ack.test(m.body)) continue
      counts.set(m.body, (counts.get(m.body) ?? 0) + 1)
    }
    expect([...counts].filter(([, n]) => n > 2)).toEqual([])
    const hour = (m: { sentAt: string }) => +m.sentAt.slice(11, 13)
    expect(messages.filter((m) => m.body.includes('晚安') && hour(m) < 20).map((m) => m.idx)).toEqual([])
    expect(messages.filter((m) => m.body.startsWith('早') && hour(m) >= 11).map((m) => m.idx)).toEqual([])
    expect(messages.filter((m) => /降温|银杏大道/.test(m.body) && [5, 6, 7, 8].includes(+m.sentAt.slice(5, 7))).map((m) => m.idx)).toEqual([])
  })

  it('media: referenced files exist, missing ones do not, unreferenced ones are present', () => {
    for (const name of intent.media.included) expect(zip[`${MEDIA_DIR}/${name}`]).toBeDefined()
    for (const name of intent.media.missing) expect(zip[`${MEDIA_DIR}/${name}`]).toBeUndefined()
    for (const name of intent.media.unreferenced) expect(zip[`${MEDIA_DIR}/${name}`]).toBeDefined()
    for (const [k, v] of Object.entries(zip)) if (k.endsWith('.jpg')) expect([v[0], v[1], v[v.length - 2], v[v.length - 1]]).toEqual([0xff, 0xd8, 0xff, 0xd9])
  })

  it('sensitive values planted in the text are detected by the harness detector', () => {
    for (const v of intent.sensitiveValues) {
      expect(txt).toContain(v)
      expect(sensitiveHits(v).length).toBeGreaterThan(0)
    }
  })
})

describe('coverage across the synthetic eval set', () => {
  const intents = exportsList.map((e) => intentOf(e.file))
  const union = <T>(f: (i: Intent) => T[]) => new Set(intents.flatMap(f))

  it('covers every SPEC §6 kind plus the guessed unseen formats', () => {
    const kinds = union((i) => Object.keys(i.kinds))
    for (const k of ['text', 'sticker_code', 'image', 'video', 'voice', 'transfer', 'red_packet', 'mini_program', 'channels', 'animated_sticker', 'video_call', 'unknown', 'quote', 'recall', 'system', 'file', 'link', 'location', 'contact_card', 'forward']) {
      expect(kinds, k).toContain(k)
    }
  })

  it('covers every edge case', () => {
    for (const k of ['multiline', 'bodyLineStartsWithDot', 'bodyLineLooksLikeTime', 'emptyImageName', 'missingMedia', 'unknownBracket', 'sameMinuteDuplicate', 'stickerOnly', 'stickerMixed', 'unicodeEmoji', 'mention', 'quote', 'recall', 'contactCard', 'location', 'link', 'file', 'forward', 'system', 'bom', 'crlf', 'noTrailingNewline']) {
      expect(intents.some((i) => i.edgeCases[k].length > 0), k).toBe(true)
    }
    const groups = intents.filter((i) => i.chat.kind === 'group')
    expect(groups.every((i) => i.edgeCases.mention.length > 0)).toBe(true)
  })

  it('plants supersedes, all fact types, all negative kinds and sensitive values', () => {
    expect(union((i) => i.planted.map((p) => p.type))).toEqual(new Set(['claim', 'handle', 'relation', 'date', 'event']))
    expect(intents.some((i) => i.planted.some((p) => p.supersedes))).toBe(true)
    expect(union((i) => i.negatives.map((n) => n.kind))).toEqual(new Set(['transactional', 'coordination', 'inference_trap', 'sensitive', 'invisible_content']))
    expect(intents.every((i) => i.negatives.length > 0)).toBe(true)
    expect(union((i) => i.sensitiveValues).size).toBeGreaterThanOrEqual(5)
  })

  it('the two private exports overlap with identical messages (incl. a same-minute duplicate) for dedup tests', () => {
    const [first, second] = exportsList.filter((e) => e.kind === 'private').map((e) => e.file)
    const a = splitExportText(strFromU8(readZip(first)[TXT_NAME]))
    const b = splitExportText(strFromU8(readZip(second)[TXT_NAME]))
    const ov = intentOf(first).overlaps.find((o) => o.with === second)!
    expect(ov.messages).toBeGreaterThanOrEqual(20)
    expect(ov.thisIdxRange[1]).toBe(a.length - 1)
    expect(ov.otherIdxRange[0]).toBe(0)
    const tailA = a.slice(ov.thisIdxRange[0]).map((m) => [m.senderName, m.sentAt, m.body])
    const headB = b.slice(0, ov.messages).map((m) => [m.senderName, m.sentAt, m.body])
    expect(tailA).toEqual(headB)
    // README states the computed overlap, not a hand-written window
    const readme = readFileSync(path.join(REPO_ROOT, OUT_DIR, 'README.md'), 'utf8')
    expect(ov.sentAtRange).toEqual([a[ov.thisIdxRange[0]].sentAt, a[a.length - 1].sentAt])
    expect(readme).toContain(`重叠 ${ov.messages} 条消息，${ov.sentAtRange[0]} 至 ${ov.sentAtRange[1]}`)
    const dups = intentOf(second).edgeCases.sameMinuteDuplicate
    expect(dups.some((i) => i < ov.messages)).toBe(true)
    // supersede planted in the second export for a claim first planted in the first
    const planted = intentOf(second).planted
    expect(planted.find((p) => p.id === 'y-work-new')?.supersedes).toBe('y-work-old')
  })
})

describe('annotator-readable docs stay blind (ARCHITECTURE §7.6)', () => {
  it('GOLD_FORMAT.md, gold-schema.ts and the fixtures README contain no planted item, negative or sensitive value', () => {
    const needles = new Set<string>()
    for (const e of exportsList) {
      const i = intentOf(e.file)
      for (const p of i.planted) for (const v of [p.text, p.value, p.label]) if (v) needles.add(v)
      for (const n of i.negatives) for (const v of [n.description, n.forbidden]) if (v) needles.add(v)
      for (const v of i.sensitiveValues) needles.add(v).add(v.replace(/\s/g, ''))
    }
    for (const doc of ['eval/src/GOLD_FORMAT.md', 'eval/src/gold-schema.ts', `${OUT_DIR}/README.md`]) {
      const text = readFileSync(path.join(REPO_ROOT, doc), 'utf8')
      expect([...needles].filter((n) => text.includes(n)), doc).toEqual([])
    }
  })
})

describe('perf zip', () => {
  it(`${PERF_FILE} has 5000 messages and stays small`, () => {
    const bytes = readFileSync(path.join(REPO_ROOT, OUT_DIR, PERF_FILE))
    expect(bytes.length).toBeLessThan(1_000_000)
    const zip = unzipSync(new Uint8Array(bytes))
    expect(splitExportText(strFromU8(zip[TXT_NAME]))).toHaveLength(5000)
  })
})
