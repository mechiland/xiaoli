'use client'
// Chat page header: name, type, participants, import records, "导入新的记录" (SPEC §9.10). Owner: chat.
import Link from 'next/link'
import { Fragment, useState } from 'react'
import { useImportOverlay } from '@/components/import-overlay'
import { BlockError, Data, Meta, PageTitle, Skeleton } from '@/components/loam'
import { Button } from '@/components/ui/button'
import type { ChatDetailResponse } from '@/contracts'
import { importHref, personHref } from '@/lib/links'
import { formatMsgTime } from '@/lib/time'

const PARTICIPANTS_COLLAPSED = 12

export function formatRange(from: string | null, to: string | null): string {
  const a = from ? formatMsgTime(from, 'date') : null
  const b = to ? formatMsgTime(to, 'date') : null
  if (a && b) return a === b ? a : `${a} – ${b}`
  return a ?? b ?? '时间不详'
}

const Dot = () => (
  <span aria-hidden className="px-1.5 text-ink-3">
    ·
  </span>
)

function ImportButton({ chatId }: { chatId: number }) {
  const overlay = useImportOverlay()
  return (
    <Button variant="outline" size="sm" className="shrink-0" onClick={() => overlay.open({ chatId })}>
      导入新的记录
    </Button>
  )
}

export function ChatHeaderView({ detail, action }: { detail: ChatDetailResponse; action?: React.ReactNode }) {
  const { chat, participants, imports } = detail
  const [allPeople, setAllPeople] = useState(false)
  const firstDate = imports.reduce<string | null>((min, i) => (i.dateFrom && (!min || i.dateFrom < min) ? i.dateFrom : min), null)
  const shown = allPeople ? participants : participants.slice(0, PARTICIPANTS_COLLAPSED)
  const hidden = participants.length - shown.length

  return (
    <header data-chat-header className="mb-9 border-b border-line pb-6">
      {/* phone: flex-wrap + the title block's max-content basis — a short title keeps the button beside it, a long one
          takes the full row and the button drops below the meta line; sm+: always side by side (DECISIONS chat C9) */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 sm:flex-nowrap sm:gap-x-6" data-chat-header-top>
        <div className="min-w-0 flex-auto basis-auto sm:shrink" data-chat-title-block>
          <PageTitle className="[overflow-wrap:anywhere]">{chat.title || '未命名的聊天'}</PageTitle>
          <Meta className="mt-1.5">
            {chat.kind === 'group' ? '群聊' : '私聊'}
            <Dot />
            <Data>{chat.messageCount.toLocaleString('zh-CN')}</Data> 条消息
            {chat.messageCount > 0 && (
              <>
                <span className="hidden sm:inline">
                  <Dot />
                </span>
                <span className="block whitespace-nowrap sm:inline">{formatRange(firstDate, chat.lastMessageAt)}</span>
              </>
            )}
          </Meta>
        </div>
        {action && (
          <div className="shrink-0 sm:pt-2.5" data-chat-header-action>
            {action}
          </div>
        )}
      </div>

      <dl className="mt-5 grid grid-cols-1 gap-x-4 text-[14px] leading-7 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-y-2">
        <dt className="text-[13px] leading-7 text-ink-3">参与者</dt>
        <dd className="mb-3 min-w-0 sm:mb-0" data-chat-participants>
          {participants.length === 0 ? (
            <span className="text-ink-3">还没有关联到人物</span>
          ) : (
            <>
              {shown.map((p, i) => (
                <Fragment key={p.id}>
                  {i > 0 && <span className="text-ink-3">、</span>}
                  <Link href={personHref(p.id)} className="loam-link whitespace-nowrap">
                    {p.label}
                  </Link>
                </Fragment>
              ))}
              {hidden > 0 && (
                <>
                  <span className="whitespace-nowrap text-ink-3"> 等 {participants.length} 人</span>
                  <Dot />
                  <button type="button" className="loam-text-button text-[13px]" onClick={() => setAllPeople(true)}>
                    全部显示
                  </button>
                </>
              )}
              {allPeople && participants.length > PARTICIPANTS_COLLAPSED && (
                <>
                  <Dot />
                  <button type="button" className="loam-text-button text-[13px]" onClick={() => setAllPeople(false)}>
                    收起
                  </button>
                </>
              )}
            </>
          )}
        </dd>

        <dt className="text-[13px] leading-7 text-ink-3">导入记录</dt>
        <dd className="min-w-0" data-chat-imports>
          {imports.length === 0 ? (
            <span className="text-ink-3">没有导入记录</span>
          ) : (
            <ul>
              {imports.map((i) => (
                <li key={i.id}>
                  <Link href={importHref(i.id)} className="loam-link">
                    {formatRange(i.dateFrom, i.dateTo)}
                  </Link>
                  <span className="text-[13px] text-ink-3">
                    <Dot />
                    新增 <Data>{i.newMessageCount.toLocaleString('zh-CN')}</Data> 条
                  </span>
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
    </header>
  )
}

export function ChatHeaderSkeleton({ action }: { action?: React.ReactNode }) {
  return (
    <header data-chat-header-loading aria-busy="true" className="mb-9 border-b border-line pb-6">
      <span className="sr-only">正在加载聊天信息</span>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Skeleton className="mt-2 h-8 w-48 sm:h-9" />
          <Skeleton className="mt-3.5 h-3.5 w-72 max-w-full" />
        </div>
        {action && <div className="pt-2 sm:pt-2.5">{action}</div>}
      </div>
      <div className="mt-6 space-y-3">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3.5 w-1/2" />
      </div>
    </header>
  )
}

export function ChatHeaderError({ onRetry, action }: { onRetry?: () => void; action?: React.ReactNode }) {
  return (
    <header data-chat-header-error className="mb-9 flex items-start justify-between gap-4 border-b border-line pb-6">
      <BlockError message="聊天信息没有加载出来" onRetry={onRetry} className="mt-1" />
      {action}
    </header>
  )
}

export { ImportButton }
