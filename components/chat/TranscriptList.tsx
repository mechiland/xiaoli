'use client'
// Read-only transcript rows: 时间 | 发送者 | 正文, left-aligned, consecutive messages of one sender share the time
// and name (SPEC §9.10). Every row uses the same three fixed columns, so wrapped lines, continuation messages and
// every run hang at one body edge down the whole transcript (long names wrap inside the sender column).
// Presentational; data and scrolling live in Transcript.
// DECISIONS chat C4, C9. Owner: chat.
import Link from 'next/link'
import { forwardRef, memo, useMemo } from 'react'
import type { AttachmentDTO, MessageDTO } from '@/contracts'
import { cn } from '@/lib/cn'
import { personHref } from '@/lib/links'
import { formatMsgTime } from '@/lib/time'
import { formatDay, groupTranscript } from './grouping'
import { messageParts } from './MessageBody'

export interface TranscriptListProps {
  messages: MessageDTO[]
  highlightId?: number | null
  onOpenImage: (att: AttachmentDTO, message: MessageDTO) => void
}

export const TranscriptList = forwardRef<HTMLDivElement, TranscriptListProps>(function TranscriptList({ messages, highlightId, onOpenImage }, ref) {
  const days = useMemo(() => groupTranscript(messages), [messages])
  // raw display name → person label, from the loaded window; used for the quoted line's name (DECISIONS chat C9)
  const labels = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of messages) if (m.senderLabel && !map.has(m.senderName)) map.set(m.senderName, m.senderLabel)
    return map
  }, [messages])
  return (
    <div ref={ref} data-chat-transcript className="[overflow-anchor:none]">
      {days.map((d, i) => (
        <section key={d.day} aria-label={formatDay(d.day)} className={cn(i > 0 && 'mt-7')}>
          <h2 className="mb-2 flex items-center gap-3 font-data text-[12px] leading-5 font-normal tracking-wide text-ink-3">
            <span className="shrink-0">{formatDay(d.day)}</span>
            <span aria-hidden className="h-px flex-1 bg-line" />
          </h2>
          {d.runs.map((run) => (
            <ol key={run.key} className="mt-1.5">
              {run.messages.map((m, j) => (
                <Row
                  key={m.id}
                  m={m}
                  first={j === 0}
                  highlight={m.id === highlightId}
                  quotedLabel={m.kind === 'quote' && m.meta?.quoted ? (labels.get(m.meta.quoted.senderName) ?? null) : null}
                  onOpenImage={onOpenImage}
                />
              ))}
            </ol>
          ))}
        </section>
      ))}
    </div>
  )
})

const Row = memo(function Row({
  m,
  first,
  highlight,
  quotedLabel,
  onOpenImage,
}: {
  m: MessageDTO
  first: boolean
  highlight: boolean
  quotedLabel: string | null
  onOpenImage: (att: AttachmentDTO, message: MessageDTO) => void
}) {
  const { inline, block } = messageParts(m, (att) => onOpenImage(att, m), { quotedLabel })
  // a system line ("x 加入了群聊") names its own subject: no sender prefix, the text starts in the sender column
  const system = m.kind === 'system'
  return (
    <li
      id={`message-${m.id}`}
      data-message-id={m.id}
      data-highlight-message={highlight || undefined}
      data-run-start={first || undefined}
      // focusable by tap so a continuation row can reveal its time on touch screens
      tabIndex={-1}
      className={cn(
        'group -mx-2 grid grid-cols-[2.6rem_4rem_minmax(0,1fr)] gap-x-2.5 rounded-[2px] px-2 py-[2px] outline-none sm:-mx-3 sm:grid-cols-[3rem_5.5rem_minmax(0,1fr)] sm:gap-x-3 sm:px-3',
        highlight && 'bg-highlight',
      )}
    >
      <time
        dateTime={m.sentAt.replace(' ', 'T')}
        title={formatMsgTime(m.sentAt, 'full')}
        className={cn(
          'pt-[3px] font-data text-[12px] leading-[21px] tabular-nums text-ink-3 select-none',
          !first && !highlight && 'opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100 group-focus-within:opacity-100',
        )}
      >
        {formatMsgTime(m.sentAt, 'short')}
      </time>
      {!system && (
        // one line with an ellipsis at rest (title = full name); tapping/focusing the row lets the name wrap in full
        <div
          data-sender-cell
          className="min-w-0 truncate pt-px text-[14px] leading-[26px] group-focus:whitespace-normal group-focus:[overflow-wrap:anywhere] group-focus-within:whitespace-normal group-focus-within:[overflow-wrap:anywhere]"
        >
          {first && <Sender m={m} />}
        </div>
      )}
      <div className={cn('min-w-0 text-[15px] leading-[27px] text-ink [overflow-wrap:anywhere]', system && 'col-span-2')}>
        {inline && <div>{inline}</div>}
        {block && <div className={cn(inline ? 'mt-1 mb-0.5' : 'my-1')}>{block}</div>}
      </div>
    </li>
  )
})

function Sender({ m }: { m: MessageDTO }) {
  if (m.senderPersonId != null) {
    return (
      <Link
        href={personHref(m.senderPersonId)}
        data-sender-link
        title={m.senderLabel ?? m.senderName}
        className="text-ink-2 underline decoration-transparent underline-offset-[3px] transition-colors hover:text-ink hover:decoration-line-strong"
      >
        {m.senderLabel ?? m.senderName}
      </Link>
    )
  }
  return (
    <span data-sender-unlinked className="text-ink-3" title={`${m.senderName}（没有关联到人物）`}>
      {m.senderName}
    </span>
  )
}
