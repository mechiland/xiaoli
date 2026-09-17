'use client'

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { ClientResponse } from 'hono/client'
import Link from 'next/link'
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ElementType, type ReactNode } from 'react'
import { BlockError, SkeletonLines } from '@/components/loam'
import type { EvidenceItemDTO, EvidenceResponse, IsoString, SourceKind, TargetType } from '@/contracts'
import { api, unwrap, type ApiClientError } from '@/lib/api-client'
import { cn } from '@/lib/cn'
import { chatHref } from '@/lib/links'
import { queryKeys } from '@/lib/query'
import { formatIsoDate, formatMsgTime } from '@/lib/time'
import { MessageBody } from './message'

export interface EvidenceTarget {
  type: TargetType
  id: number
}

const keyOf = (t: EvidenceTarget) => `${t.type}:${t.id}`
const targetOf = (key: string): EvidenceTarget => {
  const [type, id] = key.split(':')
  return { type: type as TargetType, id: Number(id) }
}

// ---------------------------------------------------------------------------------------------------------------
// data

async function fetchEvidence(target: EvidenceTarget, context: number): Promise<EvidenceResponse> {
  const res = await api.evidence[':type'][':id'].$get({
    param: { type: target.type, id: String(target.id) },
    query: { context: String(context) },
  } as never)
  return unwrap(res as unknown as ClientResponse<EvidenceResponse, 200, 'json'>) as Promise<EvidenceResponse>
}

export function evidenceQueryOptions(target: EvidenceTarget, context = 2) {
  return {
    queryKey: queryKeys.evidence(target.type, target.id),
    queryFn: () => fetchEvidence(target, context),
  }
}

export function useEvidence(target: EvidenceTarget, opts?: { enabled?: boolean; context?: number }): UseQueryResult<EvidenceResponse, ApiClientError> {
  return useQuery<EvidenceResponse, ApiClientError>({
    ...evidenceQueryOptions(target, opts?.context ?? 2),
    enabled: opts?.enabled ?? false,
  })
}

// ---------------------------------------------------------------------------------------------------------------
// row

interface RowContext {
  openKey: string | null
  blockId: string
  toggle: (key: string) => void
  register: (key: string, sourceKind: SourceKind) => void
}
const Ctx = createContext<RowContext | null>(null)

export interface EvidenceRowProps {
  children: ReactNode
  as?: 'div' | 'li' | 'p'
  id?: string
  className?: string
  /** controlled: key of the open mark (`${type}:${id}`); omit for uncontrolled */
  open?: string | null
  onOpenChange?: (key: string | null) => void
}

/** Owns the open state of the marks inside it and renders the open mark's EvidenceBlock directly below the row. */
export function EvidenceRow({ children, as = 'div', id, className, open, onOpenChange }: EvidenceRowProps): React.JSX.Element {
  const [inner, setInner] = useState<string | null>(null)
  const [kinds, setKinds] = useState<Record<string, SourceKind>>({})
  const controlled = open !== undefined
  const openKey = controlled ? open : inner
  const blockId = `evidence-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  const toggle = useCallback(
    (key: string) => {
      const next = openKey === key ? null : key
      if (!controlled) setInner(next)
      onOpenChange?.(next)
    },
    [controlled, onOpenChange, openKey],
  )
  const register = useCallback((key: string, sourceKind: SourceKind) => {
    setKinds((k) => (k[key] === sourceKind ? k : { ...k, [key]: sourceKind }))
  }, [])
  const ctx = useMemo(() => ({ openKey, blockId, toggle, register }), [openKey, blockId, toggle, register])

  const block = openKey ? <EvidenceBlock id={blockId} target={targetOf(openKey)} sourceKind={kinds[openKey] ?? 'ai'} /> : null
  if (as === 'p') {
    // a <div> block cannot live inside <p>: render it right after the paragraph
    return (
      <Ctx.Provider value={ctx}>
        <p id={id} className={className}>
          {children}
        </p>
        {block}
      </Ctx.Provider>
    )
  }
  const Tag = as as ElementType
  return (
    <Ctx.Provider value={ctx}>
      <Tag id={id} className={className}>
        {children}
        {block}
      </Tag>
    </Ctx.Provider>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// mark

export interface EvidenceMarkProps {
  target: EvidenceTarget
  /** footnote number shown; page-scoped, 1-based, render order */
  index: number
  sourceKind: SourceKind
  /** 0 with sourceKind 'ai' → rendered disabled (muted, no block) */
  evidenceCount: number
  /** default true */
  prefetchOnHover?: boolean
  className?: string
}

/** Superscript footnote number at the end of a sentence; toggles its block in the nearest EvidenceRow. */
export function EvidenceMark({ target, index, sourceKind, evidenceCount, prefetchOnHover = true, className }: EvidenceMarkProps): React.JSX.Element {
  const ctx = useContext(Ctx)
  if (!ctx && process.env.NODE_ENV !== 'production') throw new Error('EvidenceMark must be rendered inside an EvidenceRow')
  const queryClient = useQueryClient()
  const key = keyOf(target)
  const disabled = sourceKind === 'ai' && evidenceCount === 0
  const expanded = ctx?.openKey === key

  const register = ctx?.register
  useEffect(() => {
    register?.(key, sourceKind)
  }, [register, key, sourceKind])

  const prefetch = () => {
    if (!prefetchOnHover || disabled) return
    void queryClient.prefetchQuery(evidenceQueryOptions(target))
  }

  return (
    <sup className={cn('evidence-mark relative -top-[0.1em] ml-[1px] align-super text-[0.68em] leading-none', className)}>
      <button
        type="button"
        data-evidence-mark={key}
        disabled={disabled}
        aria-expanded={expanded}
        aria-controls={expanded ? ctx?.blockId : undefined}
        aria-label={disabled ? `证据 ${index}（没有可显示的原话）` : `证据 ${index}`}
        title={disabled ? '没有可显示的原话' : sourceKind === 'manual' ? '手动添加' : '查看原话'}
        onClick={() => ctx?.toggle(key)}
        onMouseEnter={prefetch}
        onFocus={prefetch}
        className={cn(
          'font-data tabular-nums relative inline-block min-w-[1.35em] rounded-[2px] px-[3px] py-[1px] text-center transition-colors',
          disabled
            ? 'cursor-default text-ink-3/70'
            : expanded
              ? 'bg-highlight text-ink'
              : 'text-ink-2 hover:bg-paper-hover hover:text-ink',
        )}
      >
        {index}
        {/* phone: invisible ≥ 24×24 hit area around the small footnote glyph (visible size unchanged) */}
        <span aria-hidden data-evidence-hit className="absolute -inset-x-[6px] -inset-y-[7px] sm:hidden" />
      </button>
    </sup>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// block

export interface EvidenceBlockProps {
  target: EvidenceTarget
  sourceKind: SourceKind
  createdAt?: IsoString
  /** default 2 */
  context?: number
  id?: string
}

export function EvidenceBlock({ target, sourceKind, createdAt, context = 2, id }: EvidenceBlockProps): React.JSX.Element {
  const q = useEvidence(target, { enabled: true, context })
  let content: ReactNode
  if (q.isPending || (q.isError && q.isFetching)) {
    content = (
      <div className="py-1">
        <span className="sr-only">正在加载原话</span>
        <SkeletonLines lines={5} className="[&>div]:h-3.5 space-y-2.5" />
      </div>
    )
  } else if (q.isError) {
    content = <BlockError message="原话没有加载出来" onRetry={() => void q.refetch()} className="border-l-0 py-0 pl-0 text-[13px]" />
  } else {
    const data = q.data
    if (data.sourceKind === 'manual' || (sourceKind === 'manual' && data.items.length === 0)) {
      const at = data.manualAddedAt ?? createdAt
      content = <p className="text-[13px] leading-6 text-ink-3">{at ? `手动添加于 ${formatIsoDate(at)}` : '手动添加'}</p>
    } else if (data.items.length === 0) {
      content = <p className="text-[13px] leading-6 text-ink-3">原话已经不在了（对应的聊天记录可能被删除）</p>
    } else {
      content = (
        <div>
          {data.items.map((seg, i) => (
            <Segment key={`${seg.chatId}-${seg.messageId}`} seg={seg} first={i === 0} />
          ))}
        </div>
      )
    }
  }
  return (
    <div
      id={id}
      role="region"
      aria-label="证据"
      aria-busy={q.isPending || undefined}
      className="evidence-block my-2 block rounded-[2px] border border-line bg-paper px-3.5 py-2.5 text-left text-[14px] font-normal leading-[1.75] text-ink not-italic no-underline sm:px-4 sm:py-3"
    >
      {content}
    </div>
  )
}

function Segment({ seg, first }: { seg: EvidenceItemDTO; first: boolean }) {
  let prevDate: string | null = null
  return (
    <section className={cn(!first && 'mt-3 border-t border-line pt-2.5')} aria-label={`来自『${seg.chatTitle}』`}>
      <div className="mb-1 text-[12px] leading-5 text-ink-3">『{seg.chatTitle}』</div>
      <ol className="space-y-0.5">
        {seg.messages.map((m) => {
          const date = m.sentAt.slice(0, 10)
          const time = formatMsgTime(m.sentAt, date === prevDate ? 'short' : 'full')
          prevDate = date
          const sender = m.senderLabel ?? m.senderName
          return (
            <li
              key={m.id}
              data-evidence-message={m.isEvidence ? 'true' : undefined}
              className={cn('-mx-2 rounded-[2px] px-2 py-[3px] [overflow-wrap:anywhere]', m.isEvidence ? 'bg-highlight text-ink' : 'text-ink-2')}
            >
              <span className="font-data whitespace-nowrap text-[12px] tabular-nums text-ink-3">{time}</span>
              <span className="px-1.5 text-ink-3" aria-hidden>
                ·
              </span>
              <span className={cn(m.isEvidence ? 'text-ink-2' : 'text-ink-3')}>{sender}</span>
              <span className="px-1.5 text-ink-3" aria-hidden>
                ·
              </span>
              <MessageBody m={m} />
            </li>
          )
        })}
      </ol>
      <div className="mt-1.5 text-[13px] leading-6">
        <Link href={chatHref(seg.chatId, seg.messageId)} className="loam-text-button">
          在聊天中查看
        </Link>
      </div>
    </section>
  )
}
