import { describe, expect, it } from 'vitest'
import type { ConversationDTO, LoopDTO, RhythmDTO } from '@/contracts'
import { agoLabel, conversationLine, formatDay, openedLabel, pastLabel, planDueLabel, rhythmSentence, sentence } from './format'

const TODAY = '2026-09-16'

const rhythm = (over: Partial<RhythmDTO> = {}): RhythmDTO => ({
  conversationCount: 34,
  conversationCountThisYear: 34,
  lastAt: '2026-09-13 21:40',
  daysSinceLast: 3,
  medianGapDays: 11,
  initiatedByMe: 22,
  initiatedByThem: 12,
  privateOnly: true,
  ...over,
})

describe('rhythmSentence', () => {
  it('is one prose sentence, not a statistic', () => {
    expect(rhythmSentence(rhythm(), TODAY)).toBe('今年聊过 34 次，最近一次 9月13日（3 天前）；大约每 11 天一次；多数是你先开口。')
  })

  it('says nothing about an average under the minimum sample', () => {
    const s = rhythmSentence(rhythm({ conversationCount: 3, conversationCountThisYear: 3, medianGapDays: null, initiatedByMe: 2, initiatedByThem: 1 }), TODAY)
    expect(s).toBe('今年聊过 3 次，最近一次 9月13日（3 天前）。')
    expect(s).not.toMatch(/每/)
  })

  it('leaves out who spoke first when only groups are shared', () => {
    const s = rhythmSentence(rhythm({ initiatedByMe: null, initiatedByThem: null, privateOnly: false }), TODAY)
    expect(s).toBe('今年聊过 34 次，最近一次 9月13日（3 天前）；大约每 11 天一次。')
  })

  it('does not claim a majority when the two sides are even', () => {
    expect(rhythmSentence(rhythm({ initiatedByMe: 17, initiatedByThem: 17 }), TODAY)).toMatch(/你们先开口的次数差不多。$/)
    expect(rhythmSentence(rhythm({ initiatedByMe: 6, initiatedByThem: 28 }), TODAY)).toMatch(/多数是对方先开口。$/)
  })

  it('mentions the year total when this year is only part of it, and drops "今年" when there is none', () => {
    expect(rhythmSentence(rhythm({ conversationCount: 40, conversationCountThisYear: 34 }), TODAY)).toMatch(/^今年聊过 34 次，一共 40 次，/)
    expect(rhythmSentence(rhythm({ conversationCountThisYear: 0, lastAt: '2025-11-02 10:00', daysSinceLast: 318 }), TODAY)).toMatch(/^一共聊过 34 次，最近一次 2025年11月2日（318 天前）/)
  })

  it('is null when there is nothing to describe, so the block disappears', () => {
    expect(rhythmSentence(rhythm({ conversationCount: 0, conversationCountThisYear: 0, lastAt: null, daysSinceLast: null, medianGapDays: null }), TODAY)).toBeNull()
  })

  it('never nags: no "好久没联系", no exclamation, no counter', () => {
    const old = rhythmSentence(rhythm({ daysSinceLast: 400, lastAt: '2025-08-12 10:00', conversationCountThisYear: 0 }), TODAY)!
    expect(old).not.toMatch(/好久|该|记得|提醒|！/)
  })
})

describe('day formatting', () => {
  it('drops the year inside the current year only', () => {
    expect(formatDay('2026-09-13', TODAY)).toBe('9月13日')
    expect(formatDay('2025-12-30', TODAY)).toBe('2025年12月30日')
  })

  it('reads as a distance in days', () => {
    expect(agoLabel(0)).toBe('今天')
    expect(agoLabel(1)).toBe('昨天')
    expect(agoLabel(3)).toBe('3 天前')
  })

  it('adds a terminal period only when the sentence has no punctuation', () => {
    expect(sentence('你答应帮她看简历')).toBe('你答应帮她看简历。')
    expect(sentence('她问你国庆有没有空，你没回。')).toBe('她问你国庆有没有空，你没回。')
  })
})

const conversation = (over: Partial<ConversationDTO> = {}): ConversationDTO => ({
  chatId: 1,
  chatTitle: '林知夏',
  chatKind: 'private',
  startedAt: '2026-09-13 19:02',
  endedAt: '2026-09-13 21:40',
  messageCount: 42,
  segments: [],
  topics: ['搬家', '孩子择校'],
  firstMessageId: 9,
  ...over,
})

describe('conversationLine', () => {
  it('names the chat for groups only', () => {
    expect(conversationLine(conversation(), TODAY)).toEqual({ day: '9月13日', chatTitle: null, count: '42 条', topics: '搬家、孩子择校' })
    expect(conversationLine(conversation({ chatKind: 'group', chatTitle: '同学群' }), TODAY).chatTitle).toBe('同学群')
  })

  it('leaves the topics out when there are none', () => {
    expect(conversationLine(conversation({ topics: [] }), TODAY).topics).toBeNull()
  })
})

const loop = (over: Partial<LoopDTO> = {}): LoopDTO => ({
  id: 1,
  personId: 2,
  direction: 'mine',
  kind: 'promise',
  text: '你答应帮她看简历',
  dueAt: null,
  openedAt: '2026-09-01 10:00',
  openedMessageId: 5,
  closedAt: null,
  closedMessageId: null,
  closedReason: null,
  state: 'open',
  expired: false,
  daysOpen: 15,
  status: 'confirmed',
  importId: 1,
  sourceKind: 'ai',
  evidenceCount: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over,
})

describe('loop labels', () => {
  it('notes when an item was opened', () => {
    expect(openedLabel(loop(), TODAY)).toBe('9月1日起')
  })

  it('counts from the due date when there is one, otherwise from the opening', () => {
    expect(pastLabel(loop({ dueAt: '2026-09-02', kind: 'plan' }), TODAY)).toBe('已过去 14 天')
    expect(pastLabel(loop({ openedAt: '2026-06-18 09:00' }), TODAY)).toBe('已过去 90 天')
  })

  it('shows a plan\'s date instead of its opening day', () => {
    expect(planDueLabel(loop({ kind: 'plan', dueAt: '2026-09-25' }), TODAY)).toBe('9月25日 · 还有 9 天')
    expect(planDueLabel(loop({ kind: 'plan', dueAt: '2026-09-02' }), TODAY)).toBe('9月2日')
    expect(planDueLabel(loop(), TODAY)).toBeNull()
  })
})
