import { describe, expect, it } from 'vitest'
import { ParsedExportSchema } from '@/contracts'
import { parseExportText, parseExportZip, readMediaFiles, summarize } from '@/lib/wechat-export'
import { macExportSample } from '@/lib/wechat-export/test-synthetic'
import { alignMessages } from '@/server/import/align'

describe('Mac English exports', () => {
  it('parses dates, English tags and nested attachments, retaining original bodies', async () => {
    const sample = macExportSample()
    const parsed = await parseExportZip(sample.zip, { fileName: sample.fileName })
    expect(() => ParsedExportSchema.parse(parsed)).not.toThrow()
    expect(parsed.messages).toHaveLength(7)
    expect(parsed.messages[0].body).toBe('Hello，测试消息😀\n\n·清单项目\n  保留缩进')
    expect(parsed.messages[1].meta).toEqual({ title: '示例报名' })
    expect(parsed.messages[2].meta).toEqual({ title: '示例文章', url: 'https://example.com/read?a=1&b=2#section' })
    expect(parsed.messages.slice(3, 6).map((m) => [m.kind, m.body, m.attachmentName])).toEqual([
      ['image', `[Photo] ${sample.imageName}`, sample.imageName],
      ['image', `[Photo] ${sample.secondImageName}`, sample.secondImageName],
      ['video', `[Video] ${sample.videoName}`, sample.videoName],
    ])
    expect(summarize(parsed)).toMatchObject({
      messageCount: 7,
      dateFrom: '2026-01-05 08:03',
      dateTo: '2026-01-05 08:07',
      senders: [{ name: '示例乙', count: 5 }, { name: '测试甲', count: 2 }],
      byKind: { text: 2, mini_program: 1, link: 1, image: 2, video: 1 },
      images: { count: 2, bytes: sample.imageBytes.length * 2 },
      videos: { count: 1, bytes: sample.videoBytes.length },
    })
    expect(parsed.exportedAt).toBe('2026-01-05T04:00:00.000Z')
    expect(parsed.media.filter((m) => m.referenced)).toHaveLength(3)
    expect(parsed.warnings).toEqual([{ line: 0, code: 'multiple_txt' }])
    expect(parsed.messages).toEqual(parseExportText('\ufeff' + sample.text.replace(/\n/g, '\r\n'), { mediaFiles: parsed.media }).messages)

    const media = await readMediaFiles(sample.zip, [sample.imageName, `${sample.mediaDir}/${sample.videoName}`])
    expect(media.get(sample.imageName)).toEqual(sample.imageBytes)
    expect(media.get(`${sample.mediaDir}/${sample.videoName}`)).toEqual(sample.videoBytes)
  })

  it('reuses re-exported messages after media renaming without collapsing same-minute photos', async () => {
    const first = await parseExportZip(macExportSample().zip)
    const later = await parseExportZip(macExportSample('202601061530', 7).zip)
    const existing = first.messages.map((m) => ({ id: m.idx + 1, seq: (m.idx + 1) * 1024, fingerprint: m.fingerprint, sentAt: m.sentAt }))
    const aligned = alignMessages(existing, later.messages)
    expect(aligned.insert).toEqual([])
    expect(aligned.reuse.map((m) => m.messageId)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(later.messages.slice(3, 5).map((m) => m.attachmentName)).toEqual(['Weixin Image_202601061530_7.jpg', 'Weixin Image_202601061530_8.jpg'])
  })

  it('keeps missing English media references as attachment warnings', () => {
    const p = parseExportText('·测试甲\n2026-1-5 08:03\n[Photo]\n\n·测试甲\n2026-1-5 08:04\n[Video] Weixin Video_202601051030_1.mp4')
    expect(p.messages.map((m) => [m.kind, m.attachmentName])).toEqual([['image', null], ['video', null]])
    expect(p.warnings.map((w) => w.code)).toEqual(['attachment_no_name', 'attachment_missing'])
  })
})
