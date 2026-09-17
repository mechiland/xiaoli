'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import type { HomeResponse } from '@/contracts'
import { BlockBoundary, BlockError, PageShell, Skeleton } from '@/components/loam'
import { SearchTrigger } from '@/components/search-overlay'
import { api, unwrap } from '@/lib/api-client'
import { cn } from '@/lib/cn'
import { importHref, personHref } from '@/lib/links'
import { queryKeys } from '@/lib/query'
import type { HomeBlocks, HomeBlocksResult } from '@/server/home'
import { EmptyHome } from './EmptyHome'
import { formatImportedAt, formatRange, formatTodayLine } from './format'
import { TasksPanel } from './TasksPanel'

/** "全部人物" collapses to letter navigation only when there are MORE than this many people (SPEC §9.4). */
export const INDEX_COLLAPSE_ABOVE = 200
const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#']

type Slot<T> = { state: 'ready'; data: T } | { state: 'loading' } | { state: 'error'; retry: () => void }

const nameLink = 'text-ink decoration-line-strong decoration-1 underline-offset-[5px] hover:underline'

export interface HomeViewProps {
  /** server first paint; blocks that failed on the server are null and listed in `failed` */
  initial: HomeBlocksResult
  tz: string
  view?: 'home' | 'people' | 'tasks'
  taskRange?: 7 | 30
}

/**
 * Home page (SPEC §9.4, §9.12). Blocks render from server data; a block whose server fetch failed falls back to
 * `GET /api/home` on the client (skeleton while loading, BlockError with retry on failure), without touching the others.
 */
export function HomeView({ initial, tz, view = 'home', taskRange = 7 }: HomeViewProps) {
  const needsFallback = initial.failed.some((k) => k !== 'onboarding')
  const q = useQuery<HomeResponse>({
    queryKey: queryKeys.home(),
    queryFn: async () => unwrap(await api.home.$get()),
    initialData: !needsFallback && Object.values(initial.blocks).every((block) => block !== null)
      ? { ...initial.blocks, isEmpty: initial.isEmpty, needsOnboarding: initial.needsOnboarding } as HomeResponse
      : undefined,
    staleTime: 30_000,
  })

  function slot<K extends keyof HomeBlocks>(key: K): Slot<HomeResponse[K]> {
    if (q.data) return { state: 'ready', data: q.data[key] }
    const server = initial.blocks[key]
    if (server !== null) return { state: 'ready', data: server as HomeResponse[K] }
    if (q.isError && !q.isFetching) return { state: 'error', retry: () => void q.refetch() }
    return { state: 'loading' }
  }

  const isEmpty = q.data?.isEmpty ?? initial.isEmpty
  const needsOnboarding = q.data?.needsOnboarding ?? initial.needsOnboarding
  if (view === 'tasks') return (
    <PageShell title="事项" subtitle="把重要的日子、约定和待办放在一起。" className="max-w-[880px]">
      <SlotView slot={slot('upcoming')} skeleton={<RowsSkeleton rows={4} />}>
        {(rows) => <TasksPanel key={taskRange} rows={rows} today={initial.today} initialDays={taskRange} />}
      </SlotView>
    </PageShell>
  )
  if (view === 'people') return (
    <PageShell title="人物" className="max-w-[1000px]">
      <div className="mb-10"><SearchTrigger variant="hero" /></div>
      <div className="space-y-12">
        <PinnedSection slot={slot('pinned')} />
        <PeopleIndexSection slot={slot('index')} />
      </div>
    </PageShell>
  )
  if (isEmpty) return <EmptyHome needsOnboarding={needsOnboarding} />

  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 pb-20 sm:px-8">
      <h1 className="sr-only">小丽主页</h1>
      <section
        aria-label="搜索"
        className="flex flex-col items-center pb-12 pt-12 sm:pb-14 sm:pt-16"
      >
        <p className="mb-5 font-data text-[13px] tracking-[0.06em] text-ink-3">{formatTodayLine(initial.today)}</p>
        <SearchTrigger variant="hero" className="max-w-[680px]" />
      </section>

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
        <aside aria-label="事项" className="min-w-0 border border-line bg-paper p-5 lg:col-start-2 lg:row-start-1 lg:p-6">
          <BlockBoundary fallback={(retry) => <><Heading>事项</Heading><BlockError className="mt-4" onRetry={retry} /></>}>
            {slot('upcoming').state !== 'ready' && <Heading>事项</Heading>}
            <SlotView slot={slot('upcoming')} skeleton={<RowsSkeleton rows={3} />}>
              {(rows) => <TasksPanel rows={rows} today={initial.today} compact />}
            </SlotView>
          </BlockBoundary>
        </aside>
        <div className="min-w-0 space-y-12 lg:col-start-1 lg:row-start-1">
          <RecentlyUpdatedSection slot={slot('recentlyUpdated')} />
          <PinnedSection slot={slot('pinned')} />
          <PeopleIndexSection slot={slot('index')} />
          <RecentImportsSection slot={slot('recentImports')} today={initial.today} tz={tz} />
        </div>
      </div>
    </div>
  )
}

function Heading({ children, small }: { children: ReactNode; small?: boolean }) {
  if (small) return <h2 className="mb-2 font-serif text-[14px] font-semibold tracking-[0.04em] text-ink-2">{children}</h2>
  return <h2 className="loam-section-title border-b border-line pb-2">{children}</h2>
}

function HomeSection({ title, small, className, children }: { title: string; small?: boolean; className?: string; children: ReactNode }) {
  return (
    <BlockBoundary
      className={className}
      fallback={(retry) => (
        <>
          <Heading small={small}>{title}</Heading>
          <BlockError className="mt-4" onRetry={retry} />
        </>
      )}
    >
      <Heading small={small}>{title}</Heading>
      {children}
    </BlockBoundary>
  )
}

function SlotView<T>({ slot, skeleton, children }: { slot: Slot<T>; skeleton: ReactNode; children: (data: T) => ReactNode }) {
  if (slot.state === 'ready') return <>{children(slot.data)}</>
  if (slot.state === 'error') return <BlockError className="mt-4" onRetry={slot.retry} />
  return (
    <div aria-busy="true" aria-live="polite" data-home-loading className="mt-1">
      {skeleton}
    </div>
  )
}

function RowsSkeleton({ rows, widths = ['w-2/5', 'w-1/2', 'w-1/3'] }: { rows: number; widths?: string[] }) {
  return (
    <div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-6 border-b border-line py-[18px]">
          <Skeleton className={cn('h-3.5', widths[i % widths.length])} />
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  )
}

/**
 * A " ·" separator glued to the end of the piece before it: a no-break space keeps the line from breaking before the
 * dot, and the ordinary space the caller puts after it is the break point. A wrapped line may end with "·" but never
 * starts with one (same rule as person P15; DECISIONS home H11).
 */
function Sep({ className }: { className?: string }) {
  return (
    <span data-home-sep aria-hidden className={cn('px-0.5 text-ink-3', className)}>
      {'\u00A0·'}
    </span>
  )
}

/* ── 最近有新信息的人 ─────────────────────────────────────────────────── */

function RecentlyUpdatedSection({ slot }: { slot: Slot<HomeResponse['recentlyUpdated']> }) {
  if (slot.state === 'ready' && slot.data.length === 0) return null
  return (
    <HomeSection title="最近有新信息的人">
      <SlotView slot={slot} skeleton={<RowsSkeleton rows={4} widths={['w-3/5', 'w-2/3', 'w-1/2']} />}>
        {(rows) => (
          <ul>
            {rows.map((r) => (
              <li key={r.person.id} className="grid gap-x-8 gap-y-0 border-b border-line py-2.5 sm:grid-cols-[10.5rem_minmax(0,1fr)]">
                <Link href={personHref(r.person.id)} title={r.person.label} className={cn(nameLink, 'min-w-0 text-[15px] leading-7 sm:truncate')}>
                  {r.person.label}
                </Link>
                <Link
                  href={personHref(r.person.id, { type: 'claim', id: r.latest.id })}
                  title={r.latest.statement}
                  className="min-w-0 text-[14px] leading-7 text-ink-2 decoration-line-strong underline-offset-[5px] hover:text-ink hover:underline sm:truncate"
                >
                  {r.latest.statement}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SlotView>
    </HomeSection>
  )
}

/* ── 关注的人 ─────────────────────────────────────────────────────────── */

function PinnedSection({ slot }: { slot: Slot<HomeResponse['pinned']> }) {
  return (
    <HomeSection title="关注的人">
      <SlotView
        slot={slot}
        skeleton={
          <div className="flex flex-wrap gap-x-6 gap-y-3 pt-4">
            {['w-14', 'w-12', 'w-16', 'w-12', 'w-14'].map((w, i) => (
              <Skeleton key={i} className={cn('h-3.5', w)} />
            ))}
          </div>
        }
      >
        {(people) =>
          people.length === 0 ? (
            <p className="pt-3 text-[14px] leading-7 text-ink-3">在人物页上打开「关注」，这个人就会出现在这里。</p>
          ) : (
            <ul className="flex flex-wrap gap-x-6 gap-y-1 pt-3 text-[15px] leading-8">
              {people.map((p) => (
                <li key={p.id} className="min-w-0 max-w-full">
                  <Link href={personHref(p.id)} className={nameLink}>
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          )
        }
      </SlotView>
    </HomeSection>
  )
}

/* ── 全部人物 ─────────────────────────────────────────────────────────── */

const groupDomId = (letter: string) => `people-${letter === '#' ? 'other' : letter}`

function PeopleIndexSection({ slot }: { slot: Slot<HomeResponse['index']> }) {
  return (
    <HomeSection title="全部人物">
      <SlotView
        slot={slot}
        skeleton={
          <div className="pt-4">
            <Skeleton className="h-3.5 w-full max-w-[560px]" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid grid-cols-[2rem_1fr] gap-x-4 border-t border-line py-4 first:mt-4">
                <Skeleton className="h-3.5 w-3" />
                <Skeleton className={cn('h-3.5', ['w-4/5', 'w-3/5', 'w-2/3'][i])} />
              </div>
            ))}
          </div>
        }
      >
        {(index) =>
          index.total === 0 ? (
            <p className="pt-3 text-[14px] leading-7 text-ink-3">还没有人物。</p>
          ) : index.total > INDEX_COLLAPSE_ABOVE ? (
            <CollapsedIndex index={index} />
          ) : (
            <FullIndex index={index} />
          )
        }
      </SlotView>
    </HomeSection>
  )
}

function LetterCell({ letter, present, children }: { letter: string; present: boolean; children?: ReactNode }) {
  if (!present)
    return (
      <span aria-hidden className="inline-flex h-8 min-w-7 items-center justify-center font-data text-[13px] text-line-strong">
        {letter}
      </span>
    )
  return <>{children}</>
}

const letterClass =
  'inline-flex h-8 min-w-7 items-center justify-center font-data text-[13px] text-ink-2 transition-colors hover:bg-paper-hover hover:text-ink'

function IndexGroup({ group }: { group: HomeResponse['index']['groups'][number] }) {
  return (
    <section
      id={groupDomId(group.letter)}
      aria-label={group.letter === '#' ? '其他' : group.letter}
      className="grid scroll-mt-[calc(var(--loam-topbar-height)+16px)] grid-cols-[2rem_minmax(0,1fr)] gap-x-4 border-t border-line py-3"
    >
      <h3 className="font-data text-[13px] font-medium leading-8 tracking-normal text-ink-3">{group.letter}</h3>
      <ul className="flex min-w-0 flex-wrap gap-x-6 gap-y-0 text-[15px] leading-8">
        {group.people.map((p) => (
          <li key={p.id} className="min-w-0 max-w-full">
            <Link href={personHref(p.id)} className={nameLink}>
              {p.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function FullIndex({ index }: { index: HomeResponse['index'] }) {
  const present = new Set(index.groups.map((g) => g.letter))
  return (
    <div>
      <nav aria-label="按首字母跳转" className="-ml-2 flex flex-wrap pb-2 pt-3">
        {LETTERS.map((l) => (
          <LetterCell key={l} letter={l} present={present.has(l)}>
            <a href={`#${groupDomId(l)}`} className={letterClass}>
              {l}
            </a>
          </LetterCell>
        ))}
      </nav>
      {index.groups.map((g) => (
        <IndexGroup key={g.letter} group={g} />
      ))}
    </div>
  )
}

function CollapsedIndex({ index }: { index: HomeResponse['index'] }) {
  const [open, setOpen] = useState<string | null>(null)
  const present = new Set(index.groups.map((g) => g.letter))
  const group = index.groups.find((g) => g.letter === open)
  return (
    <div data-index-collapsed>
      <nav aria-label="按首字母查看" className="-ml-2 flex flex-wrap pb-2 pt-3">
        {LETTERS.map((l) => (
          <LetterCell key={l} letter={l} present={present.has(l)}>
            <button
              type="button"
              aria-pressed={open === l}
              onClick={() => setOpen(open === l ? null : l)}
              className={cn(letterClass, open === l && 'bg-highlight text-ink')}
            >
              {l}
            </button>
          </LetterCell>
        ))}
      </nav>
      {group ? <IndexGroup group={group} /> : <p className="border-t border-line pt-3 text-[14px] leading-7 text-ink-3">人物较多，选一个字母查看。</p>}
    </div>
  )
}

/* ── 最近导入 ─────────────────────────────────────────────────────────── */

function RecentImportsSection({ slot, today, tz }: { slot: Slot<HomeResponse['recentImports']>; today: string; tz: string }) {
  if (slot.state === 'ready' && slot.data.length === 0) return null
  return (
    <HomeSection title="最近导入" small className="!mt-20 border-t border-line pt-6">
      <SlotView
        slot={slot}
        skeleton={
          <div className="space-y-3 pt-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        }
      >
        {(rows) => (
          <ul className="text-[13px] leading-7 text-ink-3">
            {rows.map((r) => {
              const range = formatRange(r.dateFrom, r.dateTo)
              return (
                <li key={r.id} className="min-w-0">
                  <Link href={importHref(r.id)} className="text-ink-2 decoration-line-strong underline-offset-4 hover:text-ink hover:underline">
                    {r.chatTitle ?? '未命名的聊天'}
                  </Link>
                  <Sep />{' '}
                  {range && (
                    <>
                      <span className="whitespace-nowrap font-data tabular-nums">{range}</span>
                      <Sep />{' '}
                    </>
                  )}
                  <span className="whitespace-nowrap font-data tabular-nums">{formatImportedAt(r.createdAt, today, tz)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </SlotView>
    </HomeSection>
  )
}
