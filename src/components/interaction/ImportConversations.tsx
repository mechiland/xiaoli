'use client'
// SPEC §9.9「这次聊了什么」: this import's conversations. Narrative, not a review queue — no confirm buttons, no
// progress, outside the bulk-confirm range. A segment summary describes what was said that day, not a claim about a
// person, so the only edits are rewriting one in place and hiding one.
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { BlockError, Skeleton } from '@/components/loam'
import type { ConversationDTO, SegmentDTO } from '@/contracts'
import { cn } from '@/lib/cn'
import { chatHref } from '@/lib/links'
import { todayInTz } from '@/lib/time'
import Link from 'next/link'
import { importInteractionOptions, interactionApi, useAction } from './api'
import { conversationLine } from './format'
import { InlineError, Sep, TextButton, inputCls } from './ui'

const h2 = 'loam-section-title border-b border-line pb-1.5'

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="sec-import-conversations" className="mb-12" data-block="import-conversations">
      <h2 id="sec-import-conversations" className={h2}>
        这次聊了什么
      </h2>
      {children}
    </section>
  )
}

function SegmentRow({ segment }: { segment: SegmentDTO }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(segment.summary)
  const act = useAction()

  if (segment.hidden) {
    return (
      <div data-segment={segment.id} data-segment-hidden className="flex flex-wrap items-baseline gap-x-3 py-0.5 text-[13px] leading-6 text-ink-3">
        <span>已隐藏</span>
        <TextButton tone="quiet" disabled={act.pending} onClick={() => void act.run(() => interactionApi.patchSegment(segment.id, { hidden: false }))}>
          取消隐藏
        </TextButton>
        {act.error && <InlineError message={act.error} />}
      </div>
    )
  }

  if (editing) {
    return (
      <form
        data-segment={segment.id}
        className="py-1"
        onSubmit={async (e) => {
          e.preventDefault()
          const summary = value.trim()
          if (!summary) return
          const r = await act.run(() => interactionApi.patchSegment(segment.id, { summary }))
          if (r) setEditing(false)
        }}
      >
        <input
          autoFocus
          aria-label="改写这段摘要"
          maxLength={300}
          value={value}
          disabled={act.pending}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setValue(segment.summary)
              act.reset()
              setEditing(false)
            }
          }}
          className={cn(inputCls, 'text-[14px]')}
        />
        <div className="mt-1 flex items-baseline gap-3">
          <TextButton type="submit" disabled={act.pending || !value.trim()}>
            {act.pending ? '正在保存…' : '保存'}
          </TextButton>
          <TextButton
            tone="quiet"
            disabled={act.pending}
            onClick={() => {
              setValue(segment.summary)
              act.reset()
              setEditing(false)
            }}
          >
            取消
          </TextButton>
        </div>
        {act.error && <InlineError message={act.error} />}
      </form>
    )
  }

  return (
    <div data-segment={segment.id} className={cn('py-0.5', act.pending && 'opacity-60')}>
      <p className="text-[14px] leading-7 text-ink-2 [overflow-wrap:anywhere]">
        <span>{segment.summary}</span>
        <span className="whitespace-nowrap">
          <Sep />{' '}
          <Link href={chatHref(segment.chatId, segment.firstMessageId ?? undefined)} className="loam-link text-[13px]">
            在聊天中查看
          </Link>
        </span>
        {/* always visible: the import result page is where the user reviews, not a reading page */}
        <span className="inline-flex items-baseline gap-2.5 whitespace-nowrap pl-3 align-baseline">
          <TextButton tone="quiet" disabled={act.pending} onClick={() => setEditing(true)}>
            改写
          </TextButton>
          <TextButton tone="quiet" disabled={act.pending} onClick={() => void act.run(() => interactionApi.patchSegment(segment.id, { hidden: true }))}>
            隐藏
          </TextButton>
        </span>
      </p>
      {act.error && <InlineError message={act.error} />}
    </div>
  )
}

function ConversationBlock({ conversation, today, defaultOpen }: { conversation: ConversationDTO; today: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const line = conversationLine(conversation, today)
  const id = `import-conv-${conversation.chatId}-${conversation.startedAt.replace(/[^0-9]/g, '')}`
  return (
    <li className="border-b border-line last:border-b-0" data-conversation>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="w-full py-2 text-left text-[15px] leading-7 text-ink-2 transition-colors hover:text-ink">
        <span className="whitespace-nowrap font-data tabular-nums text-ink">{line.day}</span>
        {line.chatTitle && (
          <>
            <Sep />{' '}
            <span>『{line.chatTitle}』</span>
          </>
        )}
        <Sep />{' '}
        <span className="whitespace-nowrap font-data text-[13px] tabular-nums text-ink-3">{line.count}</span>
        {line.topics && (
          <>
            <Sep />{' '}
            <span>{line.topics}</span>
          </>
        )}
      </button>
      {open && (
        <div id={id} className="mb-2 space-y-1 border-l border-line-strong pl-3">
          {conversation.segments.map((s) => (
            <SegmentRow key={s.id} segment={s} />
          ))}
        </div>
      )}
    </li>
  )
}

export interface ImportConversationsViewProps {
  conversations: ConversationDTO[]
  today?: string
}

/** With data in hand (also used by the showcase). Renders null when the extraction produced no summaries. */
export function ImportConversationsView({ conversations, today = todayInTz() }: ImportConversationsViewProps) {
  if (conversations.length === 0) return null
  return (
    <Section>
      <ul data-timeline>
        {conversations.map((c, i) => (
          <ConversationBlock key={`${c.chatId}-${c.startedAt}`} conversation={c} today={today} defaultOpen={i === 0} />
        ))}
      </ul>
    </Section>
  )
}

export function ImportConversations({ importId }: { importId: number }) {
  const q = useQuery(importInteractionOptions(importId))
  if (q.isPending) {
    return (
      <Section>
        <div className="mt-3 space-y-3" aria-busy="true" aria-live="polite" data-import-conversations-skeleton>
          <Skeleton className="w-3/5" />
          <Skeleton className="w-4/5" />
          <Skeleton className="w-1/2" />
        </div>
      </Section>
    )
  }
  if (q.isError || !q.data) {
    return (
      <Section>
        <div data-import-conversations-error className="mt-3">
          <BlockError onRetry={() => void q.refetch()} message="这次聊了什么没有加载出来" />
        </div>
      </Section>
    )
  }
  return <ImportConversationsView conversations={q.data.conversations} />
}
