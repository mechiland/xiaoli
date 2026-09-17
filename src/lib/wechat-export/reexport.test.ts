// Re-importing a later export of the same chat (SPEC §8.4, M1): WeChat renames every exported image/video by the
// export time, so fingerprints must not depend on generated media names (DECISIONS parser P14). Synthetic data only.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fingerprint, messagesDigest, parseExportZip, PARSER_VERSION } from '@/lib/wechat-export'
import { reexportZip } from '@/lib/wechat-export/test-synthetic'
import { alignMessages } from '@/server/import/align'

const SYNTH = path.resolve(__dirname, '../../../fixtures/synthetic')
const PRIVATE_1 = '聊天记录_20260405_223012.zip'
const load = (f: string) => new Uint8Array(readFileSync(path.join(SYNTH, f)))
const stored = (ms: { fingerprint: string; sentAt: string }[]) => ms.map((m, i) => ({ id: i + 1, seq: (i + 1) * 1024, fingerprint: m.fingerprint, sentAt: m.sentAt }))

describe('later re-export with media renamed by export time', () => {
  it('fixture has image and video messages whose names change in the re-export', async () => {
    const orig = await parseExportZip(load(PRIVATE_1), { fileName: PRIVATE_1 })
    const copy = await parseExportZip(reexportZip(load(PRIVATE_1), { exportMinute: '202609201030', from: 20 }), { fileName: '聊天记录_20260920_103000.zip' })
    const media = copy.messages.filter((m) => (m.kind === 'image' || m.kind === 'video') && m.body.includes('微信'))
    expect(media.length).toBeGreaterThanOrEqual(4)
    expect(media.some((m) => m.kind === 'video')).toBe(true)
    for (const m of media) {
      expect(m.body).toContain('_202609201030_')
      expect(m.attachmentName).not.toBeNull() // still linked to the renamed ZIP entry
      expect(m.body).not.toBe(orig.messages[m.idx + 20].body)
      expect(m.fingerprint).toBe(orig.messages[m.idx + 20].fingerprint)
    }
    expect(copy.messages.map((m) => m.fingerprint)).toEqual(orig.messages.slice(20).map((m) => m.fingerprint))
    expect(copy.parserVersion).toBe(PARSER_VERSION)
  })

  it('an overlapping re-export aligns with 0 inserts', async () => {
    const orig = await parseExportZip(load(PRIVATE_1), { fileName: PRIVATE_1 })
    const copy = await parseExportZip(reexportZip(load(PRIVATE_1), { exportMinute: '202609201030', from: 20 }))
    const r = alignMessages(stored(orig.messages), copy.messages)
    expect(r.insert).toEqual([])
    expect(r.newSeqRanges).toEqual([])
    expect(r.reuse.map((x) => x.messageId)).toEqual(orig.messages.slice(20).map((m) => m.idx + 1))
  })

  it('a longer re-export inserts only the messages after the stored range, never a stored image again', async () => {
    const orig = await parseExportZip(load(PRIVATE_1), { fileName: PRIVATE_1 })
    const cut = Math.floor(orig.messages.length * 0.6)
    const firstCopy = await parseExportZip(reexportZip(load(PRIVATE_1), { exportMinute: '202604010900', to: cut }))
    const later = await parseExportZip(reexportZip(load(PRIVATE_1), { exportMinute: '202609201030', from: 10 }))
    const r = alignMessages(stored(firstCopy.messages), later.messages)
    expect(r.insert.map((x) => x.incomingIdx)).toEqual(later.messages.slice(cut - 10).map((m) => m.idx))
    const storedMedia = firstCopy.messages.slice(10).filter((m) => m.kind === 'image' || m.kind === 'video').length
    expect(storedMedia).toBeGreaterThan(0)
    expect(r.reuse).toHaveLength(cut - 10)
  })

  it('same-minute images from one sender still both survive (sequence alignment, not per-fingerprint dedup)', () => {
    const img = (n: number, minute: string) => {
      const m = { senderName: '测试乙', sentAt: '2026-09-01 10:01', kind: 'image' as const, body: `[图片] 微信图片_${minute}_${n}.jpg` }
      return { idx: n - 1, ...m, meta: null, fingerprint: fingerprint(m), attachmentName: null }
    }
    const first = [img(1, '202609011200')]
    const later = [img(1, '202609201030'), img(2, '202609201030')]
    const r = alignMessages(stored(first), later)
    expect(r.reuse).toHaveLength(1)
    expect(r.insert).toHaveLength(1)
  })

  it('messagesDigest of every synthetic eval ZIP still equals its frozen gold (bodies unchanged)', async () => {
    for (const f of ['聊天记录_20260405_223012.zip', '聊天记录_20260910_183020.zip', '聊天记录_20260912_095501.zip', '聊天记录_20260914_211545.zip']) {
      const gold = JSON.parse(readFileSync(path.resolve(__dirname, '../../../eval/gold/synthetic', `${f}.json`), 'utf8')) as { messagesSha256: string; messageCount: number }
      const p = await parseExportZip(load(f), { fileName: f })
      expect(p.messages).toHaveLength(gold.messageCount)
      expect(await messagesDigest(p.messages), f).toBe(gold.messagesSha256)
    }
  })
})
