'use client'

import { ChevronDown } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { EvidenceMark, EvidenceRow } from '@/components/evidence'
import { LastContactLine } from '@/components/interaction'
import type { ClaimDTO, ImportantDateDTO, ProfileResponse } from '@/contracts'
import { cn } from '@/lib/cn'
import { anchorId } from '@/lib/links'
import { personApi, useAction } from './api'
import { dateAsWritten, dateName, daysText, formatMsgDay, formatSolarDay, markClassFor, withPronoun } from './format'
import { InlineError, TextButton } from './Statement'

type MarkOf = (type: 'claim' | 'relation' | 'date' | 'event' | 'handle', id: number) => number

// literal class strings (Tailwind only sees whole literals): label column 84px + gap-x-3 (0.75rem)
const breakout = '[&_.evidence-block]:ml-[calc(-1*(84px_+_0.75rem))] [&_.evidence-block]:w-[calc(100%_+_84px_+_0.75rem)]'

/**
 * Label column + value; `stacked` puts the label on its own line so list values (dates, chats) get the full width.
 * An evidence block opened from a value (rendered by EvidenceRow inside the value) breaks out of the value column to
 * the left edge, so it spans the whole infobox below the field row instead of being squeezed into ~170 px.
 */
function Field({ label, children, stacked = false }: { label: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div data-field={label} className={cn('py-2 first:pt-0 last:pb-0', !stacked && 'grid grid-cols-[84px_minmax(0,1fr)] gap-x-3')}>
      <dt className="pt-[1px] text-[13px] leading-6 text-ink-3">{label}</dt>
      <dd className={cn('min-w-0 text-[14px] leading-6 text-ink [overflow-wrap:anywhere]', !stacked && breakout)}>{children}</dd>
    </div>
  )
}

/** Keeps the last characters and the footnote mark together so the mark never wraps onto a line of its own. */
function WithMark({ text, children }: { text: string; children: ReactNode }) {
  const chars = [...text]
  const tail = chars.splice(Math.max(0, chars.length - 2)).join('')
  return (
    <>
      {chars.join('')}
      <span className="whitespace-nowrap">
        {tail}
        {children}
      </span>
    </>
  )
}

function ClaimValue({ value, claim, markOf }: { value: string; claim: ClaimDTO | undefined; markOf: MarkOf }) {
  if (!claim) return <>{value}</>
  return (
    <EvidenceRow as="div">
      <WithMark text={value}>
        <EvidenceMark target={{ type: 'claim', id: claim.id }} index={markOf('claim', claim.id)} sourceKind={claim.sourceKind} evidenceCount={claim.evidenceCount} className={markClassFor(value)} />
      </WithMark>
    </EvidenceRow>
  )
}

/** "还有 12 天" for a solar date; "公历 9月25日，还有 12 天" for a lunar one (the comma may end a line, never start one). */
function NextText({ d, thisYear }: { d: ImportantDateDTO; thisYear: number }) {
  if (!d.next) return null
  const solar = formatSolarDay(d.next.solar, thisYear)
  const nextYear = Number(d.next.solar.slice(0, 4)) !== thisYear
  const lead = d.calendar === 'lunar' ? `公历 ${solar}，` : nextYear ? `下一次 ${solar}，` : null
  return (
    <span className="font-data text-[12px] leading-6 tabular-nums text-ink-3">
      {lead && <span className="whitespace-nowrap">{lead}</span>}
      <span className="whitespace-nowrap">{daysText(d.next.days)}</span>
    </span>
  )
}

/** One date row: [name] value¹ next — flows on one line when it fits and wraps between whole pieces. */
function DateValue({ d, markOf, thisYear, name }: { d: ImportantDateDTO; markOf: MarkOf; thisYear: number; name?: string }) {
  const act = useAction()
  const proposed = d.status === 'proposed'
  const written = dateAsWritten(d)
  return (
    <EvidenceRow
      as="div"
      id={anchorId('date', d.id)}
      className={cn('-ml-[11px] border-l pl-[10px] transition-colors duration-700', proposed ? 'border-proposed text-ink-2' : 'border-transparent', act.pending && 'opacity-60')}
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        {name && <span className="text-[13px] leading-6 text-ink-3">{name}</span>}
        <span>
          <WithMark text={written}>
            <EvidenceMark target={{ type: 'date', id: d.id }} index={markOf('date', d.id)} sourceKind={d.sourceKind} evidenceCount={d.evidenceCount} />
          </WithMark>
        </span>
        <NextText d={d} thisYear={thisYear} />
      </div>
      {proposed && (
        <span className="flex items-baseline gap-2">
          <TextButton disabled={act.pending} onClick={() => void act.run(() => personApi.review('date', d.id, { action: 'accept' }), { evidence: [{ type: 'date', id: d.id }] })}>
            确认
          </TextButton>
          <span className="text-[12px] text-ink-3">/</span>
          <TextButton disabled={act.pending} onClick={() => void act.run(() => personApi.review('date', d.id, { action: 'reject' }), { evidence: [{ type: 'date', id: d.id }] })}>
            不对
          </TextButton>
        </span>
      )}
      {act.error && <InlineError message={act.error} />}
    </EvidenceRow>
  )
}

export function hasInfobox(p: ProfileResponse): boolean {
  const i = p.infobox
  return Boolean(i.relationToMe || i.city || i.work || i.school || i.birthday || i.otherDates.length || i.chats.length || i.lastContactAt)
}

/** A summary piece: plain text, with `keep` segments (dates, counts) that must not break inside. */
export type SummarySegment = { text: string; keep?: boolean }

/** Pieces of the two-line summary for the collapsed narrow-screen infobox. */
export function infoboxSummaryParts(p: ProfileResponse): SummarySegment[][] {
  const i = p.infobox
  const parts: SummarySegment[][] = []
  if (i.relationToMe) parts.push([{ text: i.relationToMe.value }])
  if (i.city) parts.push([{ text: i.city.value }])
  if (i.work) parts.push([{ text: i.work.value }])
  if (i.school) parts.push([{ text: i.school.value }])
  if (i.birthday) {
    const seg: SummarySegment[] = [{ text: '生日 ' }, { text: dateAsWritten(i.birthday), keep: true }]
    if (i.birthday.next) seg.push({ text: `（${daysText(i.birthday.next.days)}）`, keep: true })
    parts.push(seg)
  }
  if (i.lastContactAt) parts.push([{ text: '最后一次聊天 ' }, { text: formatMsgDay(i.lastContactAt), keep: true }])
  if (parts.length === 0 && i.chats.length) parts.push([{ text: '共同聊天 ' }, ...i.chats.map((c) => ({ text: `『${c.chat.title}』` }))])
  return parts
}

/** Plain-text summary (tests, aria). */
export function infoboxSummary(p: ProfileResponse): string {
  return infoboxSummaryParts(p)
    .map((s) => s.map((x) => x.text).join(''))
    .join(' · ')
}

/**
 * Renders the summary so that dates never break and a " ·" separator stays glued to the end of the piece before it
 * (a line may end with the separator, never start with one).
 */
function Summary({ parts }: { parts: SummarySegment[][] }) {
  return (
    <>
      {parts.map((segs, pi) => {
        const last = pi === parts.length - 1
        // glue the separator to the final segment (its last two characters when the segment may break)
        const tail = segs[segs.length - 1]
        const head = segs.slice(0, -1)
        const tailChars = [...tail.text]
        const tailKeep = tail.keep ? tail.text : tailChars.slice(-2).join('')
        const tailFree = tail.keep ? '' : tailChars.slice(0, -2).join('')
        return (
          <Fragment key={pi}>
            {head.map((s, si) => (s.keep ? <span key={si} className="whitespace-nowrap">{s.text}</span> : <Fragment key={si}>{s.text}</Fragment>))}
            {tailFree}
            <span className="whitespace-nowrap">
              {tailKeep}
              {!last && <span className="text-ink-3"> ·</span>}
            </span>
            {!last && ' '}
          </Fragment>
        )
      })}
    </>
  )
}

export function InfoboxFields({ profile, markOf }: { profile: ProfileResponse; markOf: MarkOf }) {
  const i = profile.infobox
  const claimById = new Map<number, ClaimDTO>()
  for (const s of profile.sections) for (const c of s.claims) claimById.set(c.id, c)
  const relation = i.relationToMe ? profile.relations.find((r) => r.id === i.relationToMe!.relationId) : undefined
  const thisYear = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date()))

  return (
    <dl className="divide-y divide-line">
      {i.relationToMe && (
        <Field label="与我的关系">
          {relation ? (
            <EvidenceRow as="div">
              <WithMark text={i.relationToMe.value}>
                <EvidenceMark target={{ type: 'relation', id: relation.id }} index={markOf('relation', relation.id)} sourceKind={relation.sourceKind} evidenceCount={relation.evidenceCount} />
              </WithMark>
            </EvidenceRow>
          ) : (
            i.relationToMe.value
          )}
        </Field>
      )}
      {i.city && (
        <Field label="所在城市">
          <ClaimValue value={i.city.value} claim={claimById.get(i.city.claimId)} markOf={markOf} />
        </Field>
      )}
      {i.work && (
        <Field label="工作">
          <ClaimValue value={i.work.value} claim={claimById.get(i.work.claimId)} markOf={markOf} />
        </Field>
      )}
      {i.school && (
        <Field label="学校">
          <ClaimValue value={i.school.value} claim={claimById.get(i.school.claimId)} markOf={markOf} />
        </Field>
      )}
      {i.birthday && (
        <Field label="生日">
          <DateValue d={i.birthday} markOf={markOf} thisYear={thisYear} />
        </Field>
      )}
      {i.otherDates.length > 0 && (
        <Field label="其他重要日期" stacked>
          <div className="space-y-0.5">
            {i.otherDates.map((d) => (
              <DateValue key={d.id} d={d} name={dateName(d)} markOf={markOf} thisYear={thisYear} />
            ))}
          </div>
        </Field>
      )}
      {i.chats.length > 0 && (
        <Field label="共同聊天" stacked>
          <ul data-infobox-chats>
            {i.chats.map((c) => {
              const count = `${c.messageCount.toLocaleString('zh-CN')} 条`
              const last = c.lastMessageAt ? formatSolarDay(c.lastMessageAt.slice(0, 10), thisYear) : null
              const detail =
                c.chat.kind === 'private'
                  ? `私聊共 ${count}${c.lastMessageAt ? `，最后一条在 ${formatMsgDay(c.lastMessageAt)}` : ''}`
                  : `${withPronoun(profile.person.isSelf, `在群里发言 ${count}`)}${c.lastMessageAt ? `，最后一条在 ${formatMsgDay(c.lastMessageAt)}` : ''}`
              return (
                <li key={c.chat.id} title={detail} className="flex items-baseline gap-3">
                  {/* the full-width 『 has an empty left half: pull it back so the title aligns with the label */}
                  <span className="-ml-[0.45em] min-w-0 flex-1 truncate">『{c.chat.title}』</span>
                  <span className="shrink-0 whitespace-nowrap font-data text-[12px] tabular-nums text-ink-3">
                    {count}
                    {last && <> · {last}</>}
                  </span>
                  <span className="sr-only">{detail}</span>
                </li>
              )
            })}
          </ul>
        </Field>
      )}
      {/* SPEC §9.5: not a bare timestamp — the day, how long ago, and what that conversation was about. */}
      {i.lastContactAt && (
        <Field label="最后一次聊天">
          <LastContactLine personId={profile.person.id} lastContactAt={i.lastContactAt} />
        </Field>
      )}
    </dl>
  )
}

/**
 * One infobox, rendered once (every row id exists a single time): right column on wide screens; under the title on
 * narrow screens, collapsed to a two-line summary that expands the same fields.
 */
export function Infobox({ profile, markOf, open, onOpenChange }: { profile: ProfileResponse; markOf: MarkOf; open: boolean; onOpenChange: (v: boolean) => void }) {
  if (!hasInfobox(profile)) return null
  return (
    <aside data-block="infobox" aria-label="信息框" className="border border-line bg-paper lg:px-5 lg:py-4">
      <p className="mb-3 hidden border-b border-line pb-2.5 font-serif text-[16px] font-semibold leading-6 text-ink [overflow-wrap:anywhere] lg:block">{profile.person.label}</p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="infobox-fields"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left lg:hidden"
      >
        {open ? (
          <span className="min-w-0 flex-1 text-[13px] leading-6 text-ink-3">信息框</span>
        ) : (
          <span data-infobox-summary className="line-clamp-2 min-w-0 flex-1 text-[14px] leading-6 text-ink-2">
            <Summary parts={infoboxSummaryParts(profile)} />
          </span>
        )}
        <ChevronDown className={cn('mt-1 size-4 shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} strokeWidth={1.5} aria-hidden />
        <span className="sr-only">{open ? '收起信息框' : '展开信息框'}</span>
      </button>
      <div id="infobox-fields" data-open={open || undefined} className={cn('border-t border-line px-4 py-3 lg:block lg:border-t-0 lg:p-0', !open && 'hidden')}>
        <InfoboxFields profile={profile} markOf={markOf} />
      </div>
    </aside>
  )
}
