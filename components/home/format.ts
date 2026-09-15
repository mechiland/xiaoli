// Pure display helpers for the home page. No server imports.
import { DEFAULT_TZ } from '@/lib/time'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const DAY = /^(\d{4})-(\d{2})-(\d{2})/

function parts(day: string): [number, number, number] | null {
  const m = DAY.exec(day)
  return m ? [+m[1], +m[2], +m[3]] : null
}

export function weekday(day: string): string {
  const p = parts(day)
  if (!p) return ''
  return WEEKDAYS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()]
}

/** '9月27日'; with the year when it is not the year of `today` ('2027年1月3日'). */
export function formatDay(day: string, today: string): string {
  const p = parts(day)
  const t = parts(today)
  if (!p) return day
  return t && t[0] === p[0] ? `${p[1]}月${p[2]}日` : `${p[0]}年${p[1]}月${p[2]}日`
}

/** '今天' | '明天' | '后天' | '还有 12 天' */
export function daysLabel(days: number): string {
  if (days <= 0) return '今天'
  if (days === 1) return '明天'
  if (days === 2) return '后天'
  return `还有 ${days} 天`
}

/** Message time range 'YYYY-MM-DD HH:MM' → '2026年3月2日 – 9月10日'; null when unknown. */
export function formatRange(from: string | null, to: string | null): string | null {
  const a = from ? parts(from) : null
  const b = to ? parts(to) : null
  if (!a && !b) return null
  const full = (p: [number, number, number]) => `${p[0]}年${p[1]}月${p[2]}日`
  if (!a || !b) return full((a ?? b)!)
  if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) return full(a)
  if (a[0] === b[0]) return `${full(a)} – ${b[1]}月${b[2]}日`
  return `${full(a)} – ${full(b)}`
}

/** Import time (ISO) in tz: '9月15日 14:05 导入'; with the year when not the current year of `today`. */
export function formatImportedAt(iso: string, today: string, tz: string = DEFAULT_TZ): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const get = (type: string) => f.formatToParts(d).find((p) => p.type === type)?.value ?? ''
  const day = `${get('year')}-${get('month')}-${get('day')}`
  return `${formatDay(day, today)} ${get('hour')}:${get('minute')} 导入`
}

/** Onboarding input → display names: split on 、，, and newlines, trimmed, de-duplicated, empty parts dropped. */
export function splitNames(input: string): string[] {
  return [...new Set(input.split(/[、，,;；\n]/).map((s) => s.trim()).filter(Boolean))]
}

/** '9月15日 星期二' for the line above the search box. */
export function formatTodayLine(today: string): string {
  const p = parts(today)
  if (!p) return ''
  return `${p[1]}月${p[2]}日 ${weekday(today).replace('周', '星期')}`
}
