// Pure "即将到来" computation (SPEC §9.4): next occurrence of each confirmed important date within 30 days.
import type { HomeResponse } from '@/contracts'
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
      dateId: r.dateId,
      label: dateItemLabel(r.kind, r.label),
      solar: next.solar,
      lunarLabel: r.calendar === 'lunar' ? (next.lunarLabel ?? null) : null,
      days: next.days,
    })
  }
  return out.sort((a, b) => a.days - b.days || a.person.label.localeCompare(b.person.label, 'zh-Hans-CN') || a.dateId - b.dateId)
}
