'use client'
// SPEC §9.5「来往」: rhythm, open loops, and the conversation timeline. Mounted by the person page.
//
// What is deliberately NOT here (SPEC §9.3): no counts or badges, no red dots, no "好久没联系" nudge, no global list,
// no reordering of expired items, and no 补充 affordance — this section describes conversations that already happened.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { BlockError, Skeleton } from '@/components/loam'
import type { InteractionResponse } from '@/contracts'
import { cn } from '@/lib/cn'
import { todayInTz } from '@/lib/time'
import { DEFAULT_TIMELINE, personInteractionOptions } from './api'
import { rhythmSentence } from './format'
import { LoopRow } from './LoopRow'
import { Timeline } from './Timeline'

const h2 = 'loam-section-title border-b border-line pb-1.5'
const h3 = 'mb-1.5 font-serif text-[14px] font-semibold tracking-[0.04em] text-ink-2'

function Section({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby="sec-interaction" className={cn('mt-12', className)} data-block="interaction">
      <h2 id="sec-interaction" className={h2}>
        来往
      </h2>
      {children}
    </section>
  )
}

export interface InteractionSectionViewProps {
  data: InteractionResponse
  /** the person this section is about — the loop sentences are written around their name */
  personLabel: string
  today?: string
  /** first footnote number for the loops; the person page continues its page-scoped numbering here */
  markStart?: number
  hasMore?: boolean
  onMore?: () => void
  busy?: boolean
}

/** The section with data in hand (also used by the showcase). Returns null when all three blocks are empty. */
export function InteractionSectionView({ data, personLabel, today = todayInTz(), markStart = 1, hasMore, onMore, busy }: InteractionSectionViewProps) {
  const rhythm = rhythmSentence(data.rhythm, today)
  if (!rhythm && data.loops.length === 0 && data.conversations.length === 0) return null

  return (
    <Section>
      {rhythm && (
        <p data-rhythm className="loam-prose mt-3 text-ink-2">
          {rhythm}
        </p>
      )}

      {data.loops.length > 0 && (
        <div data-loops className={cn(rhythm ? 'mt-7' : 'mt-4')}>
          <h3 className={h3}>未结事项</h3>
          <ul className="space-y-0.5">
            {data.loops.map((l, i) => (
              <LoopRow key={l.id} loop={l} mark={markStart + i} today={today} personLabel={personLabel} />
            ))}
          </ul>
        </div>
      )}

      {data.conversations.length > 0 && (
        <div data-conversations className={cn(rhythm || data.loops.length > 0 ? 'mt-7' : 'mt-4')}>
          <h3 className={h3}>来往时间线</h3>
          <Timeline conversations={data.conversations} today={today} hasMore={hasMore} onMore={onMore} busy={busy} />
        </div>
      )}
    </Section>
  )
}

export function InteractionSectionSkeleton() {
  return (
    <Section>
      <div className="mt-4 space-y-3" aria-busy="true" aria-live="polite" data-interaction-skeleton>
        <Skeleton className="w-4/5" />
        <Skeleton className="w-2/3" />
        <Skeleton className="w-3/4" />
      </div>
    </Section>
  )
}

export function InteractionSection({ personId, personLabel, markStart = 1 }: { personId: number; personLabel: string; markStart?: number }) {
  const [expanded, setExpanded] = useState(false)
  const q = useQuery({
    ...personInteractionOptions(personId, expanded ? 'all' : DEFAULT_TIMELINE),
    placeholderData: keepPreviousData,
  })

  if (q.isPending) return <InteractionSectionSkeleton />
  if (q.isError || !q.data) {
    return (
      <Section>
        <div data-interaction-error className="mt-3">
          <BlockError onRetry={() => void q.refetch()} message="来往没有加载出来" />
        </div>
      </Section>
    )
  }

  return (
    <InteractionSectionView
      data={q.data}
      personLabel={personLabel}
      markStart={markStart}
      hasMore={q.data.hasMore}
      onMore={() => setExpanded(true)}
      busy={q.isFetching}
    />
  )
}
