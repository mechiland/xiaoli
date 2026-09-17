'use client'

import { ArrowRight, CalendarDays, Check, CheckCheck } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import type { HomeResponse } from '@/contracts'
import { interactionApi, useAction } from '@/components/interaction/api'
import { cn } from '@/lib/cn'
import { personHref, tasksRangeHref } from '@/lib/links'
import { daysLabel, formatDay, weekday } from './format'

type UpcomingItem = HomeResponse['upcoming'][number]

export function TasksPanel({ rows, today, compact = false, initialDays = 7 }: { rows: UpcomingItem[]; today: string; compact?: boolean; initialDays?: 7 | 30 }) {
  const [days, setDays] = useState<7 | 30>(initialDays)
  const [completed, setCompleted] = useState<{ id: number; label: string } | null>(null)
  const action = useAction()
  const filtered = rows.filter((row) => row.days <= days)
  const shown = compact ? filtered.slice(0, 6) : filtered

  async function finish(row: UpcomingItem) {
    if (row.loopId === null) return
    const result = await action.run(() => interactionApi.closeLoop(row.loopId!, 'done'))
    if (result) setCompleted({ id: row.loopId, label: row.label })
  }

  async function undo() {
    if (!completed) return
    const result = await action.run(() => interactionApi.reopenLoop(completed.id))
    if (result) setCompleted(null)
  }

  return (
    <section aria-label="近期事项" data-tasks-panel>
      {compact && (
        <div className="mb-1 flex items-center justify-between gap-4">
          <h2 className="font-serif text-[22px] font-semibold leading-8">事项</h2>
          <CalendarDays className="size-[18px] text-ink-3" strokeWidth={1.5} aria-hidden />
        </div>
      )}
      {compact && <p className="mb-5 text-[12px] leading-6 text-ink-3">重要的日子，还有待办的事。</p>}
      <div role="group" aria-label="事项时间范围" className="flex gap-5 border-b border-line">
        {([7, 30] as const).map((range) => (
          <button key={range} type="button" aria-pressed={days === range} onClick={() => setDays(range)} className={cn('-mb-px flex items-center gap-2 border-b-2 pb-3 pt-1 text-[13px] transition-colors', days === range ? 'border-ink font-medium text-ink' : 'border-transparent text-ink-3 hover:text-ink')}>
            未来 {range} 天
            <span className="font-data text-[11px] tabular-nums text-ink-3">{rows.filter((row) => row.days <= range).length}</span>
          </button>
        ))}
      </div>
      {action.error && <p role="alert" className="mt-3 text-[13px] text-danger">{action.error}</p>}
      {completed && (
        <div role="status" className="mt-3 flex items-center gap-2 border border-line px-3 py-2 text-[12px] text-ink-2">
          <CheckCheck className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
          <span className="min-w-0 flex-1 truncate" title={completed.label}>已完成：{completed.label}</span>
          <button type="button" disabled={action.pending} onClick={() => void undo()} className="shrink-0 underline underline-offset-4 disabled:opacity-40">撤销</button>
        </div>
      )}
      {shown.length === 0 ? (
        <div className="py-8 text-[13px] leading-7 text-ink-3">
          <p>未来 {days} 天暂无事项。</p>
          {days === 7 && rows.length > 0 ? (
            <button type="button" onClick={() => setDays(30)} className="mt-1 text-ink-2 underline decoration-line-strong underline-offset-4">看看未来 30 天</button>
          ) : <p className="mt-1">生日、重要日期和有时间的待办会出现在这里。</p>}
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((row, index) => {
            const href = row.loopId !== null
              ? personHref(row.person.id, { type: 'loop', id: row.loopId })
              : row.dateId !== null ? personHref(row.person.id, { type: 'date', id: row.dateId }) : personHref(row.person.id)
            const isDate = row.kind === 'date'
            const monthOnly = row.dueAt?.length === 7
            const typeLabel = isDate ? row.label : row.direction === 'theirs' ? '等待对方' : row.loopKind === 'question' ? '待回复' : row.kind === 'plan' ? '约定' : '待办'
            return (
              <li key={`${row.kind}-${row.dateId ?? row.loopId}`} data-task-row className={cn('flex items-start gap-3 py-4', compact && index >= 3 && 'hidden lg:flex')}>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-[12px] leading-6">
                    <span className={cn('font-data tabular-nums', row.days <= 2 ? 'font-medium text-ink' : 'text-ink-2')}>
                      {monthOnly ? `${Number(row.dueAt!.slice(5))}月内` : `${formatDay(row.solar, today)} ${weekday(row.solar)}`}
                    </span>
                    <span className="text-ink-3">{monthOnly ? '具体日期未定' : daysLabel(row.days)}</span>
                  </div>
                  <Link href={href} className="block text-[15px] leading-7 text-ink decoration-line-strong underline-offset-4 hover:underline [overflow-wrap:anywhere]">
                    {isDate ? `${row.person.label} · ${row.label}` : row.label}
                  </Link>
                  {(!isDate || row.lunarLabel) && <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[12px] leading-6 text-ink-3">
                    {!isDate && <Link href={personHref(row.person.id)} className="hover:text-ink hover:underline">{row.person.label}</Link>}
                    {!isDate && <span aria-hidden>·</span>}
                    {!isDate && <span>{typeLabel}</span>}
                    {row.lunarLabel && <span>{row.lunarLabel}</span>}
                    {row.status === 'proposed' && <span className="text-proposed">· 待确认</span>}
                  </div>}
                </div>
                {!isDate && row.loopId !== null && (
                  <button type="button" disabled={action.pending} aria-label={`完成：${row.label}`} title="标为已完成" onClick={() => void finish(row)} className="group mt-7 flex size-8 shrink-0 items-center justify-center text-ink-3 hover:bg-paper-hover hover:text-ink disabled:opacity-40">
                    <span className="flex size-[18px] items-center justify-center border border-line-strong group-hover:border-ink"><Check className="size-3 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" strokeWidth={1.5} aria-hidden /></span>
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {compact && (
        <Link href={tasksRangeHref(days)} className="mt-1 flex items-center justify-between border-t border-line pt-4 text-[13px] text-ink-2 hover:text-ink">
          <span>{filtered.length > shown.length ? `查看全部 ${filtered.length} 项` : '查看全部事项'}</span>
          <ArrowRight className="size-4" strokeWidth={1.5} aria-hidden />
        </Link>
      )}
    </section>
  )
}
