import { describe, expect, it } from 'vitest'
import type { ClaimDTO, ImportReviewResponse, ReviewItem } from '@/contracts'
import {
  applyItemUpdate,
  applyStatus,
  byCategory,
  deriveReview,
  formatDateRange,
  formatImportantDate,
  formatPartialDate,
  lunarDayName,
  markIndexes,
  readingProgress,
  relationWord,
  renamePerson,
} from './format'

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
