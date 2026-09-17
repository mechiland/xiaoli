// Pure "即将到来" computation (SPEC §9.4): the next occurrence of each confirmed important date within 30 days,
// merged with all dated open matters that fall due inside the same window.
import type { DayString, HomeResponse, LoopDirection, LoopKind, PersonRefDTO } from '@/contracts'
import { nextOccurrence } from '@/lib/lunar'

export const UPCOMING_WINDOW_DAYS = 30

export interface UpcomingDateRow {
  dateId: number
  personId: number
  personLabel: string
  kind: string
  label: string | null
  calendar: 'solar' | 'lunar'
  month: number | null
  day: number | null
  isLeapMonth: boolean
}

/** One 约定 row, structurally `UpcomingPlan` from `@/server/interaction` (ARCHITECTURE §1.17). */
export interface UpcomingPlanRow {
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

export type UpcomingRow = HomeResponse['upcoming'][number]

const KIND_LABELS: Record<string, string> = {
  birthday: '生日',
  anniversary: '纪念日',
  memorial: '纪念日',
  other: '重要日子',
}

/** "事项": the date's own label when it has one ("外婆的忌日"), otherwise the kind in Chinese. */
export function dateItemLabel(kind: string, label: string | null): string {
  const own = label?.trim()
  if (own) return own
  return KIND_LABELS[kind] ?? '重要日子'
}

export function computeUpcoming(rows: UpcomingDateRow[], today: string, windowDays = UPCOMING_WINDOW_DAYS): HomeResponse['upcoming'] {
  const out: HomeResponse['upcoming'] = []
  for (const r of rows) {
    if (r.month == null || r.day == null) continue
    if (r.month < 1 || r.month > 12 || r.day < 1 || r.day > 31) continue
    let next: ReturnType<typeof nextOccurrence>
    try {
      next = nextOccurrence({ calendar: r.calendar, month: r.month, day: r.day, isLeapMonth: r.isLeapMonth }, today)
    } catch {
      continue // a date that never occurs (e.g. solar 4/31) is simply not upcoming
    }
    if (next.days > windowDays) continue
    out.push({
      person: { id: r.personId, label: r.personLabel },
      kind: 'date',
      dateId: r.dateId,
      loopId: null,
      label: dateItemLabel(r.kind, r.label),
      solar: next.solar,
      lunarLabel: r.calendar === 'lunar' ? (next.lunarLabel ?? null) : null,
      days: next.days,
    })
  }
  return out.sort(compareUpcoming)
}

/**
 * The whole block is one date-sorted list (SPEC §9.4): dates and 约定 mixed, ascending by solar day. `days` is derived
 * from the same solar day, so it orders identically; the tiebreakers keep the order stable for one and the same day.
 */
export function compareUpcoming(a: UpcomingRow, b: UpcomingRow): number {
  return (
    a.solar.localeCompare(b.solar) ||
    a.days - b.days ||
    a.person.label.localeCompare(b.person.label, 'zh-Hans-CN') ||
    a.kind.localeCompare(b.kind) ||
    (a.dateId ?? a.loopId ?? 0) - (b.dateId ?? b.loopId ?? 0)
  )
}

/**
 * Merges the 约定 rows into the important-date rows. Plans outside the window are dropped defensively: the block is
 * "the next 30 days"; overdue and undated matters remain accessible on their person pages.
 */
export function mergeUpcoming(dates: UpcomingRow[], plans: UpcomingPlanRow[], windowDays = UPCOMING_WINDOW_DAYS): UpcomingRow[] {
  const rows: UpcomingRow[] = [...dates]
  for (const p of plans) {
    if (p.days < 0 || p.days > windowDays) continue
    rows.push({ ...p, kind: !p.loopKind || p.loopKind === 'plan' ? 'plan' : 'loop', dateId: null, lunarLabel: null })
  }
  return rows.sort(compareUpcoming)
}
