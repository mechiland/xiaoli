import { describe, expect, it } from 'vitest'
import { lunarToSolar } from '@/lib/lunar'
import { daysBetween } from '@/lib/time'
import { computeUpcoming, dateItemLabel, type UpcomingDateRow } from './upcoming'

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
    expect(out[0]).toMatchObject({ solar: '2026-09-15', lunarLabel: null, label: '生日' })
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
