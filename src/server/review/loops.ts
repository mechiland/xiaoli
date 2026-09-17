/**
 * Loop DTO helpers for review (SPEC §7 交互层). The derivation itself now lives in `@/lib/loop-state` — one
 * definition shared with interaction, so the import result page and the person page can never disagree about
 * whether a row is 已过期 (core-request interaction#5, resolved by the integrator).
 */
export { dayOf, daysPastDue, deriveLoop, dueDay, type LoopDerived } from '@/lib/loop-state'
import type { loops } from '@/server/db'

export type LoopRow = typeof loops.$inferSelect
