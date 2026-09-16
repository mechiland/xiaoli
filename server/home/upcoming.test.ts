import { describe, expect, it } from 'vitest'
import { lunarToSolar } from '@/lib/lunar'
import { daysBetween } from '@/lib/time'
import { computeUpcoming, dateItemLabel, mergeUpcoming, type UpcomingDateRow, type UpcomingPlanRow } from './upcoming'

const TODAY = '2026-09-15'
let nextId = 1
const row = (p: Partial<UpcomingDateRow>): UpcomingDateRow => ({
  dateId: nextId++,
  personId: 1,
  personLabel: '林知夏',
  kind: 'birthday',
  label: null,
  calendar: 'solar',
  month: 9,
  day: 15,
  isLeapMonth: false,
  ...p,
})

describe('dateItemLabel', () => {
  it('uses the own label first, then the kind in Chinese', () => {
    expect(dateItemLabel('memorial', '外婆的忌日')).toBe('外婆的忌日')
    expect(dateItemLabel('birthday', null)).toBe('生日')
    expect(dateItemLabel('anniversary', '  ')).toBe('纪念日')
    expect(dateItemLabel('other', null)).toBe('重要日子')
    expect(dateItemLabel('something-new', null)).toBe('重要日子')
  })
})

describe('computeUpcoming', () => {
  it('includes today (0) through day 30, excludes day 31', () => {
    const out = computeUpcoming(
      [row({ month: 9, day: 15 }), row({ month: 10, day: 15, personLabel: '邓一帆' }), row({ month: 10, day: 16, personLabel: '许嘉禾' })],
      TODAY,
    )
    expect(out.map((u) => [u.person.label, u.days])).toEqual([
      ['林知夏', 0],
      ['邓一帆', 30],
    ])
    expect(out[0]).toMatchObject({ solar: '2026-09-15', lunarLabel: null, label: '生日', kind: 'date', loopId: null })
  })

  it('converts lunar dates to the solar day and keeps the lunar label', () => {
    // lunar 8/15 of the lunar year containing today
    const solar = lunarToSolar(2026, 8, 15)!
    const out = computeUpcoming([row({ calendar: 'lunar', month: 8, day: 15 })], TODAY)
    const days = daysBetween(TODAY, solar)
    if (days >= 0 && days <= 30) {
      expect(out).toHaveLength(1)
      expect(out[0]).toMatchObject({ solar, days, lunarLabel: '农历八月十五' })
    } else {
      expect(out).toHaveLength(0)
    }
  })

  it('wraps to next year for dates already past', () => {
    const out = computeUpcoming([row({ month: 9, day: 1 })], '2026-12-20', 400)
    expect(out[0].solar).toBe('2027-09-01')
  })

  it('skips incomplete and impossible dates', () => {
    expect(computeUpcoming([row({ month: null }), row({ day: null }), row({ month: 13 }), row({ day: 0 })], TODAY)).toEqual([])
  })

  it('sorts by days, then label', () => {
    const out = computeUpcoming(
      [row({ month: 9, day: 20, personLabel: '周' }), row({ month: 9, day: 16, personLabel: '王' }), row({ month: 9, day: 16, personLabel: '艾' })],
      TODAY,
    )
    expect(out.map((u) => u.person.label)).toEqual(['艾', '王', '周'])
  })
})

describe('mergeUpcoming', () => {
  const plan = (p: Partial<UpcomingPlanRow>): UpcomingPlanRow => ({
    person: { id: 7, label: '许嘉禾' },
    loopId: 11,
    label: '说好一起去看展',
    solar: '2026-09-20',
    days: 5,
    ...p,
  })

  it('mixes 约定 into the dates as one list sorted by solar day', () => {
    const dates = computeUpcoming([row({ month: 9, day: 18 }), row({ month: 10, day: 5, personLabel: '邓一帆' })], TODAY)
    const out = mergeUpcoming(dates, [plan({ solar: '2026-09-20', days: 5 }), plan({ loopId: 12, solar: '2026-09-16', days: 1, label: '答应给她带茶叶' })])
    expect(out.map((u) => [u.kind, u.solar])).toEqual([
      ['plan', '2026-09-16'],
      ['date', '2026-09-18'],
      ['plan', '2026-09-20'],
      ['date', '2026-10-05'],
    ])
  })

  it('a 约定 row carries loopId and no dateId, and never a lunar label', () => {
    const [u] = mergeUpcoming([], [plan({})])
    expect(u).toEqual({ person: { id: 7, label: '许嘉禾' }, kind: 'plan', dateId: null, loopId: 11, label: '说好一起去看展', solar: '2026-09-20', lunarLabel: null, days: 5 })
  })

  it('drops 约定 outside the 30-day window (overdue ones belong to the person page, SPEC §9.3)', () => {
    expect(mergeUpcoming([], [plan({ days: -3 }), plan({ days: 31 })])).toEqual([])
    expect(mergeUpcoming([], [plan({ days: 30 })])).toHaveLength(1)
  })

  it('keeps the date rows when there are no 约定 at all', () => {
    const dates = computeUpcoming([row({ month: 9, day: 18 })], TODAY)
    expect(mergeUpcoming(dates, [])).toEqual(dates)
  })
})
