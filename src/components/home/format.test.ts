import { describe, expect, it } from 'vitest'
import { daysLabel, formatDay, formatImportedAt, formatRange, formatTodayLine, splitNames, weekday } from './format'

describe('home format', () => {
  it('splitNames', () => {
    expect(splitNames('  小丽、 丽丽,小丽，Lily \n')).toEqual(['小丽', '丽丽', 'Lily'])
    expect(splitNames('   ')).toEqual([])
  })
  it('formatDay drops the year only within the current year', () => {
    expect(formatDay('2026-09-27', '2026-09-15')).toBe('9月27日')
    expect(formatDay('2027-01-03', '2026-12-20')).toBe('2027年1月3日')
  })
  it('weekday', () => {
    expect(weekday('2026-09-15')).toBe('周二')
    expect(formatTodayLine('2026-09-15')).toBe('9月15日 星期二')
  })
  it('daysLabel', () => {
    expect([0, 1, 2, 12].map(daysLabel)).toEqual(['今天', '明天', '后天', '还有 12 天'])
  })
  it('formatRange', () => {
    expect(formatRange(null, null)).toBeNull()
    expect(formatRange('2026-03-02 10:00', '2026-03-02 18:00')).toBe('2026年3月2日')
    expect(formatRange('2026-03-02 10:00', '2026-09-10 18:00')).toBe('2026年3月2日 – 9月10日')
    expect(formatRange('2025-12-30 10:00', '2026-01-02 18:00')).toBe('2025年12月30日 – 2026年1月2日')
    expect(formatRange(null, '2026-01-02 18:00')).toBe('2026年1月2日')
  })
  it('formatImportedAt uses the app time zone', () => {
    expect(formatImportedAt('2026-09-15T06:05:00.000Z', '2026-09-15', 'Asia/Shanghai')).toBe('9月15日 14:05 导入')
    expect(formatImportedAt('2025-12-31T17:30:00.000Z', '2026-09-15', 'Asia/Shanghai')).toBe('1月1日 01:30 导入')
    expect(formatImportedAt('2025-12-31T15:30:00.000Z', '2026-09-15', 'Asia/Shanghai')).toBe('2025年12月31日 23:30 导入')
  })
})
