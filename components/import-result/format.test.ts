import { describe, expect, it } from 'vitest'
import type { ClaimDTO, ImportReviewResponse, ReviewItem } from '@/contracts'
import {
  applyItemUpdate,
  applyStatus,
  byCategory,
  deriveReview,
  emptyResultKind,
  formatDateRange,
  formatImportantDate,
  formatPartialDate,
  isLabelEcho,
  isWrappablePiece,
  lunarDayName,
  messagesReadBefore,
  peopleLine,
  personContext,
  personContextParts,
  personContextShort,
  personLabel,
  markIndexes,
  readingProgress,
  relationText,
  relationWord,
  renamePerson,
} from './format'
import type { ProfileResponse } from '@/contracts'

const claim = (id: number, over: Partial<ClaimDTO> = {}): ClaimDTO => ({
  id,
  personId: 1,
  statement: `说法 ${id}`,
  category: 'work',
  validFrom: null,
  validTo: null,
  learnedAt: '2026-09-15T00:00:00.000Z',
  confidence: 0.9,
  sensitive: false,
  status: 'proposed',
  supersedesClaimId: null,
  supersededByClaimId: null,
  importId: 7,
  sourceKind: 'ai',
  mentions: [],
  evidenceCount: 1,
  createdAt: '2026-09-15T00:00:00.000Z',
  statusChangedAt: '2026-09-15T00:00:00.000Z',
  statusReason: null,
  ...over,
})

function review(): ImportReviewResponse {
  const old = claim(10, { status: 'confirmed', importId: 3, statement: '住在郑州', category: 'location' })
  const change: ReviewItem = { type: 'claim', item: claim(12, { supersedesClaimId: 10, statement: '住在广州', category: 'location' }), replaces: old }
  return {
    import: {} as ImportReviewResponse['import'],
    chat: null,
    progress: { total: 2, done: 2, failed: 0, pending: 0, running: 0 },
    sections: [
      {
        person: { id: 1, label: '贺知遥', isNew: true },
        newCount: 3,
        newClaims: [
          { type: 'claim', item: claim(11, { category: 'location' }), replaces: null },
          { type: 'claim', item: claim(13, { category: 'location' }), replaces: null },
          { type: 'claim', item: claim(14, { category: 'other', sensitive: true }), replaces: null },
        ],
        changes: [change],
        aliasesAndRelations: [
          {
            type: 'relation',
            item: {
              id: 5,
              fromPersonId: 2,
              toPersonId: 1,
              from: { id: 2, label: '闫小满' },
              to: { id: 1, label: '贺知遥' },
              type: 'relative',
              label: '表妹',
              status: 'proposed',
              importId: 7,
              sourceKind: 'ai',
              evidenceCount: 1,
              createdAt: '2026-09-15T00:00:00.000Z',
            },
          },
        ],
        dates: [],
        events: [],
      },
    ],
    highConfidence: [
      { type: 'claim', id: 11 },
      { type: 'claim', id: 12 },
    ],
    highConfidenceCount: 2,
    allHandled: false,
    empty: false,
  }
}

describe('text', () => {
  it('formats date ranges', () => {
    expect(formatDateRange('2026-09-03 08:03', '2026-09-11 23:26')).toBe('2026年9月3日 – 9月11日')
    expect(formatDateRange('2025-12-30 08:03', '2026-01-02 23:26')).toBe('2025年12月30日 – 2026年1月2日')
    expect(formatDateRange('2026-09-03 08:03', '2026-09-03 23:26')).toBe('2026年9月3日')
    expect(formatDateRange(null, null)).toBe('')
  })
  it('formats partial and important dates', () => {
    expect(formatPartialDate('2026-09')).toBe('2026年9月')
    expect(formatPartialDate('2026')).toBe('2026年')
    expect(formatImportantDate({ calendar: 'solar', isLeapMonth: false, year: null, month: 12, day: 3 })).toBe('12月3日')
    expect(formatImportantDate({ calendar: 'lunar', isLeapMonth: false, year: null, month: 12, day: 8 })).toBe('农历腊月初八')
    expect(formatImportantDate({ calendar: 'lunar', isLeapMonth: true, year: null, month: 4, day: 15 })).toBe('农历闰四月十五')
    expect([1, 10, 11, 20, 21, 30].map(lunarDayName)).toEqual(['初一', '初十', '十一', '二十', '廿一', '三十'])
  })
  it('names relations by label, then type', () => {
    expect(relationWord({ type: 'relative', label: '表妹' })).toBe('表妹')
    expect(relationWord({ type: 'colleague', label: null })).toBe('同事')
  })
  it('the own person of the user reads as 我 (like the person page), everyone else by label', () => {
    const me = { id: 1, label: '小满' }
    const other = { id: 2, label: '林知夏' }
    expect(personLabel(me, 1)).toBe('我')
    expect(personLabel(other, 1)).toBe('林知夏')
    expect(personLabel(me, null)).toBe('小满')
    expect(relationText({ from: me, to: other, type: 'parent', label: '爸爸' }, 1)).toBe('我是林知夏的爸爸')
    expect(relationText({ from: other, to: me, type: 'service_provider', label: '柜子定制商家' }, 1)).toBe('林知夏是我的柜子定制商家')
    expect(relationText({ from: other, to: me, type: 'friend', label: null }, null)).toBe('林知夏是小满的朋友')
  })
  it('people line: self as 我, capped with a remainder count', () => {
    const ps = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, label: `人物${i + 1}` }))
    const line = peopleLine(ps, 3)
    expect(line.shown.map((p) => p.label)).toEqual(['人物1', '人物2', '我', '人物4', '人物5', '人物6', '人物7', '人物8'])
    expect(line.more).toBe(2)
    expect(peopleLine(ps.slice(0, 2), null)).toEqual({ shown: ps.slice(0, 2), more: 0 })
  })
  it('reading progress counts the window being read', () => {
    expect(readingProgress({ total: 8, done: 2, failed: 0, pending: 6, running: 0 })).toEqual({ current: 3, total: 8, ratio: 0.25 })
    expect(readingProgress({ total: 8, done: 7, failed: 1, pending: 0, running: 0 }).current).toBe(8)
    expect(readingProgress({ total: 0, done: 0, failed: 0, pending: 0, running: 0 }).ratio).toBe(0)
  })
})

describe('review data', () => {
  it('groups claims by category in arrival order', () => {
    const groups = byCategory(review().sections[0].newClaims)
    expect(groups.map((g) => [g.category, g.items.length])).toEqual([
      ['location', 2],
      ['other', 1],
    ])
  })
  it('derives flags from current statuses', () => {
    const r = review()
    expect(deriveReview(r).highConfidence.map((h) => h.id)).toEqual([11, 12])
    const accepted = applyStatus(r, new Set(['claim:11', 'claim:12', 'claim:13', 'claim:14', 'relation:5']), 'confirmed')
    const d = deriveReview(accepted)
    expect(d.allHandled).toBe(true)
    expect(d.highConfidence).toEqual([])
    // accepting a change supersedes the old statement
    expect((accepted.sections[0].changes[0] as Extract<ReviewItem, { type: 'claim' }>).replaces?.status).toBe('superseded')
  })
  it('applies a server item and superseded claims in place', () => {
    const r = review()
    const edited = claim(12, { status: 'confirmed', statement: '住在广州天河', supersedesClaimId: 10 })
    const oldSup = claim(10, { status: 'superseded', statement: '住在郑州', importId: 3 })
    const next = applyItemUpdate(r, 'claim', edited, [oldSup])
    const change = next.sections[0].changes[0] as Extract<ReviewItem, { type: 'claim' }>
    expect(change.item.statement).toBe('住在广州天河')
    expect(change.replaces?.status).toBe('superseded')
    expect(r.sections[0].changes[0].item.status).toBe('proposed') // input untouched
  })
  it('renames a person in the section and in relation endpoints', () => {
    const next = renamePerson(review(), 1, '贺遥')
    expect(next.sections[0].person.label).toBe('贺遥')
    const rel = next.sections[0].aliasesAndRelations[0] as Extract<ReviewItem, { type: 'relation' }>
    expect(rel.item.to.label).toBe('贺遥')
  })
  it('numbers marks in render order, old statement before the new one', () => {
    const m = markIndexes(review())
    expect(m.get('1:claim:11')).toBe(1)
    expect(m.get('1:claim:14')).toBe(3)
    expect(m.get('old:1:10')).toBe(4)
    expect(m.get('1:claim:12')).toBe(5)
    expect(m.get('1:relation:5')).toBe(6)
  })
})

describe('isLabelEcho', () => {
  it('matches the label ignoring spaces, width and case', () => {
    expect(isLabelEcho('王小明', '王小明')).toBe(true)
    expect(isLabelEcho(' 王 小明 ', '王小明')).toBe(true)
    expect(isLabelEcho('Ｗang', 'wang')).toBe(true)
    expect(isLabelEcho('小明', '王小明')).toBe(false)
    expect(isLabelEcho('', '')).toBe(false)
  })
})

describe('personContext', () => {
  const handle = (id: number, value: string, status: 'confirmed' | 'proposed' | 'rejected' = 'confirmed') => ({
    id, personId: 3, kind: 'display_group' as const, value, chatId: 1, chatTitle: '装修群', status, importId: 1, sourceKind: 'ai' as const, evidenceCount: 1, createdAt: '2026-09-03T02:00:00.000Z',
  })
  const profile = (over: { chats?: string[]; handles?: ReturnType<typeof handle>[]; claims?: ClaimDTO[]; createdAt?: string } = {}): ProfileResponse =>
    ({
      person: { id: 3, label: '王小明', isSelf: false, mergedIntoId: null, pinned: false, avatarUrl: null, lastMessageAt: null, createdAt: over.createdAt ?? '2026-09-03T02:00:00.000Z', updatedAt: '2026-09-03T02:00:00.000Z' },
      aliases: over.handles ? [{ kind: 'display_group', items: over.handles }] : [],
      infobox: {
        relationToMe: null, city: null, work: null, school: null, birthday: null, otherDates: [], lastContactAt: null,
        chats: (over.chats ?? []).map((title, i) => ({ chat: { id: i + 1, title, kind: 'group' as const }, messageCount: 3, lastMessageAt: null })),
      },
      sections: over.claims ? [{ category: 'work', claims: over.claims }] : [],
      relations: [],
      events: [],
      history: [],
    }) as ProfileResponse

  it('a person made by hand reads as empty, with its creation date', () => {
    expect(personContext(profile())).toBe('没有聊天记录 · 还没有信息 · 2026年9月3日建立')
  })
  it('chats, aliases (without the label and rejected ones), claims', () => {
    const p = profile({
      chats: ['装修群', '小区群'],
      handles: [handle(1, '王小明'), handle(2, '小明'), handle(3, '小明 '), handle(4, '明哥', 'proposed'), handle(5, '老王', 'rejected')],
      claims: [claim(1, { status: 'confirmed' }), claim(2), claim(3, { status: 'rejected' })],
    })
    expect(personContext(p)).toBe('『装修群』等 2 个聊天 · 2 个别名 · 2 条信息 · 2026年9月3日建立')
  })
  it('one chat, no claims', () => {
    expect(personContext(profile({ chats: ['装修群'] }))).toBe('『装修群』 · 2026年9月3日建立')
  })
  it('parts: one piece per fact; only chat names may wrap, the date never does', () => {
    const parts = personContextParts(profile({ chats: ['装修群', '小区群'], handles: [handle(2, '小明')], createdAt: '2026-09-15T17:25:14.884Z' }), 'Asia/Shanghai')
    expect(parts).toEqual(['『装修群』等 2 个聊天', '1 个别名', '2026年9月16日建立'])
    expect(parts.map(isWrappablePiece)).toEqual([true, false, false])
    expect(personContextParts(profile(), 'Asia/Shanghai')).toEqual(['没有聊天记录', '还没有信息', '2026年9月3日建立'])
    expect(personContextParts(profile()).some(isWrappablePiece)).toBe(false)
  })
  it('short: fits a picker row', () => {
    expect(personContextShort(profile())).toBe('没有聊天记录 · 2026年9月3日建立')
    expect(personContextShort(profile({ chats: ['一个名字特别特别长的业主群'] }))).toBe('『一个名字特别特别…』')
    const p = profile({ chats: ['装修群', '小区群'], handles: [handle(2, '小明')], claims: [claim(1)] })
    expect(personContextShort(p)).toBe('2 个聊天 · 1 个别名 · 1 条信息')
  })
  it('creation date is the local day in APP_TZ, not the UTC date (17:25Z is already the next day in Shanghai)', () => {
    const late = profile({ createdAt: '2026-09-15T17:25:14.884Z' })
    expect(personContextShort(late)).toBe('没有聊天记录 · 2026年9月16日建立')
    expect(personContextShort(late, 'Asia/Shanghai')).toBe('没有聊天记录 · 2026年9月16日建立')
    expect(personContext(late, 'Asia/Shanghai')).toBe('没有聊天记录 · 还没有信息 · 2026年9月16日建立')
    expect(personContext(late, 'UTC')).toBe('没有聊天记录 · 还没有信息 · 2026年9月15日建立')
    // early morning local time is still the previous UTC day
    expect(personContextShort(profile({ createdAt: '2026-09-15T16:00:00.000Z' }), 'Asia/Shanghai')).toBe('没有聊天记录 · 2026年9月16日建立')
    expect(personContextShort(profile({ createdAt: '2026-09-15T15:59:59.000Z' }), 'Asia/Shanghai')).toBe('没有聊天记录 · 2026年9月15日建立')
  })
})

describe('emptyResultKind', () => {
  const prog = (total: number, done = total) => ({ total, done, failed: 0, pending: total - done, running: 0 })
  it('nothing was read: no windows at mapping (every message already stored)', () => {
    expect(emptyResultKind({ newMessageCount: 0 }, prog(0))).toBe('nothing-new')
  })
  it('no windows but messages counted: they were handed over from the deleted earlier import (read there, not here)', () => {
    expect(emptyResultKind({ newMessageCount: 36 }, prog(0))).toBe('read-before')
  })
  it('header drops 新增 only for a finished import in that state', () => {
    expect(messagesReadBefore({ newMessageCount: 36, status: 'done' }, prog(0))).toBe(true)
    expect(messagesReadBefore({ newMessageCount: 36, status: 'reviewing' }, prog(0))).toBe(true)
    expect(messagesReadBefore({ newMessageCount: 0, status: 'done' }, prog(0))).toBe(false)
    expect(messagesReadBefore({ newMessageCount: 36, status: 'done' }, prog(3))).toBe(false)
    expect(messagesReadBefore({ newMessageCount: 36, status: 'extracting' }, prog(0))).toBe(false)
    expect(messagesReadBefore({ newMessageCount: 36, status: 'done' }, undefined)).toBe(false)
    expect(messagesReadBefore(undefined, prog(0))).toBe(false)
  })
  it('no progress known yet: falls back to newMessageCount', () => {
    expect(emptyResultKind({ newMessageCount: 0 }, undefined)).toBe('nothing-new')
    expect(emptyResultKind({ newMessageCount: 12 }, undefined)).toBe('no-output')
  })
  it('an extraction that ran and found nothing keeps the SPEC §9.9 copy', () => {
    expect(emptyResultKind({ newMessageCount: 120 }, prog(3))).toBe('no-output')
    expect(emptyResultKind({ newMessageCount: 120 }, { total: 3, done: 1, failed: 2, pending: 0, running: 0 })).toBe('no-output')
  })
})
