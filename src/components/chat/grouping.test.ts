import { describe, expect, it } from 'vitest'
import type { MessageDTO } from '@/contracts'
import { formatDay, groupTranscript } from './grouping'

let id = 1
const m = (sentAt: string, senderName: string, senderPersonId: number | null = null): MessageDTO => ({
  id: id++,
  chatId: 1,
  seq: id * 1024,
  sentAt,
  kind: 'text',
  body: 'x',
  meta: null,
  senderHandleId: null,
  senderName,
  senderPersonId,
  senderLabel: null,
  attachments: [],
})

describe('groupTranscript', () => {
  it('merges consecutive messages of one sender, breaks on sender, day and a 30-minute gap', () => {
    const days = groupTranscript([
      m('2026-04-12 09:00', 'A', 1),
      m('2026-04-12 09:01', 'A 另一个名字', 1), // same person, other display name → same run
      m('2026-04-12 09:31', 'A', 1), // exactly 30 min after → still merged
      m('2026-04-12 10:05', 'A', 1), // 34 min gap → new run
      m('2026-04-12 10:06', 'B'),
      m('2026-04-12 10:07', 'B'),
      m('2026-04-12 10:08', 'C'), // unlinked senders compare by name
      m('2026-04-13 00:01', 'C'), // new day → new group and run
    ])
    expect(days.map((d) => d.day)).toEqual(['2026-04-12', '2026-04-13'])
    expect(days[0].runs.map((r) => r.messages.length)).toEqual([3, 1, 2, 1])
    expect(days[1].runs.map((r) => r.messages.length)).toEqual([1])
  })

  it('empty input', () => {
    expect(groupTranscript([])).toEqual([])
  })
})

describe('formatDay', () => {
  it('adds the weekday', () => {
    expect(formatDay('2026-04-12')).toBe('2026年4月12日 星期日')
    expect(formatDay('2026-09-15')).toBe('2026年9月15日 星期二')
  })
})

describe('groupTranscript: system lines', () => {
  it('a system line is its own run and the same sender after it starts a new run', () => {
    const sys = { ...m('2026-04-13 09:01', 'A', 1), kind: 'system' as const }
    const days = groupTranscript([m('2026-04-13 09:00', 'A', 1), sys, m('2026-04-13 09:02', 'A', 1)])
    expect(days[0].runs.map((r) => r.messages.length)).toEqual([1, 1, 1])
  })
})
