/**
 * Loop state derivation (SPEC §7 交互层). Pure, wave-1 shared — this is the ONE definition.
 *
 * It lives here rather than in `server/interaction` because `server/review` needs the same rule for the LoopDTOs in
 * `GET /api/imports/:id/review` and cannot import a later module. Two copies is not a style problem: the import
 * result page and the person page would disagree about whether the same row is 已过期, and they briefly did —
 * review had `> 14`, interaction `>= 14` (core-requests interaction#5, review#... / DECISIONS I9-adjacent).
 * Anything that derives a loop's state, its expiry or its due day imports from here.
 */
import { LOOP_EXPIRY_DAYS_NO_DUE, LOOP_EXPIRY_DAYS_WITH_DUE, type LoopCloseReason, type LoopState } from '@/contracts'
import { daysBetween, todayInTz, type DayStr } from '@/lib/time'

export interface LoopLike {
  dueAt: string | null
  openedAt: string
  closedMessageId: number | null
  closedReason: LoopCloseReason | null
  closedAt?: string | null
}

export interface LoopDerived {
  state: LoopState
  expired: boolean
  daysOpen: number
}

/** MsgTime ('YYYY-MM-DD HH:MM') or ISO ('YYYY-MM-DDT…') → the day part. */
export const dayOf = (t: string): DayStr => t.slice(0, 10)

/**
 * A PartialDate due date means the **last** day it can stand for (`2026-09` → `2026-09-30`, `2026` → `2026-12-31`),
 * so a plan is never called expired before the period it names is over.
 */
export function dueDay(dueAt: string): DayStr {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) return dueAt
  if (/^\d{4}-\d{2}$/.test(dueAt)) {
    const [y, m] = dueAt.split('-').map(Number)
    return `${dueAt}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
  }
  if (/^\d{4}$/.test(dueAt)) return `${dueAt}-12-31`
  return dueAt
}

/** First day a PartialDate covers: '2026' → 2026-01-01, '2026-09' → 2026-09-01. */
export function dueDayStart(p: string): DayStr {
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p
  if (/^\d{4}-\d{2}$/.test(p)) return `${p}-01`
  if (/^\d{4}$/.test(p)) return `${p}-01-01`
  return p
}

/**
 * open / done / dropped from the close event, never from a column. A loop closed by a message has
 * `closedMessageId`; one closed by hand has only `closedReason` + `closedAt`. Because the state follows message
 * time rather than import order, reverse-order imports, re-imports and import deletion all land on the right answer.
 *
 * `expired` applies only to an open loop, and is read-time only: MORE than LOOP_EXPIRY_DAYS_WITH_DUE days past the
 * due date, or more than LOOP_EXPIRY_DAYS_NO_DUE days after opening when there is none — the threshold day itself is
 * not yet expired ("过期 14 天后"). An expired loop is still open: one shade dimmer, never moved, never a warning
 * colour (SPEC §9.5).
 */
export function deriveLoop(loop: LoopLike, today: DayStr = todayInTz()): LoopDerived {
  const closed = loop.closedMessageId != null || loop.closedReason != null
  const state: LoopState = closed ? (loop.closedReason ?? 'done') : 'open'
  const openedDay = dayOf(loop.openedAt)
  const end = closed && loop.closedAt ? dayOf(loop.closedAt) : today
  const daysOpen = Math.max(0, daysBetween(openedDay, end))
  const expired =
    state !== 'open'
      ? false
      : loop.dueAt != null
        ? daysBetween(dueDay(loop.dueAt), today) > LOOP_EXPIRY_DAYS_WITH_DUE
        : daysBetween(openedDay, today) > LOOP_EXPIRY_DAYS_NO_DUE
  return { state, expired, daysOpen }
}

/** Days since the item fell due (its due date, or the day it was opened) — the "已过去 N 天" of SPEC §9.5. */
export function daysPastDue(loop: LoopLike, today: DayStr): number {
  return Math.max(0, daysBetween(loop.dueAt ? dueDay(loop.dueAt) : dayOf(loop.openedAt), today))
}
