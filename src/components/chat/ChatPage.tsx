'use client'
// /chats/:id?at=:msgId (SPEC §9.10). Two independent blocks: header and transcript. Owner: chat.
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { BlockBoundary, Meta, PageShell, PageTitle } from '@/components/loam'
import type { ChatDetailResponse } from '@/contracts'
import type { ApiClientError } from '@/lib/api-client'
import { chatHref, homeHref } from '@/lib/links'
import { chatDetailQuery } from './api'
import { ChatHeaderError, ChatHeaderSkeleton, ChatHeaderView, ImportButton } from './ChatHeader'
import { originKey, Transcript, type Origin } from './Transcript'

export function ChatNotFound() {
  return (
    <PageShell width="reading">
      <div data-chat-not-found className="border-b border-line pb-6">
        <PageTitle>没有找到这个聊天</PageTitle>
        <Meta className="mt-2">它可能已经随导入一起删除了，或者链接不完整。</Meta>
      </div>
      <p className="mt-5 text-[14px] leading-7">
        <Link href={homeHref} className="loam-text-button">
          回到首页
        </Link>
      </p>
    </PageShell>
  )
}

export function ChatPage({ chatId, at }: { chatId: number; at: number | null }) {
  const [origin, setOrigin] = useState<Origin>(at != null ? { kind: 'around', id: at } : { kind: 'start' })
  // Adopt a new ?at= (another evidence link into this chat) during render; a removed ?at= keeps the current window.
  const [appliedAt, setAppliedAt] = useState(at)
  if (at !== appliedAt) {
    setAppliedAt(at)
    if (at != null) setOrigin({ kind: 'around', id: at })
  }
  const detail = useQuery<ChatDetailResponse, ApiClientError>(chatDetailQuery(chatId))

  useEffect(() => {
    if (detail.data) document.title = `${detail.data.chat.title || '聊天'} · 小丽`
  }, [detail.data])

  const jump = useCallback(
    (o: Origin) => {
      // leaving ?at= behind: the address now names the chat, not a message
      window.history.replaceState(null, '', chatHref(chatId))
      if (o.kind === 'start') window.scrollTo(0, 0)
      setOrigin(o)
    },
    [chatId],
  )

  if (detail.error?.status === 404) return <ChatNotFound />

  const action = <ImportButton chatId={chatId} />
  return (
    <PageShell width="reading" className="pt-8 sm:pt-12">
      <BlockBoundary>
        {detail.isPending ? (
          <ChatHeaderSkeleton action={action} />
        ) : detail.isError ? (
          <ChatHeaderError action={action} onRetry={() => void detail.refetch()} />
        ) : (
          <ChatHeaderView detail={detail.data} action={action} />
        )}
      </BlockBoundary>
      <BlockBoundary>
        <Transcript key={originKey(origin)} chatId={chatId} origin={origin} onJump={jump} />
      </BlockBoundary>
    </PageShell>
  )
}
