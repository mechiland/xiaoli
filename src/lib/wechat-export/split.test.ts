import { describe, expect, it } from 'vitest'
import { ParseError, parseExportText } from '@/lib/wechat-export'
import { buildExportText } from '@/lib/wechat-export/test-synthetic'
import { exportedAtFromFileName, splitMessages } from '@/lib/wechat-export/text'

const T = '2026年09月01日 10:00'

describe('message splitting (SPEC §6 rule)', () => {
  it('parses a basic export', () => {
    const txt = `·测试甲\n${T}\n你好\n\n·测试乙\n2026年09月01日 10:01\n在的\n`
    const p = parseExportText(txt)
    expect(p.messages.map((m) => [m.idx, m.senderName, m.sentAt, m.body])).toEqual([
      [0, '测试甲', '2026-09-01 10:00', '你好'],
      [1, '测试乙', '2026-09-01 10:01', '在的'],
    ])
    expect(p.senders).toEqual([
      { name: '测试甲', count: 1 },
      { name: '测试乙', count: 1 },
    ])
    expect(p.dateFrom).toBe('2026-09-01 10:00')
    expect(p.dateTo).toBe('2026-09-01 10:01')
    expect(p.warnings).toEqual([])
  })

  it('keeps multi-line bodies, strips only leading/trailing blank lines', () => {
    const txt = `·测试甲\n${T}\n\n第一行\n\n第三行\n  缩进行\n\n\n·测试乙\n${T}\n好\n`
    const p = parseExportText(txt)
    expect(p.messages).toHaveLength(2)
    expect(p.messages[0].body).toBe('第一行\n\n第三行\n  缩进行')
    expect(p.messages[0].kind).toBe('text')
  })

  it('normalizes Mac dates for sorting, preserving mixed formats and multi-line bodies', () => {
    const body = 'Hello\n\n·清单\n2026-9-5 is not a time line\n  缩进行😀'
    const p = parseExportText(`·测试甲\n2026-9-5 08:03\t \n${body}\n\n·测试乙\n2026-10-1 09:00\n收到\n\n·测试甲\n${T}\n更早`)
    expect(p.messages.map((m) => m.sentAt)).toEqual(['2026-09-05 08:03', '2026-10-01 09:00', '2026-09-01 10:00'])
    expect(p.messages[0].body).toBe(body)
    expect(p.dateFrom).toBe('2026-09-01 10:00')
    expect(p.dateTo).toBe('2026-10-01 09:00')
    expect(p.warnings.map((w) => w.code)).toEqual(['time_out_of_order'])
    expect(p.messages[0].fingerprint).toBe(parseExportText(`·测试甲\n2026年09月05日 08:03\n${body}`).messages[0].fingerprint)
  })

  it('body line starting with "·" (not followed by a timestamp) stays in the body', () => {
    const txt = `·测试甲\n${T}\n清单：\n·鸡蛋\n·牛奶\n\n·测试乙\n${T}\n收到\n`
    const p = parseExportText(txt)
    expect(p.messages).toHaveLength(2)
    expect(p.messages[0].body).toBe('清单：\n·鸡蛋\n·牛奶')
  })

  it('a "·" line followed by a non-timestamp line is not a start, even directly before a real header', () => {
    const txt = `·测试甲\n${T}\n正文\n·看起来像发送者\n2026年9月1日 10:00\n·测试乙\n${T}\n回复\n`
    const p = parseExportText(txt)
    expect(p.messages.map((m) => m.senderName)).toEqual(['测试甲', '测试乙'])
    expect(p.messages[0].body).toBe('正文\n·看起来像发送者\n2026年9月1日 10:00')
  })

  it('consecutive "·" lines: only the one followed by the timestamp starts a message', () => {
    const txt = `·测试甲\n${T}\n开头\n·不是发送者\n·测试乙\n${T}\n回复`
    const p = parseExportText(txt)
    expect(p.messages.map((m) => [m.senderName, m.body])).toEqual([
      ['测试甲', '开头\n·不是发送者'],
      ['测试乙', '回复'],
    ])
  })

  it('body line that itself is a timestamp is kept', () => {
    const txt = `·测试甲\n${T}\n${T}\n\n·测试乙\n${T}\n好`
    const p = parseExportText(txt)
    expect(p.messages[0].body).toBe(T)
  })

  it('handles CRLF, lone CR, BOM, missing trailing newline', () => {
    const msgs = [
      { sender: '测试甲', at: '2026-09-01 10:00', body: '第一行\n第二行' },
      { sender: '测试乙', at: '2026-09-01 10:02', body: '好' },
    ]
    const base = parseExportText(buildExportText(msgs))
    for (const variant of [
      buildExportText(msgs, { crlf: true }),
      buildExportText(msgs, { bom: true }),
      buildExportText(msgs, { bom: true, crlf: true, trailingNewline: false }),
      buildExportText(msgs).replace(/\n/g, '\r'),
    ]) {
      const p = parseExportText(variant)
      expect(p.messages.map((m) => [m.senderName, m.sentAt, m.body, m.fingerprint])).toEqual(
        base.messages.map((m) => [m.senderName, m.sentAt, m.body, m.fingerprint]),
      )
    }
    expect(base.messages[0].senderName.charCodeAt(0)).not.toBe(0xfeff)
  })

  it('tolerates trailing spaces on the time line', () => {
    const p = parseExportText(`·测试甲\n${T}  \n好\n`)
    expect(p.messages).toHaveLength(1)
    expect(p.messages[0].sentAt).toBe('2026-09-01 10:00')
  })

  it('same-minute duplicate short messages are separate messages with equal fingerprints', () => {
    const txt = `·测试甲\n${T}\n嗯\n\n·测试甲\n${T}\n嗯\n\n·测试甲\n${T}\n嗯\n`
    const p = parseExportText(txt)
    expect(p.messages.map((m) => m.idx)).toEqual([0, 1, 2])
    expect(new Set(p.messages.map((m) => m.fingerprint)).size).toBe(1)
    expect(p.senders).toEqual([{ name: '测试甲', count: 3 }])
  })

  it('empty body and header at end of file', () => {
    const p = parseExportText(`·测试甲\n${T}\n\n\n·测试乙\n${T}`)
    expect(p.messages.map((m) => [m.senderName, m.body, m.kind])).toEqual([
      ['测试甲', '', 'text'],
      ['测试乙', '', 'text'],
    ])
  })

  it('records preamble text and empty sender as warnings without crashing', () => {
    const p = parseExportText(`导出说明\n\n·\n${T}\n匿名\n`)
    expect(p.messages[0].senderName).toBe('')
    expect(p.warnings).toEqual([
      { line: 1, code: 'preamble_text' },
      { line: 3, code: 'empty_sender' },
    ])
  })

  it('flags out-of-order times', () => {
    const p = parseExportText(`·测试甲\n2026年09月02日 10:00\n晚\n\n·测试乙\n${T}\n早\n`)
    expect(p.warnings).toContainEqual({ line: 5, code: 'time_out_of_order' })
    expect(p.dateFrom).toBe('2026-09-01 10:00')
    expect(p.dateTo).toBe('2026-09-02 10:00')
  })

  it('throws ParseError no_messages for unrecognisable text (e.g. other formats)', () => {
    for (const txt of ['', 'hello', '2026-09-01 10:00:00 测试甲\n你好', `测试甲 ${T}\n你好`, `·测试甲\n2026/09/01 10:00\n你好`]) {
      try {
        parseExportText(txt)
        expect.unreachable()
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError)
        expect((e as ParseError).code).toBe('no_messages')
      }
    }
  })

  it('line numbers are 1-based', () => {
    expect(splitMessages(`\n·测试甲\n${T}\n好`).map((m) => m.line)).toEqual([2])
  })

  it('exportedAt from file name is Asia/Shanghai local → UTC', () => {
    expect(exportedAtFromFileName('聊天记录_20260101_120000.zip')).toBe('2026-01-01T04:00:00.000Z')
    expect(exportedAtFromFileName('Chat History_20260101_120000.zip')).toBe('2026-01-01T04:00:00.000Z')
    expect(exportedAtFromFileName('dir/聊天记录_20260101_070000.zip')).toBe('2025-12-31T23:00:00.000Z')
    expect(exportedAtFromFileName('chat.zip')).toBeNull()
    expect(exportedAtFromFileName('聊天记录_20260231_120000.zip')).toBeNull()
    expect(exportedAtFromFileName(undefined)).toBeNull()
    expect(parseExportText(`·a\n${T}\nb`, { fileName: '聊天记录_20260101_120000.zip' }).exportedAt).toBe('2026-01-01T04:00:00.000Z')
  })
})
