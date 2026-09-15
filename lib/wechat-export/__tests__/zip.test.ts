import { createHash } from 'node:crypto'
import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { ExportPreviewSchema, ParsedExportSchema } from '@/contracts'
import { ParseError, parseExportText, parseExportZip, readMediaFiles, summarize } from '@/lib/wechat-export'
import { buildExportText, buildExportZip, MEDIA_DIR } from '@/lib/wechat-export/testing/synthetic'
import { decodeEntryName } from '@/lib/wechat-export/zip'

const bytes = (n: number, v = 7) => new Uint8Array(n).fill(v)

const text = buildExportText([
  { sender: '测试甲', at: '2026-09-01 10:00', body: '看看这个' },
  { sender: '测试乙', at: '2026-09-01 10:01', body: '[图片] 微信图片_202609011000_1.jpg' },
  { sender: '测试乙', at: '2026-09-01 10:01', body: '[图片] ' },
  { sender: '测试乙', at: '2026-09-01 10:02', body: '[图片] 微信图片_202609011000_9.jpg' },
  { sender: '测试甲', at: '2026-09-01 10:03', body: '[视频] 微信视频_202609011000_1.mp4' },
  { sender: '测试甲', at: '2026-09-01 10:04', body: '[语音] 5"' },
  { sender: '测试乙', at: '2026-09-02 09:00', body: '[未知类型] 什么东西' },
])

function sampleZip(opts: { clearUtf8Flag?: boolean } = {}) {
  return buildExportZip({
    text,
    media: [
      { name: '微信图片_202609011000_1.jpg', bytes: bytes(1234, 1) },
      { name: '微信图片_202609011000_2.jpg', bytes: bytes(500, 2) }, // present but unreferenced
      { name: '微信视频_202609011000_1.mp4', bytes: bytes(9000, 3) },
    ],
    ...opts,
  })
}

async function expectParseError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(ParseError)
  await expect(p).rejects.toMatchObject({ code })
}

describe('parseExportZip', () => {
  it('parses messages, links attachments, lists media without names flag (WeChat iOS style)', async () => {
    const zip = sampleZip()
    const progress: number[] = []
    const p = await parseExportZip(zip, { fileName: '聊天记录_20260101_120000.zip', onProgress: (x) => progress.push(x) })
    expect(() => ParsedExportSchema.parse(p)).not.toThrow()
    expect(p.sha256).toBe(createHash('sha256').update(zip).digest('hex'))
    expect(p.exportedAt).toBe('2026-01-01T04:00:00.000Z')
    expect(p.messages.map((m) => [m.kind, m.attachmentName])).toEqual([
      ['text', null],
      ['image', '微信图片_202609011000_1.jpg'],
      ['image', null], // empty filename
      ['image', null], // missing media
      ['video', '微信视频_202609011000_1.mp4'],
      ['voice', null],
      ['unknown', null],
    ])
    expect(p.messages[3].meta).toEqual({ fileName: '微信图片_202609011000_9.jpg' })
    expect(p.messages[6].body).toBe('[未知类型] 什么东西')
    expect(p.media).toEqual([
      { name: '微信图片_202609011000_1.jpg', path: `${MEDIA_DIR}/微信图片_202609011000_1.jpg`, kind: 'image', byteSize: 1234, mime: 'image/jpeg', referenced: true },
      { name: '微信图片_202609011000_2.jpg', path: `${MEDIA_DIR}/微信图片_202609011000_2.jpg`, kind: 'image', byteSize: 500, mime: 'image/jpeg', referenced: false },
      { name: '微信视频_202609011000_1.mp4', path: `${MEDIA_DIR}/微信视频_202609011000_1.mp4`, kind: 'video', byteSize: 9000, mime: 'video/mp4', referenced: true },
    ])
    expect(p.warnings.map((w) => w.code)).toEqual(['attachment_no_name', 'attachment_missing', 'unknown_kind'])
    expect(progress[0]).toBe(0)
    expect(progress[progress.length - 1]).toBe(1)
    expect([...progress].sort((a, b) => a - b)).toEqual(progress)
  })

  it('gives the same result with the UTF-8 flag set', async () => {
    const a = await parseExportZip(sampleZip())
    const b = await parseExportZip(sampleZip({ clearUtf8Flag: false }))
    expect(b.messages).toEqual(a.messages)
    expect(b.media).toEqual(a.media)
  })

  it('summarize: counts, date range, senders by count, kinds, image/video bytes', async () => {
    const p = await parseExportZip(sampleZip())
    const s = summarize(p)
    expect(() => ExportPreviewSchema.parse(s)).not.toThrow()
    expect(s).toEqual({
      messageCount: 7,
      dateFrom: '2026-09-01 10:00',
      dateTo: '2026-09-02 09:00',
      senders: [
        { name: '测试乙', count: 4 },
        { name: '测试甲', count: 3 },
      ],
      byKind: { text: 1, image: 3, video: 1, voice: 1, unknown: 1 },
      images: { count: 2, bytes: 1734 },
      videos: { count: 1, bytes: 9000 },
    })
  })

  it('zip with all media missing still parses', async () => {
    const zip = buildExportZip({ text })
    const p = await parseExportZip(zip)
    expect(p.messages).toHaveLength(7)
    expect(p.media).toEqual([])
    expect(p.messages.every((m) => m.attachmentName === null)).toBe(true)
    expect(summarize(p).images).toEqual({ count: 0, bytes: 0 })
  })

  it('finds the txt inside a folder, ignores __MACOSX junk, accepts ArrayBuffer', async () => {
    const zip = zipSync({
      '__MACOSX/._聊天记录.txt': strToU8('junk'),
      'export/聊天记录.txt': strToU8(text),
      'export/.DS_Store': bytes(3),
    })
    const ab = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength)
    const p = await parseExportZip(ab)
    expect(p.messages).toHaveLength(7)
    expect(p.media).toEqual([])
  })

  it('decodes GBK text with a warning', async () => {
    // "·甲\n2026年09月01日 10:00\n你好\n" in GBK
    const gbk = new Uint8Array([
      0xa1, 0xa4, 0xbc, 0xd7, 0x0a, ...strToU8('2026'), 0xc4, 0xea, ...strToU8('09'), 0xd4, 0xc2, ...strToU8('01'), 0xc8, 0xd5,
      ...strToU8(' 10:00\n'), 0xc4, 0xe3, 0xba, 0xc3, 0x0a,
    ])
    // GBK has no U+00B7 "·" as A1A4 (that's "·" U+00B7 in GB18030) — assert via decoder rather than hardcoding
    const decoded = new TextDecoder('gbk').decode(gbk)
    const zip = buildExportZip({ text: gbk })
    if (decoded.startsWith('·')) {
      const p = await parseExportZip(zip)
      expect(p.messages[0].body).toBe('你好')
      expect(p.warnings).toContainEqual({ line: 0, code: 'decoded_gbk' })
    } else {
      await expectParseError(parseExportZip(zip), 'no_messages')
    }
  })

  it('parse errors: not_zip, no_txt, no_messages, bad_encoding', async () => {
    await expectParseError(parseExportZip(strToU8('definitely not a zip')), 'not_zip')
    await expectParseError(parseExportZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])), 'not_zip')
    await expectParseError(parseExportZip(zipSync({ 'a.jpg': bytes(10) })), 'no_txt')
    await expectParseError(parseExportZip(zipSync({ '聊天记录.txt': strToU8('just some text\n') })), 'no_messages')
    await expectParseError(parseExportZip(zipSync({ '聊天记录.txt': new Uint8Array([0xff, 0xff, 0xff, 0x80, 0x81]) })), 'bad_encoding')
  })

  it('readMediaFiles returns bytes by name or path, omits missing', async () => {
    const zip = sampleZip()
    const m = await readMediaFiles(zip, ['微信图片_202609011000_1.jpg', `${MEDIA_DIR}/微信视频_202609011000_1.mp4`, 'nope.jpg'])
    expect([...m.keys()].sort()).toEqual([`${MEDIA_DIR}/微信视频_202609011000_1.mp4`, '微信图片_202609011000_1.jpg'].sort())
    expect(m.get('微信图片_202609011000_1.jpg')).toEqual(bytes(1234, 1))
    expect(m.get(`${MEDIA_DIR}/微信视频_202609011000_1.mp4`)?.length).toBe(9000)
    expect((await readMediaFiles(zip, [])).size).toBe(0)
  })

  it('decodeEntryName re-decodes latin1-mangled UTF-8 and leaves ASCII/decoded names alone', () => {
    const utf8 = strToU8('聊天记录.txt')
    const latin1 = String.fromCharCode(...utf8)
    expect(decodeEntryName(latin1)).toBe('聊天记录.txt')
    expect(decodeEntryName('plain.txt')).toBe('plain.txt')
    expect(decodeEntryName('聊天记录.txt')).toBe('聊天记录.txt')
  })

  it('parseExportText with mediaFiles marks referenced without mutating input', () => {
    const media = [{ name: '微信图片_202609011000_1.jpg', path: 'x/微信图片_202609011000_1.jpg', kind: 'image' as const, byteSize: 1, mime: 'image/jpeg', referenced: false }]
    const p = parseExportText(text, { mediaFiles: media })
    expect(p.media[0].referenced).toBe(true)
    expect(media[0].referenced).toBe(false)
    expect(p.sha256).toBe('')
  })
})
