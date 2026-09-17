'use client'
// One reviewable item: text + evidence mark + 确认 / 不对 / 改写 (SPEC §9.9). Handled items stay in place.

import Link from 'next/link'
import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { EvidenceMark, EvidenceRow } from '@/components/evidence'
import type { ClaimDTO, ImportantDateDTO, PersonRefDTO, ReviewItem, ReviewRequest, Status } from '@/contracts'
import { cn } from '@/lib/cn'
import { personHref } from '@/lib/links'
import { useCloseLoop, useReviewAction } from './data'
import {
  editableText,
  formatImportantDate,
  isLabelEcho,
  formatPartialDate,
  HANDLE_KIND_LABEL,
  loopDueLabel,
  loopOpenedLabel,
  loopSentence,
  loopStateLabel,
  nextOccurrenceNote,
  personLabel,
  relationWord,
  STATUS_LABEL,
} from './format'

type ClaimItem = Extract<ReviewItem, { type: 'claim' }>

export interface RowProps {
  importId: number
  sectionPersonId: number
  /** label of the section's person: a handle repeating it is shown muted */
  sectionPersonLabel: string
  /** the user's own person: named 我 in relation phrases and event participants */
  selfId: number | null
  it: ReviewItem
  /** footnote number of the item */
  index: number
  /** footnote number of the old statement (changes only) */
  oldIndex?: number
  fresh?: boolean
}

const textByStatus = (s: Status) =>
  s === 'rejected' || s === 'superseded' ? 'text-superseded line-through decoration-line-strong decoration-1' : 'text-ink'

const ruleByStatus = (s: Status) => (s === 'proposed' ? 'border-proposed' : 'border-transparent')

function Mark({ it, index }: { it: { type: ReviewItem['type']; item: ReviewItem['item'] }; index: number }) {
  return <EvidenceMark target={{ type: it.type, id: it.item.id }} index={index} sourceKind={it.item.sourceKind} evidenceCount={it.item.evidenceCount} />
}

function PersonName({ p, section, selfId }: { p: PersonRefDTO; section: number; selfId: number | null }) {
  const label = personLabel(p, selfId)
  if (p.id === section) return <span data-person-name={p.id}>{label}</span>
  return (
    <Link href={personHref(p.id)} className="loam-link" data-person-name={p.id}>
      {label}
    </Link>
  )
}

function Meta({ children }: { children: ReactNode }) {
  return <span className="ml-2 inline-block text-[13px] leading-7 text-ink-3 no-underline">{children}</span>
}

export function ItemRow(props: RowProps) {
  const { it } = props
  if (it.type === 'claim' && it.replaces) return <ChangeRow {...props} it={it} />
  return <PlainRow {...props} />
}

// ---- plain row --------------------------------------------------------------------------------------------------

function PlainRow({ importId, sectionPersonId, sectionPersonLabel, selfId, it, index, fresh }: RowProps) {
  const review = useReviewAction(importId)
  const close = useCloseLoop(importId)
  const [editing, setEditing] = useState(false)
  const status = it.item.status
  const pending = review.isPending || close.isPending

  const content = (() => {
    const struck = textByStatus(status)
    switch (it.type) {
      case 'claim':
        return (
          <>
            <span className={struck}>{it.item.statement}</span>
            <Mark it={it} index={index} />
            {it.item.validFrom && <Meta>自{formatPartialDate(it.item.validFrom)}</Meta>}
          </>
        )
      case 'handle': {
        // e.g. the real name 王小明 in 王小明's own section (after a merge or a rename): still reviewable, but muted
        const echo = isLabelEcho(it.item.value, sectionPersonLabel)
        return (
          <>
            <span className={echo && struck === 'text-ink' ? 'text-ink-3' : struck} data-label-echo={echo || undefined}>
              {it.item.kind === 'address_term' ? '被称为' : '又名'}「{it.item.value}」
            </span>
            <Mark it={it} index={index} />
            <Meta>
              {echo ? '和名字相同 · ' : ''}
              {HANDLE_KIND_LABEL[it.item.kind]}
              {it.item.chatTitle ? ` · ${it.item.chatTitle}` : ''}
            </Meta>
          </>
        )
      }
      case 'relation':
        return (
          <>
            <span className={struck}>
              {/* Chinese text: no spaces around 是/的; the link underline marks the names */}
              <PersonName p={it.item.from} section={sectionPersonId} selfId={selfId} />是<PersonName p={it.item.to} section={sectionPersonId} selfId={selfId} />的{relationWord(it.item)}
            </span>
            <Mark it={it} index={index} />
          </>
        )
      case 'date':
        return (
          <>
            <span className={struck}>{formatImportantDate(it.item)}</span>
            <Mark it={it} index={index} />
            {status !== 'rejected' && nextOccurrenceNote(it.item) && <Meta>{nextOccurrenceNote(it.item)}</Meta>}
          </>
        )
      case 'loop': {
        // SPEC §9.9: the sentence a person would say, then the day it opened in small type. The direction is in the
        // wording ("你答应…" / "她问你…，你没回"), never printed as promise/mine.
        const meta = [loopOpenedLabel(it.item.openedAt), loopDueLabel(it.item)].filter(Boolean).join(' · ')
        return (
          <>
            <span className={struck}>{loopSentence(it.item, personLabel({ id: sectionPersonId, label: sectionPersonLabel }, selfId))}</span>
            <Mark it={it} index={index} />
            {meta && <Meta>{meta}</Meta>}
          </>
        )
      }
      case 'event': {
        const others = it.item.participants.filter((p) => p.id !== sectionPersonId)
        return (
          <>
            <span className={struck}>{it.item.summary}</span>
            <Mark it={it} index={index} />
            {(it.item.place || others.length > 0) && (
              <Meta>
                {[it.item.place, others.length ? `和${others.map((p) => personLabel(p, selfId)).join('、')}` : null].filter(Boolean).join(' · ')}
              </Meta>
            )}
          </>
        )
      }
    }
  })()

  return (
    <EvidenceRow
      as="li"
      className={cn('py-[3px] sm:py-[5px]', fresh && 'animate-in fade-in-0 duration-700')}
      // data hooks for scenarios
    >
      <div data-review-item={`${it.type}:${it.item.id}`} data-status={status} className="flex flex-col sm:flex-row sm:items-start sm:gap-6">
        <div className={cn('min-w-0 border-l pl-3 text-[15px] leading-7 [overflow-wrap:anywhere] sm:flex-1', ruleByStatus(status))}>
          {editing ? (
            it.type === 'date' ? (
              <DateEditor
                date={it.item}
                pending={review.isPending}
                onCancel={() => setEditing(false)}
                onSave={(patch) => review.mutate({ it, action: 'edit', patch }, { onSuccess: () => setEditing(false) })}
              />
            ) : (
              <TextEditor
                initial={editableText(it)}
                label={it.type === 'relation' ? '改写关系' : it.type === 'loop' ? '改写这件事' : '改写'}
                pending={review.isPending}
                onCancel={() => setEditing(false)}
                onSave={(text) => {
                  if (text === editableText(it)) return review.mutate({ it, action: 'accept' }, { onSuccess: () => setEditing(false) })
                  review.mutate({ it, action: 'edit', patch: textPatch(it, text) }, { onSuccess: () => setEditing(false) })
                }}
              />
            )
          ) : (
            content
          )}
        </div>
        {!editing && (
          <Actions
            status={status}
            pending={pending}
            handledLabel={it.type === 'loop' ? loopStateLabel(it.item) : null}
            onAccept={() => review.mutate({ it, action: 'accept' })}
            onReject={() => review.mutate({ it, action: 'reject' })}
            onEdit={() => setEditing(true)}
            // 已经了结了 = confirm + close in one call; an item already closed by a later message has nothing to close
            onClose={it.type === 'loop' && it.item.state === 'open' ? () => close.mutate({ it }) : undefined}
          />
        )}
      </div>
      {review.isError && <RowError message={review.error.message} onRetry={() => review.variables && review.mutate(review.variables)} />}
      {close.isError && <RowError message={close.error.message} onRetry={() => close.variables && close.mutate(close.variables)} />}
    </EvidenceRow>
  )
}

function textPatch(it: ReviewItem, text: string): ReviewRequest['patch'] {
  switch (it.type) {
    case 'claim':
      return { statement: text }
    case 'handle':
      return { value: text }
    case 'relation':
      return { label: text }
    case 'event':
      return { summary: text }
    case 'loop':
      return { text }
    default:
      return {}
  }
}

// ---- change row ("变化") ----------------------------------------------------------------------------------------

function ChangeRow({ importId, it, index, oldIndex, fresh }: RowProps & { it: ClaimItem }) {
  const review = useReviewAction(importId)
  const [editing, setEditing] = useState(false)
  const old = it.replaces as ClaimDTO
  const status = it.item.status
  const oldGone = old.status === 'superseded' || old.status === 'rejected'

  return (
    <EvidenceRow as="li" className={cn('py-[7px]', fresh && 'animate-in fade-in-0 duration-700')}>
      <div data-review-item={`claim:${it.item.id}`} data-status={status} className="flex flex-col sm:flex-row sm:items-start sm:gap-6">
        <div
          data-change
          className={cn(
            'grid min-w-0 flex-1 border-l pl-3 text-[15px] leading-7 [overflow-wrap:anywhere] sm:grid-cols-[minmax(0,1fr)_1.75rem_minmax(0,1fr)]',
            ruleByStatus(status),
          )}
        >
          <div data-change-old>
            <span className={cn(oldGone ? 'text-superseded line-through decoration-line-strong' : 'text-ink-3')}>{old.statement}</span>
            <Mark it={{ type: 'claim', item: old }} index={oldIndex ?? 0} />
          </div>
          <div aria-hidden className="font-data text-[14px] leading-7 text-ink-3 sm:text-center">
            <span className="sm:hidden">↓</span>
            <span className="hidden sm:inline">→</span>
          </div>
          <div data-change-new>
            <span className="sr-only">变为</span>
            {editing ? (
              <TextEditor
                initial={it.item.statement}
                label="改写新的说法"
                pending={review.isPending}
                onCancel={() => setEditing(false)}
                onSave={(text) =>
                  review.mutate(text === it.item.statement ? { it, action: 'accept' } : { it, action: 'edit', patch: { statement: text } }, {
                    onSuccess: () => setEditing(false),
                  })
                }
              />
            ) : (
              <>
                <span className={textByStatus(status)}>{it.item.statement}</span>
                <Mark it={it} index={index} />
              </>
            )}
          </div>
        </div>
        {!editing && <Actions status={status} pending={review.isPending} onAccept={() => review.mutate({ it, action: 'accept' })} onReject={() => review.mutate({ it, action: 'reject' })} onEdit={() => setEditing(true)} />}
      </div>
      {review.isError && <RowError message={review.error.message} onRetry={() => review.variables && review.mutate(review.variables)} />}
    </EvidenceRow>
  )
}

// ---- actions ----------------------------------------------------------------------------------------------------

function Actions({
  status,
  pending,
  onAccept,
  onReject,
  onEdit,
  onClose,
  handledLabel,
}: {
  status: Status
  pending: boolean
  onAccept: () => void
  onReject: () => void
  onEdit: () => void
  /** 未结事项 only: "已经了结了" — confirms and closes in one click (SPEC §9.9) */
  onClose?: () => void
  /** what a handled row says instead of 已确认 (a closed loop reads 已了结) */
  handledLabel?: string | null
}) {
  // One rule for every row type. Desktop: a fixed 128 px right column. Under 640 px: always its own line under the
  // row text, right-aligned — never inline after a short statement, so a group's actions share one position.
  // 未结事项 have a fourth action, which wraps onto a second line inside the same column and keeps the right edge.
  const box = 'flex shrink-0 flex-wrap items-center justify-end gap-x-5 gap-y-0.5 text-[13px] leading-7 sm:w-[128px] sm:gap-x-4'
  if (status !== 'proposed') {
    return (
      <div className={box} data-row-state={status}>
        <span className="text-ink-3">{handledLabel ?? STATUS_LABEL[status]}</span>
      </div>
    )
  }
  if (pending) {
    return (
      <div className={box} aria-live="polite">
        <span className="text-ink-3">正在保存…</span>
      </div>
    )
  }
  const btn = 'text-ink-2 transition-colors hover:text-ink hover:underline hover:decoration-line-strong hover:underline-offset-4'
  return (
    <div className={box} data-row-actions>
      <button type="button" className={btn} onClick={onAccept}>
        确认
      </button>
      <button type="button" className={btn} onClick={onReject}>
        不对
      </button>
      <button type="button" className={btn} onClick={onEdit}>
        改写
      </button>
      {onClose && (
        <button type="button" data-row-close className={btn} onClick={onClose}>
          已经了结了
        </button>
      )}
    </div>
  )
}

function RowError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p role="alert" className="mt-0.5 pl-3 text-[13px] leading-6 text-ink-2">
      没有保存上{message && message !== '服务器出错了' ? `：${message}` : ''}
      <span className="px-1.5 text-ink-3">·</span>
      <button type="button" className="loam-text-button" onClick={onRetry}>
        重试
      </button>
    </p>
  )
}

// ---- editors ----------------------------------------------------------------------------------------------------

const inputBase = 'rounded-[2px] border border-line-strong bg-paper text-ink outline-none transition-colors focus:border-ink-2 disabled:opacity-60'

function EditorButtons({ pending, onCancel, disabled }: { pending: boolean; onCancel: () => void; disabled?: boolean }) {
  return (
    <div className="mt-2 flex items-center gap-4 text-[13px] leading-6">
      <button type="submit" disabled={pending || disabled} className="h-7 rounded-[2px] bg-ink px-3 text-ink-inverse transition-opacity hover:opacity-90 disabled:opacity-50">
        {pending ? '正在保存…' : '保存'}
      </button>
      <button type="button" onClick={onCancel} disabled={pending} className="text-ink-2 hover:text-ink">
        取消
      </button>
      <span className="hidden text-ink-3 sm:inline">保存后即为确认</span>
    </div>
  )
}

function TextEditor({ initial, label, pending, onSave, onCancel }: { initial: string; label: string; pending: boolean; onSave: (text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial)
  const composing = useRef(false)
  const text = value.trim()
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (text && !pending) onSave(text)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing.current || e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
  }
  return (
    <form onSubmit={submit} className="py-0.5" data-editor>
      <textarea
        autoFocus
        aria-label={label}
        value={value}
        maxLength={500}
        rows={Math.min(5, Math.max(1, Math.ceil(value.length / 36)))}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => (composing.current = false)}
        onKeyDown={onKeyDown}
        onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
        className={cn(inputBase, 'block w-full resize-none px-2.5 py-1 text-[15px] leading-7')}
      />
      <EditorButtons pending={pending} onCancel={onCancel} disabled={!text} />
    </form>
  )
}

function DateEditor({ date, pending, onSave, onCancel }: { date: ImportantDateDTO; pending: boolean; onSave: (patch: NonNullable<ReviewRequest['patch']>) => void; onCancel: () => void }) {
  const [calendar, setCalendar] = useState(date.calendar)
  const [year, setYear] = useState(date.year ? String(date.year) : '')
  const [month, setMonth] = useState(date.month ? String(date.month) : '')
  const [day, setDay] = useState(date.day ? String(date.day) : '')
  const m = Number(month)
  const d = Number(day)
  const y = year.trim() ? Number(year) : null
  const valid = Number.isInteger(m) && m >= 1 && m <= 12 && Number.isInteger(d) && d >= 1 && d <= (calendar === 'lunar' ? 30 : 31) && (y === null || (Number.isInteger(y) && y > 1800 && y < 2200))
  const num = cn(inputBase, 'h-8 px-2 text-center font-data text-[14px] tabular-nums')
  return (
    <form
      data-editor
      className="py-0.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid || pending) return
        onSave({ calendar, month: m, day: d, ...(y ? { year: y } : {}) })
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[14px] text-ink-2">
        <div role="radiogroup" aria-label="历法" className="flex h-8 border border-line-strong text-[13px]">
          {(['solar', 'lunar'] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={calendar === c}
              onClick={() => setCalendar(c)}
              className={cn('px-2.5', calendar === c ? 'bg-ink text-ink-inverse' : 'text-ink-2 hover:bg-paper-hover')}
            >
              {c === 'solar' ? '公历' : '农历'}
            </button>
          ))}
        </div>
        <input aria-label="年（可不填）" inputMode="numeric" placeholder="年" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} className={cn(num, 'w-16')} />
        <input autoFocus aria-label="月" inputMode="numeric" value={month} onChange={(e) => setMonth(e.target.value.replace(/\D/g, '').slice(0, 2))} className={cn(num, 'w-11')} />
        <span>月</span>
        <input aria-label="日" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))} className={cn(num, 'w-11')} />
        <span>日</span>
      </div>
      <EditorButtons pending={pending} onCancel={onCancel} disabled={!valid} />
    </form>
  )
}
