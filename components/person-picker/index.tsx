'use client'
// BOOTSTRAP PLACEHOLDER created by core (ARCHITECTURE §1.1). Owner: search — overwrite freely.
// Minimal behaviour: plain list of `candidates` + "新建人物".

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { PersonRefDTO } from '@/contracts'
import { api, unwrap } from '@/lib/api-client'
import { cn } from '@/lib/cn'
import { queryKeys } from '@/lib/query'

export type PersonPick =
  | { kind: 'self' }
  | { kind: 'existing'; person: PersonRefDTO }
  | { kind: 'new'; label: string }

export interface PersonPickerCandidate {
  personId: number
  label: string
  reason: string | null
}

export interface PersonPickerProps {
  value: PersonPick | null
  onPick: (pick: PersonPick) => void
  variant: 'select' | 'inline'
  candidates?: PersonPickerCandidate[]
  allowSelf?: boolean
  allowCreate?: false | { defaultLabel: string }
  excludeIds?: number[]
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
}

export function PersonPicker({
  value,
  onPick,
  candidates = [],
  allowSelf = false,
  allowCreate = false,
  excludeIds = [],
  disabled,
  className,
}: PersonPickerProps): React.JSX.Element {
  const isSelected = (p: PersonPick) => JSON.stringify(p) === JSON.stringify(value)
  const item = (key: string, pick: PersonPick, label: string, reason?: string | null) => (
    <li key={key}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onPick(pick)}
        className={cn('w-full px-3 py-1.5 text-left text-[14px] hover:bg-ground', isSelected(pick) && 'bg-highlight')}
      >
        {label}
        {reason && <span className="ml-2 text-[12px] text-ink-3">{reason}</span>}
      </button>
    </li>
  )
  return (
    <ul className={cn('border border-line bg-paper py-1', className)}>
      {allowSelf && item('self', { kind: 'self' }, '我')}
      {candidates
        .filter((c) => !excludeIds.includes(c.personId))
        .map((c) =>
          item(`p${c.personId}`, { kind: 'existing', person: { id: c.personId, label: c.label } }, c.label, c.reason),
        )}
      {allowCreate &&
        item('new', { kind: 'new', label: allowCreate.defaultLabel }, `新建人物『${allowCreate.defaultLabel}』`)}
    </ul>
  )
}

export function usePersonSearch(
  q: string,
  opts?: { enabled?: boolean; limit?: number },
): UseQueryResult<{ person: PersonRefDTO; matchedAlias: string | null }[]> {
  return useQuery({
    queryKey: [...queryKeys.search(q, 'people'), opts?.limit ?? 20],
    enabled: (opts?.enabled ?? true) && q.trim().length > 0,
    queryFn: async () => {
      const res = await unwrap(
        await api.search.$get({ query: { q, types: 'people', limit: String(opts?.limit ?? 20) } as never }),
      )
      return (res as unknown as { people: { person: PersonRefDTO; matchedAlias: string | null }[] }).people
    },
  })
}
