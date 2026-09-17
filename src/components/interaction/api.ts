'use client'
// Client data access for the interaction layer through the typed Hono client.
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import type { ImportInteractionResponse, InteractionResponse, LoopCloseReason, PatchSegmentRequest } from '@/contracts'
import { api, ApiClientError, unwrap } from '@/lib/api-client'

/** Module-private query keys (ARCHITECTURE §2.7: a module may add keys under its own name). */
export const interactionKeys = {
  person: (id: number, timeline: number | 'all') => ['interaction', 'person', id, timeline] as const,
  import: (id: number) => ['interaction', 'import', id] as const,
}

/** The person page and the infobox line share one request (SPEC §9.5): same key, same default page size. */
export const DEFAULT_TIMELINE = 5

export async function fetchPersonInteraction(personId: number, timeline: number | 'all'): Promise<InteractionResponse> {
  return unwrap(
    await api.people[':id'].interaction.$get({ param: { id: String(personId) }, query: { timeline: String(timeline) } }),
  )
}

export function personInteractionOptions(personId: number, timeline: number | 'all' = DEFAULT_TIMELINE) {
  return { queryKey: interactionKeys.person(personId, timeline), queryFn: () => fetchPersonInteraction(personId, timeline) }
}

export async function fetchImportInteraction(importId: number): Promise<ImportInteractionResponse> {
  return unwrap(await api.imports[':id'].interaction.$get({ param: { id: String(importId) } }))
}

export function importInteractionOptions(importId: number) {
  return { queryKey: interactionKeys.import(importId), queryFn: () => fetchImportInteraction(importId) }
}

export const interactionApi = {
  closeLoop: async (loopId: number, reason: LoopCloseReason) =>
    unwrap(await api.loops[':id'].close.$post({ param: { id: String(loopId) }, json: { reason } })),
  reopenLoop: async (loopId: number) => unwrap(await api.loops[':id'].reopen.$post({ param: { id: String(loopId) } })),
  reviewLoop: async (loopId: number, action: 'accept' | 'reject') =>
    unwrap(await api.review[':type'][':id'].$post({ param: { type: 'loop', id: String(loopId) }, json: { action } })),
  patchSegment: async (segmentId: number, patch: PatchSegmentRequest) =>
    unwrap(await api.segments[':id'].$patch({ param: { id: String(segmentId) }, json: patch })),
}

export function errorText(e: unknown, fallback = '没有保存成功'): string {
  if (e instanceof ApiClientError) {
    if (e.status >= 500 || e.code === 'internal') return fallback
    return e.message || fallback
  }
  return fallback
}

/** One pending/error state per control; refreshes everything this change can be seen in. */
export function useAction() {
  const qc = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, opts: { refresh?: boolean } = {}): Promise<T | undefined> => {
      setPending(true)
      setError(null)
      try {
        const out = await fn()
        if (opts.refresh !== false) {
          await Promise.all([
            qc.invalidateQueries({ queryKey: ['interaction'] }),
            qc.invalidateQueries({ queryKey: ['home'] }),
            qc.invalidateQueries({ queryKey: ['person'] }),
            qc.invalidateQueries({ queryKey: ['importReview'] }),
            qc.invalidateQueries({ queryKey: ['search'] }),
          ])
        }
        setPending(false)
        return out
      } catch (e) {
        setPending(false)
        setError(errorText(e))
        return undefined
      }
    },
    [qc],
  )
  return { pending, error, run, reset: useCallback(() => setError(null), []) }
}
