'use client'
// SPEC §9.5 infobox: 最后一次聊天 — the time, and under it the summary of that conversation.
// Not a bare timestamp: "9月13日 · 3 天前", then what that conversation was about. Clicking the summary opens the
// whole conversation, each segment linking into the chat transcript. With no summary, only the time is shown.
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { ConversationDTO, MsgTime } from '@/contracts'
import { todayInTz } from '@/lib/time'
import { personInteractionOptions } from './api'
import { agoLabel, formatDay } from './format'
import { SegmentSummary } from './Timeline'
import { Sep, TextButton } from './ui'

function daysBetweenDays(a: string, b: string): number {
  const pa = a.split('-').map(Number)
  const pb = b.split('-').map(Number)
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86_400_000)
}

export interface LastContactViewProps {
  lastContactAt: MsgTime
  conversation?: ConversationDTO | null
  today?: string
}

export function LastContactView({ lastContactAt, conversation, today = todayInTz() }: LastContactViewProps) {
  const [open, setOpen] = useState(false)
  const day = lastContactAt.slice(0, 10)
  const ago = agoLabel(Math.max(0, daysBetweenDays(day, today)))
  const summary = conversation?.segments[0]?.summary ?? null
  const more = (conversation?.segments.length ?? 0) > 1

  return (
    <div data-last-contact>
      <span className="whitespace-nowrap font-data tabular-nums">{formatDay(day, today)}</span>
      <Sep />{' '}
      <span className="whitespace-nowrap font-data text-[13px] tabular-nums text-ink-3">{ago}</span>
      {summary && !open && (
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setOpen(true)}
          title={summary}
          // SPEC §9.5: 下面一行小字 — one line in the infobox; the whole conversation opens on click
          className="mt-0.5 block w-full truncate text-left text-[13px] leading-6 text-ink-3 transition-colors hover:text-ink-2"
        >
          {summary}
        </button>
      )}
      {summary && open && conversation && (
        <div className="mt-1 space-y-1.5 border-l border-line-strong pl-2.5">
          {conversation.segments.map((s) => (
            <SegmentSummary key={s.id} segment={s} className="text-[13px] leading-6" />
          ))}
          <TextButton tone="quiet" onClick={() => setOpen(false)}>
            收起
          </TextButton>
        </div>
      )}
      {summary && !open && more && <span className="sr-only">点击展开这次来往的全部段落</span>}
    </div>
  )
}

export function LastContactLine({ personId, lastContactAt }: { personId: number; lastContactAt: MsgTime | null }) {
  // shares the person page's interaction request (same key, same page size)
  const q = useQuery({ ...personInteractionOptions(personId), enabled: lastContactAt !== null })
  if (!lastContactAt) return null
  const conversation = q.data?.conversations[0] ?? null
  // only the newest conversation can hold the last contact; a stale one would be a lie, so it is left out
  const usable = conversation && conversation.endedAt.slice(0, 10) >= lastContactAt.slice(0, 10) ? conversation : null
  return <LastContactView lastContactAt={lastContactAt} conversation={usable} />
}
