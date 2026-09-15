'use client'
// BOOTSTRAP PLACEHOLDER created by core (ARCHITECTURE §1.1). Owner: review — overwrite freely.
// Minimal behaviour: EvidenceRow renders children; EvidenceMark renders the superscript number, no block.

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { ElementType, ReactNode } from 'react'
import type { EvidenceResponse, IsoString, SourceKind, TargetType } from '@/contracts'
import { api, unwrap, type ApiClientError } from '@/lib/api-client'
import { cn } from '@/lib/cn'
import { queryKeys } from '@/lib/query'

export interface EvidenceTarget {
  type: TargetType
  id: number
}

export interface EvidenceRowProps {
  children: ReactNode
  as?: 'div' | 'li' | 'p'
  id?: string
  className?: string
  open?: string | null
  onOpenChange?: (key: string | null) => void
}

export function EvidenceRow({ children, as = 'div', id, className }: EvidenceRowProps): React.JSX.Element {
  const Tag = as as ElementType
  return (
    <Tag id={id} className={className}>
      {children}
    </Tag>
  )
}

export interface EvidenceMarkProps {
  target: EvidenceTarget
  index: number
  sourceKind: SourceKind
  evidenceCount: number
  prefetchOnHover?: boolean
  className?: string
}

export function EvidenceMark({ index, sourceKind, evidenceCount, className }: EvidenceMarkProps): React.JSX.Element {
  const disabled = sourceKind === 'ai' && evidenceCount === 0
  return (
    <sup className={cn('ml-0.5 font-data text-[11px]', disabled ? 'text-ink-3' : 'text-ink-2', className)}>
      <button type="button" disabled={disabled} aria-expanded={false}>
        {index}
      </button>
    </sup>
  )
}

export interface EvidenceBlockProps {
  target: EvidenceTarget
  sourceKind: SourceKind
  createdAt?: IsoString
  context?: number
  id?: string
}

export function EvidenceBlock({ id }: EvidenceBlockProps): React.JSX.Element {
  return <div id={id} />
}

export function useEvidence(
  target: EvidenceTarget,
  opts?: { enabled?: boolean; context?: number },
): UseQueryResult<EvidenceResponse, ApiClientError> {
  return useQuery<EvidenceResponse, ApiClientError>({
    queryKey: queryKeys.evidence(target.type, target.id),
    enabled: opts?.enabled ?? false,
    queryFn: async () =>
      (await unwrap(
        await api.evidence[':type'][':id'].$get({
          param: { type: target.type, id: String(target.id) },
          query: { context: String(opts?.context ?? 2) },
        } as never),
      )) as unknown as EvidenceResponse,
  })
}
