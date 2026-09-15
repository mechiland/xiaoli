// Pure time helpers (ARCHITECTURE §1.1). No server imports: parser and browser code use this file.

/** 'YYYY-MM-DD HH:MM' */
export type MsgTimeString = string
/** 'YYYY-MM-DD' */
export type DayStr = string

export const DEFAULT_TZ = 'Asia/Shanghai'

export function nowIso(): string {
  return new Date().toISOString()
}

const WECHAT_TIME = /^(\d{4})年(\d{2})月(\d{2})日 (\d{2}):(\d{2})$/

/** 'YYYY年MM月DD日 HH:MM' → 'YYYY-MM-DD HH:MM'. Throws on malformed input. */
export function parseWechatTime(s: string): MsgTimeString {
  const m = WECHAT_TIME.exec(s.trim())
  if (!m) throw new Error(`invalid wechat time: ${s}`)
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`
}

const MSG_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/

function msgTimeToUtcMinutes(t: MsgTimeString): number {
  const m = MSG_TIME.exec(t)
  if (!m) throw new Error(`invalid message time: ${t}`)
  // Wall time treated as UTC purely for arithmetic (no tz in the export).
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60_000
}

/** b - a in minutes (negative when b is earlier). */
export function minutesBetween(a: MsgTimeString, b: MsgTimeString): number {
  return msgTimeToUtcMinutes(b) - msgTimeToUtcMinutes(a)
}

/**
 * full  → '2026年9月15日 14:05'
 * short → '14:05' (time only)
 * date  → '2026年9月15日'
 */
export function formatMsgTime(t: MsgTimeString, style: 'full' | 'short' | 'date'): string {
  const m = MSG_TIME.exec(t)
  if (!m) return t
  const date = `${+m[1]}年${+m[2]}月${+m[3]}日`
  const time = `${m[4]}:${m[5]}`
  if (style === 'short') return time
  if (style === 'date') return date
  return `${date} ${time}`
}

/** Today's calendar date in the given IANA tz (default Asia/Shanghai) as 'YYYY-MM-DD'. */
export function todayInTz(tz: string = DEFAULT_TZ, now: Date = new Date()): DayStr {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** ISO string → 'YYYY年M月D日' in tz (used for "手动添加于…"). */
export function formatIsoDate(iso: string, tz: string = DEFAULT_TZ): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const [y, mo, da] = todayInTz(tz, d).split('-')
  return `${+y}年${+mo}月${+da}日`
}

/** Whole days from day a to day b ('YYYY-MM-DD'). */
export function daysBetween(a: DayStr, b: DayStr): number {
  const pa = a.split('-').map(Number)
  const pb = b.split('-').map(Number)
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86_400_000)
}
