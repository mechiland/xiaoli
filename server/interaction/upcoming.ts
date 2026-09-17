// Plan loops with a dueAt, for the home page 即将到来 block (SPEC §9.4).
import { and, eq, gte, isNotNull, isNull, ne } from 'drizzle-orm'
import type { DayString, PersonRefDTO } from '@/contracts'
import { daysBetween, todayInTz } from '@/lib/time'
import { loops, owned, persons, type Db } from '@/server/db'
import { partialDateEnd } from './loop-state'

export interface UpcomingPlan {
  person: PersonRefDTO
  loopId: number
  label: string
  solar: DayString
  days: number
}

/**
 * Open 约定 falling due in the next `days` days, confirmed or not (SPEC §9.4). This is the one place the interaction
 * layer reaches the home page, and only because 即将到来 is already a list sorted by date — there is no global list of
 * unfinished items anywhere (SPEC §9.3).
 *
 * A month-level `dueAt` ('2026-10') is placed on the last day it could still happen; a year-level one is too vague to
 * put on a dated list and is left out.
 */
export async function getUpcomingPlans(db: Db, ownerId: string, days: number): Promise<UpcomingPlan[]> {
  const today = todayInTz()
  const rows = await db
    .select({ id: loops.id, text: loops.text, dueAt: loops.dueAt, personId: persons.id, label: persons.label })
    .from(loops)
    .innerJoin(persons, eq(persons.id, loops.personId))
    .where(
      owned(
        loops,
        ownerId,
        eq(loops.kind, 'plan'),
        isNotNull(loops.dueAt),
        ne(loops.status, 'rejected'),
        isNull(loops.closedReason),
        isNull(loops.closedMessageId),
        and(eq(persons.ownerId, ownerId), isNull(persons.mergedIntoId)),
        // a period that ends before today can never be upcoming; the exact day is checked below
        gte(loops.dueAt, today.slice(0, 7)),
      ),
    )
    .limit(500)
    .all()

  const out: UpcomingPlan[] = []
  for (const r of rows) {
    if (!r.dueAt || /^\d{4}$/.test(r.dueAt)) continue
    const solar = partialDateEnd(r.dueAt)
    const d = daysBetween(today, solar)
    if (d < 0 || d > days) continue
    out.push({ person: { id: r.personId, label: r.label }, loopId: r.id, label: r.text, solar, days: d })
  }
  out.sort((a, b) => a.solar.localeCompare(b.solar) || a.loopId - b.loopId)
  return out
}
