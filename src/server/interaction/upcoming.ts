// Dated open matters shared by the home sidebar and the independent matters view.
import { and, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { DayString, LoopDirection, LoopKind, PersonRefDTO } from '@/contracts'
import { daysBetween, todayInTz } from '@/lib/time'
import { loops, owned, persons, type Db } from '@/server/db'
import { partialDateEnd } from './loop-state'

export interface UpcomingPlan {
  person: PersonRefDTO
  loopId: number
  label: string
  solar: DayString
  days: number
  loopKind?: LoopKind
  direction?: LoopDirection
  status?: 'proposed' | 'confirmed'
  dueAt?: string
}

/** Legacy plans-only entry point. Month precision is retained; year-only dates are omitted. */
export async function getUpcomingPlans(db: Db, ownerId: string, days: number): Promise<UpcomingPlan[]> {
  return getUpcomingLoops(db, ownerId, days, todayInTz(), true)
}

/** All dated open matters, including requests and promises. The caller supplies its timezone's today. */
export async function getUpcomingLoops(db: Db, ownerId: string, days: number, today = todayInTz(), plansOnly = false): Promise<UpcomingPlan[]> {
  const rows = await db
    .select({ id: loops.id, text: loops.text, dueAt: loops.dueAt, kind: loops.kind, direction: loops.direction, status: loops.status, personId: persons.id, label: persons.label })
    .from(loops)
    .innerJoin(persons, eq(persons.id, loops.personId))
    .where(
      owned(
        loops,
        ownerId,
        plansOnly ? eq(loops.kind, 'plan') : undefined,
        isNotNull(loops.dueAt),
        inArray(loops.status, ['proposed', 'confirmed']),
        isNull(loops.closedReason),
        isNull(loops.closedMessageId),
        and(eq(persons.ownerId, ownerId), isNull(persons.mergedIntoId)),
        // a period that ends before today can never be upcoming; the exact day is checked below
        gte(loops.dueAt, today.slice(0, 7)),
      ),
    )
    .all()

  const out: UpcomingPlan[] = []
  for (const r of rows) {
    if (!r.dueAt || /^\d{4}$/.test(r.dueAt)) continue
    const solar = partialDateEnd(r.dueAt)
    const d = daysBetween(today, solar)
    if (d < 0 || d > days) continue
    out.push({ person: { id: r.personId, label: r.label }, loopId: r.id, label: r.text, solar, days: d,
      loopKind: r.kind, direction: r.direction, status: r.status as 'proposed' | 'confirmed', dueAt: r.dueAt })
  }
  out.sort((a, b) => a.solar.localeCompare(b.solar) || a.loopId - b.loopId)
  return out
}
