'use client'
// 来往时间线 (SPEC §9.5): conversations newest first, five at a time, each expanding into its segment summaries.
import Link from 'next/link'
import { useState } from 'react'
import type { ConversationDTO, SegmentDTO } from '@/contracts'
import { cn } from '@/lib/cn'
import { chatHref } from '@/lib/links'
import { conversationLine } from './format'
import { Sep, TextButton } from './ui'

export function SegmentSummary({ segment, className }: { segment: SegmentDTO; className?: string }) {
  return (
    <p className={cn('text-[14px] leading-7 text-ink-2 [overflow-wrap:anywhere]', className)}>
      <span>{segment.summary}</span>
      <span className="whitespace-nowrap">
        <Sep />{' '}
        <Link href={chatHref(segment.chatId, segment.firstMessageId ?? undefined)} className="loam-link text-[13px]">
          在聊天中查看
        </Link>
      </span>
    </p>
  )
}

export function ConversationRow({ conversation, today, defaultOpen = false }: { conversation: ConversationDTO; today: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const line = conversationLine(conversation, today)
  const id = `conv-${conversation.chatId}-${conversation.startedAt.replace(/[^0-9]/g, '')}`

  return (
    <li className="border-b border-line last:border-b-0" data-conversation>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="w-full py-2 text-left text-[15px] leading-7 text-ink-2 transition-colors hover:text-ink"
      >
        <span className="whitespace-nowrap font-data tabular-nums text-ink">{line.day}</span>
        {line.chatTitle && (
          <>
            <Sep />{' '}
            <span className="text-ink-2">『{line.chatTitle}』</span>
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
        <div id={id} className="mb-2 space-y-1.5 border-l border-line-strong pl-3">
          {conversation.segments.map((s) => (
            <SegmentSummary key={s.id} segment={s} />
          ))}
        </div>
      )}
    </li>
  )
}

export function Timeline({
  conversations,
  today,
  hasMore,
  onMore,
  moreLabel = '更早',
  busy,
}: {
  conversations: ConversationDTO[]
  today: string
  hasMore?: boolean
  onMore?: () => void
  moreLabel?: string
  busy?: boolean
}) {
  return (
    <>
      <ul data-timeline>
        {conversations.map((c) => (
          <ConversationRow key={`${c.chatId}-${c.startedAt}`} conversation={c} today={today} />
        ))}
      </ul>
      {hasMore && onMore && (
        <div className="mt-1.5">
          <TextButton tone="quiet" disabled={busy} onClick={onMore}>
            {busy ? '正在读取…' : moreLabel}
          </TextButton>
        </div>
      )}
    </>
  )
}
