// Shared TanStack Query keys (ARCHITECTURE §2.7). Modules may add private keys only prefixed with their module name.
import type { TargetType } from '@/contracts'

export const queryKeys = {
  me: () => ['me'] as const,
  settings: () => ['settings'] as const,
  home: () => ['home'] as const,
  person: (id: number) => ['person', id] as const,
  peopleIndex: () => ['peopleIndex'] as const,
  importDetail: (id: number) => ['importDetail', id] as const,
  importReview: (id: number) => ['importReview', id] as const,
  chat: (id: number) => ['chat', id] as const,
  chatMessages: (id: number, params: Record<string, string | number | undefined>) => ['chatMessages', id, params] as const,
  evidence: (type: TargetType, id: number) => ['evidence', type, id] as const,
  search: (q: string, types: 'all' | 'people' | 'claims' = 'all') => ['search', q, types] as const,
}
