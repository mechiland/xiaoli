'use client'

import Link from 'next/link'
import { useState } from 'react'
import { EvidenceMark, EvidenceRow } from '@/components/evidence'
import { PersonPicker, type PersonPick } from '@/components/person-picker'
import { RELATION_TYPES, type Category, type ClaimDTO, type EventDTO, type ProfileResponse, type RelationDTO } from '@/contracts'
import { cn } from '@/lib/cn'
import { anchorId, personHref } from '@/lib/links'
import { personApi, useAction } from './api'
import { ClaimRow, inputCls } from './ClaimRow'
import { CATEGORY_HINT, CATEGORY_LABEL, CATEGORY_ORDER, formatIsoDay, formatPartialDate, markClassFor, MARK_TIGHT, relationPhrase, RELATION_TYPE_LABEL } from './format'
import { Gap, InlineError, Statement, TextButton } from './Statement'

type MarkOf = (type: 'claim' | 'relation' | 'date' | 'event' | 'handle', id: number) => number

const h2 = 'loam-section-title border-b border-line pb-1.5'

// ---------------------------------------------------------------------------------------------------------------
// body sections by category

export function BodySections({ profile, markOf, selfId }: { profile: ProfileResponse; markOf: MarkOf; selfId: number | null }) {
  const [adding, setAdding] = useState<Category | null>(null)
  const present = new Set(profile.sections.map((s) => s.category))
  const shown = CATEGORY_ORDER.filter((c) => present.has(c) || adding === c)
  const missing = CATEGORY_ORDER.filter((c) => !present.has(c) && adding !== c)
  const byCat = new Map(profile.sections.map((s) => [s.category, s.claims]))
  const personId = profile.person.id

  return (
    <div data-block="body">
      {shown.length === 0 && <p className="loam-prose text-ink-3">还没有关于 TA 的信息。</p>}
      {shown.map((c, i) => (
        <section key={c} aria-labelledby={`sec-${c}`} className={cn(i > 0 && 'mt-10')}>
          <h2 id={`sec-${c}`} className={h2}>
            {CATEGORY_LABEL[c]}
          </h2>
          <ul className="mt-3 space-y-0.5">
            {(byCat.get(c) ?? []).map((claim: ClaimDTO) => (
              <ClaimRow key={claim.id} claim={claim} mark={markOf('claim', claim.id)} selfId={selfId} />
            ))}
          </ul>
          <AddClaim
            personId={personId}
            category={c}
            startOpen={adding === c}
            onClose={() => {
              if (adding === c) setAdding(null)
            }}
          />
        </section>
      ))}
      {missing.length > 0 && (
        <p className={cn('text-[13px] leading-7 text-ink-3', shown.length > 0 ? 'mt-10' : 'mt-3')}>
          <span className="mr-2">补充其他方面：</span>
          {missing.map((c, i) => (
            <span key={c} className="whitespace-nowrap">
              <button type="button" onClick={() => setAdding(c)} className="text-ink-3 underline decoration-line underline-offset-[3px] hover:text-ink-2 hover:decoration-line-strong">
                {CATEGORY_LABEL[c]}
              </button>
              {i < missing.length - 1 && <span aria-hidden>、</span>}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

function AddClaim({ personId, category, startOpen, onClose }: { personId: number; category: Category; startOpen: boolean; onClose: () => void }) {
  const [open, setOpen] = useState(startOpen)
  const [value, setValue] = useState('')
  const act = useAction()
  const close = () => {
    setOpen(false)
    setValue('')
    act.reset()
    onClose()
  }
  if (!open)
    return (
      <div className="mt-1.5 pl-[12px]">
        <TextButton tone="quiet" onClick={() => setOpen(true)} data-add-claim={category}>
          补充
        </TextButton>
      </div>
    )
  return (
    <form
      className="mt-2 pl-[12px]"
      onSubmit={async (e) => {
        e.preventDefault()
        const statement = value.trim()
        if (!statement) return
        const r = await act.run(() => personApi.addClaim(personId, { statement, category }))
        if (r) {
          setValue('')
          setOpen(false)
          onClose()
        }
      }}
    >
      <input
        autoFocus
        aria-label={`补充一条${CATEGORY_LABEL[category]}信息`}
        maxLength={500}
        value={value}
        disabled={act.pending}
        placeholder={`${CATEGORY_HINT[category]}，回车保存`}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && close()}
        onBlur={() => {
          if (!value.trim() && !act.pending) close()
        }}
        className={inputCls}
      />
      <p className="mt-1 text-[12px] leading-5 text-ink-3">{act.pending ? '正在保存…' : '回车保存，Esc 取消'}</p>
      {act.error && <InlineError message={act.error} />}
    </form>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// 关系

function ProposedButtons({ onAccept, onReject, disabled }: { onAccept: () => void; onReject: () => void; disabled: boolean }) {
  return (
    <>
    <Gap />
    <span className="inline-flex items-baseline gap-2 whitespace-nowrap">
      <TextButton disabled={disabled} onClick={onAccept}>
        确认
      </TextButton>
      <span className="text-[12px] text-ink-3" aria-hidden>
        /
      </span>
      <TextButton disabled={disabled} onClick={onReject}>
        不对
      </TextButton>
    </span>
    </>
  )
}

function RelationRow({ r, personId, mark, selfId }: { r: RelationDTO; personId: number; mark: number; selfId: number | null }) {
  const act = useAction()
  const phrase = relationPhrase(r, personId, selfId)
  const proposed = r.status === 'proposed'
  const link = (
    <Link href={personHref(phrase.other.id)} className="loam-link">
      {phrase.other.label}
    </Link>
  )
  const review = (action: 'accept' | 'reject') => act.run(() => personApi.review('relation', r.id, { action }), { evidence: [{ type: 'relation', id: r.id }] })
  return (
    <EvidenceRow
      as="li"
      id={anchorId('relation', r.id)}
      className={cn('border-l py-[3px] pl-[11px] transition-colors duration-700 [overflow-wrap:anywhere]', proposed ? 'border-proposed text-ink-2' : 'border-transparent', act.pending && 'opacity-60')}
    >
      <div className="loam-prose" style={{ color: 'inherit' }}>
        <span className={proposed ? '' : 'text-ink-2'}>{phrase.term}</span>
        <span className="px-2 text-ink-3" aria-hidden>
          ·
        </span>
        {link}
        <EvidenceMark target={{ type: 'relation', id: r.id }} index={mark} sourceKind={r.sourceKind} evidenceCount={r.evidenceCount} />
        {phrase.note && (
          <>
            <Gap size="sm" />
            <span data-relation-note className="text-[13px] text-ink-3">
              {phrase.note}
            </span>
          </>
        )}
        {proposed && <ProposedButtons disabled={act.pending} onAccept={() => void review('accept')} onReject={() => void review('reject')} />}
      </div>
      {act.error && <InlineError message={act.error} />}
    </EvidenceRow>
  )
}

export function RelationsSection({ profile, markOf, selfId }: { profile: ProfileResponse; markOf: MarkOf; selfId: number | null }) {
  const [adding, setAdding] = useState(false)
  const personId = profile.person.id
  return (
    <section aria-labelledby="sec-relations" className="mt-12" data-block="relations">
      <h2 id="sec-relations" className={h2}>
        关系
      </h2>
      {profile.relations.length > 0 ? (
        <ul className="mt-3 space-y-0.5">
          {profile.relations.map((r) => (
            <RelationRow key={r.id} r={r} personId={personId} mark={markOf('relation', r.id)} selfId={selfId} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 pl-[12px] text-[14px] leading-7 text-ink-3">还没有记下 TA 和谁有关系。</p>
      )}
      {adding ? (
        <AddRelation personId={personId} label={profile.person.label} selfId={selfId} onDone={() => setAdding(false)} />
      ) : (
        <div className="mt-1.5 pl-[12px]">
          <TextButton tone="quiet" onClick={() => setAdding(true)}>
            补充关系
          </TextButton>
        </div>
      )}
    </section>
  )
}

function AddRelation({ personId, label, selfId, onDone }: { personId: number; label: string; selfId: number | null; onDone: () => void }) {
  const [who, setWho] = useState<PersonPick | null>(null)
  const [term, setTerm] = useState('')
  const [type, setType] = useState<string>('relative')
  const act = useAction()
  const ready = who !== null && (type !== 'other' || term.trim().length > 0) && !(who.kind === 'self' && selfId == null)

  return (
    <form
      className="mt-3 border-l border-line-strong pl-3"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!who) return
        const r = await act.run(async () => {
          let fromId: number
          if (who.kind === 'self') fromId = selfId!
          else if (who.kind === 'existing') fromId = who.person.id
          else fromId = (await personApi.createPerson(who.label)).person.id
          // "<who> 是 <this person> 的 <term>": from = who, to = this person (ARCHITECTURE §2.5)
          return personApi.addRelation(fromId, { toPersonId: personId, type, ...(term.trim() ? { label: term.trim() } : {}) })
        })
        if (r) onDone()
      }}
    >
      <div className="flex flex-col gap-2 text-[14px] leading-7 text-ink-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="w-full sm:w-[220px]">
          <PersonPicker
            variant="select"
            value={who}
            onPick={setWho}
            allowSelf={selfId != null}
            allowCreate={{ defaultLabel: '' }}
            excludeIds={[personId]}
            placeholder="选择人物"
          />
        </div>
        <span className="whitespace-nowrap">是 {label} 的</span>
        <input
          aria-label="称谓"
          value={term}
          maxLength={30}
          placeholder="称谓，如 外婆"
          onChange={(e) => setTerm(e.target.value)}
          className={cn(inputCls, 'text-[14px] sm:w-[150px]')}
        />
        <select
          aria-label="关系类型"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="h-9 rounded-[2px] border border-line-strong bg-paper px-2 text-[14px] text-ink outline-none focus-visible:border-ink-2 sm:w-[120px]"
        >
          {RELATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {RELATION_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <TextButton type="submit" disabled={!ready || act.pending}>
          {act.pending ? '正在保存…' : '保存'}
        </TextButton>
        <TextButton tone="quiet" disabled={act.pending} onClick={onDone}>
          取消
        </TextButton>
      </div>
      {act.error && <InlineError message={act.error} />}
    </form>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// 经历 (events)

function EventRow({ e, personId, mark }: { e: EventDTO; personId: number; mark: number }) {
  const act = useAction()
  const proposed = e.status === 'proposed'
  const others = e.participants.filter((p) => p.id !== personId)
  const review = (action: 'accept' | 'reject') => act.run(() => personApi.review('event', e.id, { action }), { evidence: [{ type: 'event', id: e.id }] })
  return (
    <EvidenceRow
      as="li"
      id={anchorId('event', e.id)}
      className={cn(
        'grid grid-cols-1 border-l py-[3px] pl-[11px] transition-colors duration-700 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-x-4 [overflow-wrap:anywhere]',
        proposed ? 'border-proposed text-ink-2' : 'border-transparent',
        act.pending && 'opacity-60',
      )}
    >
      <span className="whitespace-nowrap font-data text-[13px] leading-[30px] tabular-nums text-ink-3">{e.happenedAt ? formatPartialDate(e.happenedAt) : '时间不详'}</span>
      <div className="loam-prose" style={{ color: 'inherit' }}>
        <span>{e.summary}</span>
        <EvidenceMark target={{ type: 'event', id: e.id }} index={mark} sourceKind={e.sourceKind} evidenceCount={e.evidenceCount} className={markClassFor(e.summary)} />
        {e.place && !e.summary.includes(e.place) && (
          <>
            <Gap size="sm" />
            <span className="text-[13px] text-ink-3">{e.place}</span>
          </>
        )}
        {others.length > 0 && (
          <span className="text-[15px] text-ink-2">
            <span className="px-2 text-ink-3" aria-hidden>
              ·
            </span>
            {others.map((p, i) => (
              <span key={p.id}>
                {i > 0 && '、'}
                <Link href={personHref(p.id)} className="loam-link">
                  {p.label}
                </Link>
              </span>
            ))}
          </span>
        )}
        {proposed && <ProposedButtons disabled={act.pending} onAccept={() => void review('accept')} onReject={() => void review('reject')} />}
        {act.error && <InlineError message={act.error} />}
      </div>
    </EvidenceRow>
  )
}

export function EventsSection({ profile, markOf }: { profile: ProfileResponse; markOf: MarkOf }) {
  if (profile.events.length === 0) return null
  return (
    <section aria-labelledby="sec-events" className="mt-12" data-block="events">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-1.5">
        <h2 id="sec-events" className="loam-section-title">
          经历
        </h2>
        <span className="text-[12px] leading-6 text-ink-3">事件 · 由近到远</span>
      </div>
      <ul className="mt-3 space-y-0.5">
        {profile.events.map((e) => (
          <EventRow key={e.id} e={e} personId={profile.person.id} mark={markOf('event', e.id)} />
        ))}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// 历史

function historyNote(c: ClaimDTO, replacement: ClaimDTO | undefined): { when: string; why: string } {
  const when = formatIsoDay(c.statusChangedAt)
  if (c.statusReason === 'outdated') return { when, why: replacement ? '标记为已过时，现在的情况是' : '标记为已过时' }
  if (c.statusReason === 'edited') return { when, why: '改写为' }
  return { when, why: replacement ? '被新的说法取代' : '被新的说法取代' }
}

export function HistorySection({
  profile,
  markOf,
  selfId,
  open,
  onOpenChange,
}: {
  profile: ProfileResponse
  markOf: MarkOf
  selfId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (profile.history.length === 0) return null
  const live = new Map<number, ClaimDTO>()
  for (const s of profile.sections) for (const c of s.claims) live.set(c.id, c)
  for (const c of profile.history) live.set(c.id, c)
  return (
    <section aria-labelledby="sec-history" className="mt-12" data-block="history">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-1.5">
        <h2 id="sec-history" className="loam-section-title">
          历史
        </h2>
        <TextButton tone="quiet" aria-expanded={open} aria-controls="history-list" onClick={() => onOpenChange(!open)}>
          {open ? '收起' : '展开'}
        </TextButton>
      </div>
      {open ? (
        <ol id="history-list" className="mt-3 space-y-2">
          {profile.history.map((c) => {
            const replacement = c.supersededByClaimId != null ? live.get(c.supersededByClaimId) : undefined
            const note = historyNote(c, replacement)
            return (
              <EvidenceRow as="li" key={c.id} id={anchorId('claim', c.id)} className="border-l border-transparent py-[3px] pl-[11px] transition-colors duration-700 [overflow-wrap:anywhere]">
                <div className="text-[15px] leading-[1.85] text-superseded">
                  <Statement text={c.statement} mentions={c.mentions} selfId={selfId} linkClassName="text-superseded underline decoration-line underline-offset-[3px] hover:decoration-line-strong" />
                  <EvidenceMark target={{ type: 'claim', id: c.id }} index={markOf('claim', c.id)} sourceKind={c.sourceKind} evidenceCount={c.evidenceCount} className={MARK_TIGHT} />
                  {c.validFrom && (
                    <>
                      <Gap size="sm" />
                      <span className="whitespace-nowrap font-data text-[12px] tabular-nums text-ink-3">{formatPartialDate(c.validFrom)}</span>
                    </>
                  )}
                </div>
                <p className="text-[12px] leading-5 text-ink-3">
                  <span className="font-data tabular-nums">{note.when}</span>
                  <span className="px-1">{note.why}</span>
                  {replacement && (
                    <a href={`#${anchorId('claim', replacement.id)}`} className="text-ink-2 underline decoration-line underline-offset-2 hover:decoration-line-strong">
                      {replacement.statement}
                    </a>
                  )}
                </p>
              </EvidenceRow>
            )
          })}
        </ol>
      ) : (
        <p id="history-list" className="mt-3 pl-[12px] text-[13px] leading-6 text-ink-3">
          被取代、标记为过时和改写之前的说法。
        </p>
      )}
    </section>
  )
}
