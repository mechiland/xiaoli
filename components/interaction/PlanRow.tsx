'use client'
// SPEC §9.4: one 约定 row inside the home page's 即将到来 block. Same row shape as a date row, plus a small 约定 note —
// this is the only place the interaction layer reaches the home page, because 即将到来 is already a dated list.
import Link from 'next/link'
import type { DayString } from '@/contracts'
import { cn } from '@/lib/cn'
import { personHref } from '@/lib/links'
import { todayInTz } from '@/lib/time'
import { daysLabel, formatDay, weekday } from './format'
import { Sep } from './ui'

const nameLink = 'text-ink decoration-line-strong decoration-1 underline-offset-[5px] hover:underline'

export function PlanRow({
  person,
  loopId,
  label,
  solar,
  days,
  today,
}: {
  person: { id: number; label: string }
  loopId: number
  label: string
  solar: DayString
  days: number
  today?: string
}) {
  const t = today ?? todayInTz()
  const href = personHref(person.id, { type: 'loop', id: loopId })
  return (
    <li data-plan-row className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-0 border-b border-line py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_5.5rem]">
      <div className="col-start-1 row-start-1 min-w-0 text-[15px] leading-7">
        <Link href={href} className={nameLink}>
          {person.label}
        </Link>
        <Sep className="px-1" />{' '}
        <span className="text-ink-2">{label}</span>
        <span className="whitespace-nowrap">
          {' '}
          <Link href={href} className="text-[12px] text-ink-3 underline decoration-line underline-offset-[3px] hover:text-ink-2">
            约定
          </Link>
        </span>
      </div>
      <div className="col-span-2 col-start-1 row-start-2 text-[13px] leading-6 text-ink-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:text-right">
        <span className="whitespace-nowrap font-data tabular-nums">
          {formatDay(solar, t)} {weekday(solar)}
        </span>
      </div>
      <div className={cn('col-start-2 row-start-1 text-right font-data text-[13px] leading-7 tabular-nums sm:col-start-3', days <= 2 ? 'text-ink' : 'text-ink-2')}>
        {daysLabel(days)}
      </div>
    </li>
  )
}
