// Lunar ↔ solar helpers (ARCHITECTURE §1.1, DECISIONS A6). Pure; usable on server, CLI and client.
import { Lunar, LunarYear, Solar } from 'lunar-typescript'
import { daysBetween } from './time'

type Day = string // 'YYYY-MM-DD'

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number): Day => `${y}-${pad(m)}-${pad(d)}`

/** Lunar date → solar 'YYYY-MM-DD'; null if it does not exist (e.g. leap month absent, day 30 in a 29-day month). */
export function lunarToSolar(year: number, month: number, day: number, isLeap = false): Day | null {
  try {
    return Lunar.fromYmd(year, isLeap ? -month : month, day).getSolar().toYmd()
  } catch {
    return null
  }
}

/** '农历八月十五' / '农历闰六月初一' */
export function lunarLabel(month: number, day: number, isLeap = false): string {
  // Any year works for the names; 2000 has every regular month.
  const l = Lunar.fromYmd(2000, month, Math.min(day, 29))
  const dayName = day === 30 ? '三十' : l.getDayInChinese()
  return `农历${isLeap ? '闰' : ''}${l.getMonthInChinese()}月${dayName}`
}

function isSolarLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

/**
 * Next occurrence on or after `today`.
 * Solar Feb 29 → Feb 28 in non-leap years. Lunar leap-month dates recur in the leap month only when that lunar year
 * has the same leap month, otherwise in the regular month; day 30 in a 29-day month → 29.
 */
export function nextOccurrence(
  d: { calendar: 'solar' | 'lunar'; month: number; day: number; isLeapMonth?: boolean },
  today: Day,
): { solar: Day; lunarLabel?: string; days: number } {
  const [ty] = today.split('-').map(Number)
  if (d.calendar === 'solar') {
    for (const y of [ty, ty + 1]) {
      const day = d.month === 2 && d.day === 29 && !isSolarLeapYear(y) ? 28 : d.day
      const solar = ymd(y, d.month, day)
      const days = daysBetween(today, solar)
      if (days >= 0) return { solar, days }
    }
  } else {
    const todayLunarYear = Solar.fromYmd(ty, +today.slice(5, 7), +today.slice(8, 10)).getLunar().getYear()
    for (const ly of [todayLunarYear - 1, todayLunarYear, todayLunarYear + 1]) {
      const yearInfo = LunarYear.fromYear(ly)
      const useLeap = Boolean(d.isLeapMonth) && yearInfo.getLeapMonth() === d.month
      const monthInfo = yearInfo.getMonth(useLeap ? -d.month : d.month)
      if (!monthInfo) continue
      const day = Math.min(d.day, monthInfo.getDayCount())
      const solar = lunarToSolar(ly, d.month, day, useLeap)
      if (!solar) continue
      const days = daysBetween(today, solar)
      if (days >= 0) return { solar, days, lunarLabel: lunarLabel(d.month, d.day, Boolean(d.isLeapMonth)) }
    }
  }
  throw new Error('nextOccurrence: no occurrence found')
}
