'use client'
// Client data access for the person page: profile query + mutations through the typed Hono client.

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import type {
  AddClaimRequest,
  AddRelationRequest,
  ProfileRedirectResponse,
  ProfileResponse,
  ReviewRequest,
  SplitPersonRequest,
  TargetType,
} from '@/contracts'
import { api, ApiClientError, unwrap } from '@/lib/api-client'
import { queryKeys } from '@/lib/query'

export type ProfileResult = ProfileResponse | ProfileRedirectResponse

export async function fetchProfile(id: number): Promise<ProfileResult> {
  return (await unwrap(await api.people[':id'].$get({ param: { id: String(id) } }))) as ProfileResult
}

export function personQueryOptions(id: number) {
  return { queryKey: queryKeys.person(id), queryFn: () => fetchProfile(id) }
}

export const personApi = {
  review: async (type: TargetType, id: number, body: ReviewRequest) =>
    unwrap(await api.review[':type'][':id'].$post({ param: { type, id: String(id) }, json: body })),
  addClaim: async (personId: number, body: AddClaimRequest) =>
    unwrap(await api.people[':id'].claims.$post({ param: { id: String(personId) }, json: body })),
  addRelation: async (fromPersonId: number, body: AddRelationRequest) =>
    unwrap(await api.people[':id'].relations.$post({ param: { id: String(fromPersonId) }, json: body })),
  createPerson: async (label: string) => unwrap(await api.people.$post({ json: { label } })),
  merge: async (fromId: number, intoId: number) =>
    unwrap(await api.people[':id'].merge.$post({ param: { id: String(fromId) }, json: { intoId } })),
  split: async (personId: number, body: SplitPersonRequest) =>
    unwrap(await api.people[':id'].split.$post({ param: { id: String(personId) }, json: body })),
  patch: async (personId: number, body: { pinned?: boolean; label?: string }) =>
    unwrap(await api.people[':id'].$patch({ param: { id: String(personId) }, json: body })),
  remove: async (personId: number) => unwrap(await api.people[':id'].$delete({ param: { id: String(personId) } })),
}

/** Invalidations after any person-page mutation (ARCHITECTURE §2.7). */
export function useRefreshAfterChange() {
  const qc = useQueryClient()
  return useCallback(
    async (evidenceTargets: { type: TargetType; id: number }[] = []) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['person'] }),
        qc.invalidateQueries({ queryKey: queryKeys.home() }),
        qc.invalidateQueries({ queryKey: queryKeys.peopleIndex() }),
        qc.invalidateQueries({ queryKey: ['importReview'] }),
        qc.invalidateQueries({ queryKey: ['search'] }),
        ...evidenceTargets.map((t) => qc.invalidateQueries({ queryKey: queryKeys.evidence(t.type, t.id) })),
      ])
    },
    [qc],
  )
}

export function errorText(e: unknown, fallback = '没有保存成功'): string {
  if (e instanceof ApiClientError) {
    if (e.status >= 500 || e.code === 'internal') return fallback
    return e.message || fallback
  }
  return fallback
}

/** One pending/error state per control; refreshes the page data after success. */
export function useAction() {
  const refresh = useRefreshAfterChange()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, opts: { refresh?: boolean; evidence?: { type: TargetType; id: number }[] } = {}): Promise<T | undefined> => {
      setPending(true)
      setError(null)
      try {
        const out = await fn()
        if (opts.refresh !== false) await refresh(opts.evidence)
        setPending(false)
        return out
      } catch (e) {
        setPending(false)
        setError(errorText(e))
        return undefined
      }
    },
    [refresh],
  )
  const reset = useCallback(() => setError(null), [])
  return { pending, error, run, reset }
}
