import { describe, expect, it } from 'vitest'
import { lunarLabel, lunarToSolar, nextOccurrence } from './lunar'
import { anchorId, chatHref, importHref, personHref } from './links'
import { indexLetter, initials, sortKey } from './pinyin'
import { daysBetween, formatMsgTime, minutesBetween, parseWechatTime, todayInTz } from './time'
import { parseServerEnv } from '@/server/env'

describe('lib/time', () => {
  it('parses and formats message time', () => {
    expect(parseWechatTime('2026年09月05日 08:03')).toBe('2026-09-05 08:03')
    expect(() => parseWechatTime('2026-09-05 08:03')).toThrow()
    expect(minutesBetween('2026-09-05 23:30', '2026-09-06 02:31')).toBe(181)
    expect(formatMsgTime('2026-09-05 08:03', 'full')).toBe('2026年9月5日 08:03')
    expect(formatMsgTime('2026-09-05 08:03', 'short')).toBe('08:03')
    expect(formatMsgTime('2026-09-05 08:03', 'date')).toBe('2026年9月5日')
    expect(todayInTz('Asia/Shanghai', new Date('2026-09-15T17:30:00Z'))).toBe('2026-09-16')
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3)
  })
})

describe('lib/links', () => {
  it('builds in-app URLs and anchors', () => {
    expect(personHref(12)).toBe('/p/12')
    expect(personHref(12, { type: 'claim', id: 345 })).toBe('/p/12#claim-345')
    expect(anchorId('handle', 21)).toBe('handle-21')
    expect(chatHref(4)).toBe('/chats/4')
    expect(chatHref(4, 987)).toBe('/chats/4?at=987')
    expect(importHref(3)).toBe('/imports/3')
  })
})

describe('lib/pinyin', () => {
  it('groups by initial with surname readings, Latin letters and #', () => {
    expect(indexLetter('曾小丽')).toBe('Z')
    expect(indexLetter('单田')).toBe('S')
    expect(indexLetter('王五')).toBe('W')
    expect(indexLetter('amy')).toBe('A')
    expect(indexLetter('🙂朋友')).toBe('#')
    expect(indexLetter('3号')).toBe('#')
    expect(indexLetter('')).toBe('#')
    expect(sortKey('吕布')).toBe('lv bu')
    expect(initials('王小丽')).toBe('wxl')
  })
})

describe('lib/lunar', () => {
  it('converts lunar dates and handles leap months / short months', () => {
    expect(lunarToSolar(2026, 8, 15)).toBe('2026-09-25')
    expect(lunarToSolar(2025, 6, 1, true)).toBe('2025-07-25')
    expect(lunarToSolar(2026, 2, 30)).toBeNull()
    expect(lunarLabel(8, 15)).toBe('农历八月十五')
  })
  it('computes the next occurrence', () => {
    expect(nextOccurrence({ calendar: 'solar', month: 9, day: 20 }, '2026-09-15')).toEqual({ solar: '2026-09-20', days: 5 })
    expect(nextOccurrence({ calendar: 'solar', month: 9, day: 1 }, '2026-09-15').solar).toBe('2027-09-01')
    expect(nextOccurrence({ calendar: 'solar', month: 2, day: 29 }, '2026-09-15').solar).toBe('2027-02-28')
    const mid = nextOccurrence({ calendar: 'lunar', month: 8, day: 15 }, '2026-09-15')
    expect(mid).toEqual({ solar: '2026-09-25', days: 10, lunarLabel: '农历八月十五' })
    // leap 6th month: 2026 has no leap 6th → regular 6th month of the next lunar year occurrence
    const leap = nextOccurrence({ calendar: 'lunar', month: 6, day: 1, isLeapMonth: true }, '2026-09-15')
    expect(leap.days).toBeGreaterThan(0)
    expect(leap.lunarLabel).toBe('农历闰六月初一')
  })
})

describe('server/env', () => {
  it('validates EXTRACT_MODEL and names the variable, never the value', () => {
    expect(parseServerEnv({ EXTRACT_MODEL: 'deepseek-flash', DEEPSEEK_API_KEY: '' }).EXTRACT_MODEL).toBe('deepseek-flash')
    expect(parseServerEnv({}).EXTRACT_MODEL).toBeUndefined()
    try {
      parseServerEnv({ EXTRACT_MODEL: 'secret-looking-value' })
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).toContain('EXTRACT_MODEL')
      expect((e as Error).message).not.toContain('secret-looking-value')
    }
  })
})
