// Loop state derivation (SPEC §7 交互层). The rule lives in `@/lib/loop-state` — shared with review so the two
// pages can never disagree at the expiry boundary (core-request interaction#5, resolved by the integrator).
import { daysPastDue as sharedDaysPastDue, deriveLoop, dueDay, dueDayStart } from '@/lib/loop-state'
import type { LoopDerived, LoopLike } from './types'

/** Last day covered by a PartialDate: '2026' → 2026-12-31, '2026-09' → 2026-09-30. */
export const partialDateEnd = dueDay
/** First day covered by a PartialDate: '2026' → 2026-01-01, '2026-09' → 2026-09-01. */
export const partialDateStart = dueDayStart

/** `today` is a 'YYYY-MM-DD' day in APP_TZ. */
export function loopState(loop: LoopLike, today: string): LoopDerived {
  return deriveLoop(loop, today)
}

/** Days since the item fell due (its due date, or the day it was opened) — the "已过去 N 天" of SPEC §9.5. */
export function daysPastDue(loop: LoopLike, today: string): number {
  return sharedDaysPastDue(loop, today)
}
