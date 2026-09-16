'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BlockBoundary, BlockError, PageShell, PageTitle } from '@/components/loam'
import type { ProfileResponse } from '@/contracts'
import { ApiClientError } from '@/lib/api-client'
import { homeHref, personHref } from '@/lib/links'
import { personQueryOptions } from './api'
import { useAnchorHighlight, type AnchorTarget } from './anchor'
import { InteractionSection } from '@/components/interaction'
import { BodySections, EventsSection, HistorySection, RelationsSection } from './Body'
import { PersonHeader } from './Header'
import { Infobox } from './Infobox'
import { PersonSkeleton } from './PersonSkeleton'

type MarkType = 'claim' | 'relation' | 'date' | 'event' | 'handle'

/** A page-scoped footnote numberer; `count` is how many numbers it handed out. */
export type MarkFn = ((type: MarkType, id: number) => number) & { count: number }

/**
 * Page-scoped footnote numbers, in reading order: infobox, body, relations, events, history, aliases.
 *
 * `count` lets a section that loads its own data continue the sequence instead of restarting at ¹ — the 「来往」
 * section (SPEC §9.5) fetches separately, so it gets `markStart = markOf.count + 1` and its loops are numbered
 * after everything the profile knows about. That puts loop numbers after 历史 and 别名 rather than strictly where
 * the section sits on the page, which is the same pragmatic order this function already uses for 别名 (rendered in
 * the header, numbered last). Core-request interaction#3.
 */
export function numberMarks(p: ProfileResponse): MarkFn {
  const m = new Map<string, number>()
  let n = 0
  const add = (type: MarkType, id: number) => {
    const k = `${type}:${id}`
    if (!m.has(k)) m.set(k, ++n)
  }
  const i = p.infobox
  if (i.relationToMe) add('relation', i.relationToMe.relationId)
  for (const f of [i.city, i.work, i.school]) if (f) add('claim', f.claimId)
  if (i.birthday) add('date', i.birthday.id)
  for (const d of i.otherDates) add('date', d.id)
  for (const s of p.sections) for (const c of s.claims) add('claim', c.id)
  for (const r of p.relations) add('relation', r.id)
  for (const e of p.events) add('event', e.id)
  for (const c of p.history) add('claim', c.id)
  for (const g of p.aliases) for (const h of g.items) add('handle', h.id)
  const fn = ((type: MarkType, id: number) => m.get(`${type}:${id}`) ?? 0) as MarkFn
  fn.count = n
  return fn
}

const NO_MARKS: MarkFn = Object.assign(() => 0, { count: 0 })

function BlockFallback({ title }: { title: string }) {
  return (retry: () => void) => <BlockError onRetry={retry} message={`${title}没有显示出来`} />
}

export function PersonView({ id, selfId }: { id: number; selfId: number | null }) {
  const router = useRouter()
  const q = useQuery(personQueryOptions(id))
  const [historyOpen, setHistoryOpen] = useState(false)
  const [aliasesOpen, setAliasesOpen] = useState(false)
  const [infoboxOpen, setInfoboxOpen] = useState(false)

  const data = q.data
  const redirectTo = data && 'redirectTo' in data ? data.redirectTo : null
  const profile = data && 'person' in data ? data : null

  useEffect(() => {
    if (redirectTo != null) router.replace(`${personHref(redirectTo)}${window.location.hash}`)
  }, [redirectTo, router])

  const expand = useCallback(
    (t: AnchorTarget) => {
      if (!profile) return
      if (t.type === 'handle') setAliasesOpen(true)
      if (t.type === 'date') setInfoboxOpen(true)
      if (t.type === 'claim' && profile.history.some((c) => c.id === t.id)) setHistoryOpen(true)
    },
    [profile],
  )
  useAnchorHighlight(expand, profile !== null)

  const markOf = useMemo(() => (profile ? numberMarks(profile) : NO_MARKS), [profile])

  if (q.isPending || redirectTo != null) {
    return (
      <PageShell>
        <PersonSkeleton />
      </PageShell>
    )
  }

  if (q.isError && !profile) {
    if (q.error instanceof ApiClientError && q.error.status === 404) return <PersonNotFound />
    const retry = () => void q.refetch()
    return (
      <PageShell>
        <div data-person-error className="mb-8 border-b border-line pb-5">
          <PageTitle className="text-ink-3">人物</PageTitle>
          <BlockError className="mt-3" onRetry={retry} message="标题和别名没有加载出来" />
        </div>
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_308px] lg:items-start lg:gap-14">
          <div className="mb-8 border border-line bg-paper px-4 py-3 lg:order-2 lg:mb-0">
            <BlockError onRetry={retry} message="信息框没有加载出来" className="border-l-0 pl-0" />
          </div>
          <div className="min-w-0 lg:order-1">
            <BlockError onRetry={retry} message="正文没有加载出来" />
          </div>
        </div>
      </PageShell>
    )
  }

  const p = profile!
  return (
    <PageShell>
      <article data-person-id={p.person.id}>
        <BlockBoundary fallback={BlockFallback({ title: '标题' })}>
          <PersonHeader profile={p} markOf={markOf} aliasesOpen={aliasesOpen} onAliasesOpenChange={setAliasesOpen} />
        </BlockBoundary>
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_308px] lg:items-start lg:gap-14">
          <div className="mb-9 lg:order-2 lg:mb-0">
            <BlockBoundary fallback={BlockFallback({ title: '信息框' })}>
              <Infobox profile={p} markOf={markOf} open={infoboxOpen} onOpenChange={setInfoboxOpen} />
            </BlockBoundary>
          </div>
          <div className="min-w-0 lg:order-1">
            <BlockBoundary fallback={BlockFallback({ title: '正文' })}>
              <BodySections profile={p} markOf={markOf} selfId={selfId} />
            </BlockBoundary>
            <BlockBoundary fallback={BlockFallback({ title: '关系' })}>
              <RelationsSection profile={p} markOf={markOf} selfId={selfId} />
            </BlockBoundary>
            <BlockBoundary fallback={BlockFallback({ title: '经历' })}>
              <EventsSection profile={p} markOf={markOf} />
            </BlockBoundary>
            {/* SPEC §9.5「来往」 — interaction module; it fetches its own data and renders nothing when empty. */}
            <BlockBoundary fallback={BlockFallback({ title: '来往' })}>
              <InteractionSection personId={p.person.id} personLabel={p.person.label} markStart={markOf.count + 1} />
            </BlockBoundary>
            <BlockBoundary fallback={BlockFallback({ title: '历史' })}>
              <HistorySection profile={p} markOf={markOf} selfId={selfId} open={historyOpen} onOpenChange={setHistoryOpen} />
            </BlockBoundary>
          </div>
        </div>
      </article>
    </PageShell>
  )
}

export function PersonNotFound() {
  return (
    <PageShell width="reading">
      <div data-person-not-found className="border-b border-line pb-5">
        <PageTitle>没有找到这个人物</PageTitle>
      </div>
      <p className="loam-prose mt-6 text-ink-2">可能已经被删除，或者链接不对。</p>
      <p className="mt-4 text-[14px]">
        <Link href={homeHref} className="loam-link">
          回到首页
        </Link>
      </p>
    </PageShell>
  )
}
