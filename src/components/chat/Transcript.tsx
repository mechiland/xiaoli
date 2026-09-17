'use client'
// Windowed message stream: loads 100 messages at a time in both directions, keeps at most MAX_PAGES pages in the DOM,
// and holds the reading position steady while pages are added or dropped above it (SPEC §9.10; DECISIONS chat C2).
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BlockError, Meta, SkeletonLines } from '@/components/loam'
import type { AttachmentDTO, ChatMessagesResponse, MessageDTO } from '@/contracts'
import type { ApiClientError } from '@/lib/api-client'
import { queryKeys } from '@/lib/query'
import { fetchChatMessages, type MessagesParam } from './api'
import { ImageViewer, type OpenImage } from './ImageViewer'
import { TranscriptList } from './TranscriptList'

export type Origin = { kind: 'start' } | { kind: 'end' } | { kind: 'around'; id: number }
export const originKey = (o: Origin): string => (o.kind === 'around' ? `at:${o.id}` : o.kind)

export const PAGE_SIZE = 100
export const MAX_PAGES = 10
/** 49 before + target + 50 after = one 100-row page, so MAX_PAGES pages are at most 1,000 rows */
const AROUND_BEFORE = 49
const AROUND_AFTER = 50
/** below the sticky top bar */
const TOP_OFFSET = 60
/** start loading when the edge is this close to the viewport */
const LOAD_MARGIN = 1400

function initialParam(o: Origin): MessagesParam {
  if (o.kind === 'around') return { around: o.id, before: AROUND_BEFORE, after: AROUND_AFTER }
  if (o.kind === 'end') return { dir: 'older', limit: PAGE_SIZE }
  return { dir: 'newer', limit: PAGE_SIZE }
}

export function TranscriptSkeleton() {
  return (
    <div aria-busy="true" data-chat-transcript-loading className="space-y-5 pt-1">
      <span className="sr-only">正在加载消息</span>
      {[5, 3, 4, 2].map((n, i) => (
        <div key={i} className="grid grid-cols-[2.6rem_minmax(0,1fr)] gap-x-2.5 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-x-3">
          <div className="loam-skeleton mt-1.5 h-3 w-9" />
          <SkeletonLines lines={n} className="space-y-2.5 [&>div]:h-3.5" />
        </div>
      ))}
    </div>
  )
}

export function Transcript({ chatId, origin, onJump }: { chatId: number; origin: Origin; onJump: (o: Origin) => void }) {
  const q = useInfiniteQuery<ChatMessagesResponse, ApiClientError, InfiniteData<ChatMessagesResponse, MessagesParam>, readonly unknown[], MessagesParam>({
    queryKey: queryKeys.chatMessages(chatId, { origin: originKey(origin) }),
    queryFn: ({ pageParam }) => fetchChatMessages(chatId, pageParam),
    initialPageParam: initialParam(origin),
    getNextPageParam: (last) => (last.hasNewer && last.messages.length > 0 ? { cursor: last.messages[last.messages.length - 1].seq, dir: 'newer', limit: PAGE_SIZE } : undefined),
    getPreviousPageParam: (first) => (first.hasOlder && first.messages.length > 0 ? { cursor: first.messages[0].seq, dir: 'older', limit: PAGE_SIZE } : undefined),
    maxPages: MAX_PAGES,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })

  const messages = useMemo<MessageDTO[]>(() => q.data?.pages.flatMap((p) => p.messages) ?? [], [q.data])
  const listRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ id: string; top: number } | null>(null)
  const positioned = useRef(false)
  const userScrolled = useRef(false)
  const headerInputAt = useRef(-Infinity)
  const [image, setImage] = useState<OpenImage | null>(null)
  const [anchorMissing, setAnchorMissing] = useState(false)

  // latest query state for event handlers
  const live = useRef(q)
  live.current = q

  /** Remember the first row visible under the top bar and where it sits. */
  const capture = useCallback(() => {
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-message-id]')
    if (!rows || rows.length === 0) return
    let lo = 0
    let hi = rows.length - 1
    let idx = rows.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (rows[mid].getBoundingClientRect().bottom > TOP_OFFSET) {
        idx = mid
        hi = mid - 1
      } else lo = mid + 1
    }
    anchor.current = { id: rows[idx].dataset.messageId!, top: rows[idx].getBoundingClientRect().top }
  }, [])

  /** Put the remembered row back where it was (after pages were added/dropped above it, or the header grew). */
  const restore = useCallback(() => {
    const a = anchor.current
    if (!a || !positioned.current) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-message-id="${a.id}"]`)
    if (!el) return
    const delta = el.getBoundingClientRect().top - a.top
    if (Math.abs(delta) > 0.5) window.scrollBy(0, delta)
    anchor.current = { id: a.id, top: el.getBoundingClientRect().top }
  }, [])

  const maybeLoad = useCallback(() => {
    const s = live.current
    if (!positioned.current || s.isFetching || s.isFetchPreviousPageError || s.isFetchNextPageError) return
    if (s.hasPreviousPage && topRef.current && topRef.current.getBoundingClientRect().bottom > -LOAD_MARGIN) {
      capture()
      void s.fetchPreviousPage({ cancelRefetch: false })
      return
    }
    if (s.hasNextPage && bottomRef.current && bottomRef.current.getBoundingClientRect().top < window.innerHeight + LOAD_MARGIN) {
      capture()
      void s.fetchNextPage({ cancelRefetch: false })
    }
  }, [capture])

  // First data: scroll to the target (or the end), then start watching the edges.
  useLayoutEffect(() => {
    if (positioned.current || !q.data) return
    const first = q.data.pages[0]
    if (origin.kind === 'around') {
      const el = first.anchorId != null ? listRef.current?.querySelector<HTMLElement>(`[data-message-id="${first.anchorId}"]`) : null
      if (el) el.scrollIntoView({ block: 'center' })
      else setAnchorMissing(true)
    } else if (origin.kind === 'end') {
      window.scrollTo(0, document.documentElement.scrollHeight)
    }
    positioned.current = true
    capture()
  }, [q.data, origin, capture])

  // Pages changed → keep the reading position.
  useLayoutEffect(() => {
    restore()
  }, [q.data, q.hasPreviousPage, restore])

  useEffect(() => {
    let raf = 0
    const onScroll = () => {
      capture()
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0
          maybeLoad()
        })
    }
    const onUser = () => {
      userScrolled.current = true
    }
    // A click/tap/key inside the page header (全部显示 / 收起) grows or shrinks it on purpose: the reader is looking at
    // the header, so it must stay put and the rows below move instead (DECISIONS chat C11).
    const onHeaderInput = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('[data-chat-header]')) headerInputAt.current = performance.now()
    }
    // The header (or anything above) can change height after we positioned (late header load, thumbnails): hold the
    // row while the list starts above the viewport, or before the reader has scrolled at all — unless the reader
    // caused the change in the header, in which case only re-remember the row.
    const ro = new ResizeObserver(() => {
      if (performance.now() - headerInputAt.current < 1000) {
        capture()
        return
      }
      const top = listRef.current?.getBoundingClientRect().top ?? 0
      if (!userScrolled.current || top < TOP_OFFSET) restore()
    })
    ro.observe(document.body)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    window.addEventListener('wheel', onUser, { passive: true })
    window.addEventListener('touchmove', onUser, { passive: true })
    window.addEventListener('keydown', onUser)
    for (const t of ['pointerdown', 'keydown', 'click'] as const) window.addEventListener(t, onHeaderInput, true)
    return () => {
      for (const t of ['pointerdown', 'keydown', 'click'] as const) window.removeEventListener(t, onHeaderInput, true)
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('wheel', onUser)
      window.removeEventListener('touchmove', onUser)
      window.removeEventListener('keydown', onUser)
    }
  }, [capture, maybeLoad, restore])

  // After every fetch settles the edge may still be near (no scroll event will come): check again.
  useEffect(() => {
    const t = requestAnimationFrame(maybeLoad)
    return () => cancelAnimationFrame(t)
  }, [q.data, q.isFetching, maybeLoad])

  const openImage = useCallback((att: AttachmentDTO, message: MessageDTO) => setImage({ att, message }), [])

  if (q.isPending) return <TranscriptSkeleton />
  if (q.isError && !q.data) {
    return (
      <div data-chat-messages-error>
        {q.error.status === 404 ? <BlockError message="没有找到这个聊天的消息" /> : <BlockError message="消息没有加载出来" onRetry={() => void q.refetch()} />}
      </div>
    )
  }

  const highlightId = origin.kind === 'around' ? origin.id : null
  const canJumpStart = q.hasPreviousPage || origin.kind === 'end' || (origin.kind === 'around' && messages.length > 0)
  const canJumpEnd = q.hasNextPage || origin.kind === 'start' || origin.kind === 'around'

  return (
    <div data-chat-messages>
      {(q.hasPreviousPage || q.hasNextPage) && (
        <nav aria-label="跳转" className="mb-5 flex justify-end gap-4 text-[13px] leading-6">
          {canJumpStart && (
            <button type="button" className="loam-text-button" onClick={() => onJump({ kind: 'start' })}>
              跳到最早
            </button>
          )}
          {canJumpEnd && (
            <button type="button" className="loam-text-button" onClick={() => onJump({ kind: 'end' })}>
              跳到最新
            </button>
          )}
        </nav>
      )}
      {anchorMissing && <Meta className="mb-5">要找的那条消息已经不在这个聊天里了，下面从最早的消息开始。</Meta>}

      {q.hasPreviousPage && (
        <div ref={topRef} className="mb-6" data-chat-load-older>
          {q.isFetchPreviousPageError ? (
            <BlockError message="更早的消息没有加载出来" onRetry={() => void q.fetchPreviousPage()} />
          ) : (
            <SkeletonLines lines={3} className="space-y-2.5 pl-[3.1rem] sm:pl-[3.75rem] [&>div]:h-3.5" />
          )}
        </div>
      )}

      {messages.length === 0 ? (
        <Meta>这个聊天里还没有消息。</Meta>
      ) : (
        <TranscriptList ref={listRef} messages={messages} highlightId={highlightId} onOpenImage={openImage} />
      )}

      {q.hasNextPage ? (
        <div ref={bottomRef} className="mt-6" data-chat-load-newer>
          {q.isFetchNextPageError ? (
            <BlockError message="后面的消息没有加载出来" onRetry={() => void q.fetchNextPage()} />
          ) : (
            <SkeletonLines lines={3} className="space-y-2.5 pl-[3.1rem] sm:pl-[3.75rem] [&>div]:h-3.5" />
          )}
        </div>
      ) : (
        messages.length > 0 && (
          <p data-chat-end className="mt-10 border-t border-line pt-3 text-[12px] leading-5 text-ink-3">
            聊天记录到这里结束
          </p>
        )
      )}

      <ImageViewer image={image} onClose={() => setImage(null)} />
    </div>
  )
}
