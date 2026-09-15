'use client'
// Queries and mutations for the import result page. Shared keys only through `queryKeys` (ARCHITECTURE §2.7).

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type {
  BulkReviewResponse,
  ClaimDTO,
  DeleteImportResult,
  ImportDetailResponse,
  ImportReviewResponse,
  JobsNextResponse,
  JobsRetryResponse,
  MergePersonResponse,
  ReviewItem,
  ReviewRequest,
  ReviewResponse,
  SettingsDTO,
  TargetType,
} from '@/contracts'
import { ApiClientError } from '@/lib/api-client'
import { queryKeys } from '@/lib/query'
import { applyItemUpdate, applyStatus, itemKey, renamePerson } from './format'

// A tiny typed fetch (same envelope handling as `unwrap`): the RPC client's inferred types for these nested routes
// are not needed here and keep the page's type-check cheap. DECISIONS import-result IR3.
async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiClientError(0, 'network', '网络连接不上')
  }
  if (res.ok) return (await res.json()) as T
  let code = 'internal'
  let message = '服务器出错了'
  let details: unknown
  try {
    const b = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } }
    code = b.error?.code ?? code
    message = b.error?.message ?? message
    details = b.error?.details
  } catch {
    // non-JSON body
  }
  throw new ApiClientError(res.status, code, message, details)
}

const noRetry4xx = (count: number, err: unknown) => !(err instanceof ApiClientError && err.status >= 400 && err.status < 500) && count < 1

export const fetchImportDetail = (id: number) => request<ImportDetailResponse>('GET', `/api/imports/${id}`)
export const fetchImportReview = (id: number) => request<ImportReviewResponse>('GET', `/api/imports/${id}/review`)
export const postJobsNext = (id: number) => request<JobsNextResponse>('POST', `/api/imports/${id}/jobs/next`, {})

export function useImportDetail(importId: number) {
  return useQuery<ImportDetailResponse, ApiClientError>({
    queryKey: queryKeys.importDetail(importId),
    queryFn: () => fetchImportDetail(importId),
    retry: noRetry4xx,
  })
}

export function useImportReview(importId: number, enabled: boolean) {
  return useQuery<ImportReviewResponse, ApiClientError>({
    queryKey: queryKeys.importReview(importId),
    queryFn: () => fetchImportReview(importId),
    enabled,
    retry: noRetry4xx,
    // The body block renders its own BlockError (the query lives above the block boundary, so it must not throw).
    // A failed background refetch keeps what is on screen.
  })
}

export function useSettings() {
  return useQuery<{ settings: SettingsDTO }, ApiClientError>({
    queryKey: queryKeys.me(),
    queryFn: () => request<{ settings: SettingsDTO }>('GET', '/api/me'),
    staleTime: 60_000,
    retry: noRetry4xx,
  })
}

/** Patch both page caches after a jobs/next or retry answer. */
export function applyProgress(qc: QueryClient, importId: number, progress: ImportDetailResponse['progress'], status?: ImportDetailResponse['import']['status']) {
  qc.setQueryData<ImportDetailResponse>(queryKeys.importDetail(importId), (d) =>
    d ? { ...d, progress, import: status ? { ...d.import, status } : d.import } : d,
  )
  qc.setQueryData<ImportReviewResponse>(queryKeys.importReview(importId), (r) =>
    r ? { ...r, progress, import: status ? { ...r.import, status } : r.import } : r,
  )
}

// Refetch of the review after actions is coalesced: many quick clicks → one GET.
const refetchTimers = new Map<number, ReturnType<typeof setTimeout>>()
function scheduleReviewRefetch(qc: QueryClient, importId: number, ms = 900) {
  clearTimeout(refetchTimers.get(importId))
  refetchTimers.set(
    importId,
    setTimeout(() => {
      refetchTimers.delete(importId)
      void qc.invalidateQueries({ queryKey: queryKeys.importReview(importId) })
    }, ms),
  )
}

function personIdsOf(it: ReviewItem): number[] {
  switch (it.type) {
    case 'claim':
      return [it.item.personId]
    case 'handle':
      return it.item.personId ? [it.item.personId] : []
    case 'relation':
      return [it.item.fromPersonId, it.item.toPersonId]
    case 'date':
      return [it.item.personId]
    case 'event':
      return it.item.participants.map((p) => p.id)
  }
}

function invalidateAround(qc: QueryClient, items: ReviewItem[]) {
  for (const id of new Set(items.flatMap(personIdsOf))) void qc.invalidateQueries({ queryKey: queryKeys.person(id) })
  for (const it of items) void qc.invalidateQueries({ queryKey: queryKeys.evidence(it.type, it.item.id), refetchType: 'none' })
  void qc.invalidateQueries({ queryKey: queryKeys.home() })
}

export type ReviewVars = { it: ReviewItem; action: 'accept' | 'reject' | 'edit'; patch?: ReviewRequest['patch'] }

export function useReviewAction(importId: number) {
  const qc = useQueryClient()
  return useMutation<ReviewResponse, ApiClientError, ReviewVars>({
    mutationFn: ({ it, action, patch }) =>
      request<ReviewResponse>('POST', `/api/review/${it.type}/${it.item.id}`, patch ? { action, patch } : { action }),
    onSuccess: (res, { it }) => {
      qc.setQueryData<ImportReviewResponse>(queryKeys.importReview(importId), (r) =>
        r ? applyItemUpdate(r, it.type, res.item, res.superseded as ClaimDTO[] | undefined) : r,
      )
      invalidateAround(qc, [it])
      scheduleReviewRefetch(qc, importId)
    },
  })
}

export function useBulkAccept(importId: number) {
  const qc = useQueryClient()
  return useMutation<BulkReviewResponse, ApiClientError, { items: ReviewItem[] | { type: TargetType; id: number }[] }>({
    mutationFn: async ({ items }) => {
      const refs = items.map((x) => ('item' in x ? { type: x.type, id: x.item.id } : x))
      let updated = 0
      const failed: BulkReviewResponse['failed'] = []
      for (let i = 0; i < refs.length; i += 500) {
        const r = await request<BulkReviewResponse>('POST', '/api/review/bulk', { items: refs.slice(i, i + 500), action: 'accept' })
        updated += r.updated
        failed.push(...r.failed)
      }
      return { updated, failed }
    },
    onSuccess: (res, { items }) => {
      const refs = items.map((x) => ('item' in x ? { type: x.type, id: x.item.id } : x))
      const failed = new Set(res.failed.map((f) => itemKey(f.type, f.id)))
      const keys = new Set(refs.map((x) => itemKey(x.type, x.id)).filter((k) => !failed.has(k)))
      qc.setQueryData<ImportReviewResponse>(queryKeys.importReview(importId), (r) => (r ? applyStatus(r, keys, 'confirmed') : r))
      for (const x of refs) void qc.invalidateQueries({ queryKey: queryKeys.evidence(x.type, x.id), refetchType: 'none' })
      void qc.invalidateQueries({ queryKey: ['person'] })
      void qc.invalidateQueries({ queryKey: queryKeys.home() })
      scheduleReviewRefetch(qc, importId, 300)
    },
  })
}

export function useRenamePerson(importId: number) {
  const qc = useQueryClient()
  return useMutation<{ person: { id: number; label: string } }, ApiClientError, { personId: number; label: string }>({
    mutationFn: ({ personId, label }) => request('PATCH', `/api/people/${personId}`, { label }),
    onSuccess: (res, { personId }) => {
      qc.setQueryData<ImportReviewResponse>(queryKeys.importReview(importId), (r) => (r ? renamePerson(r, personId, res.person.label) : r))
      void qc.invalidateQueries({ queryKey: queryKeys.person(personId) })
      void qc.invalidateQueries({ queryKey: queryKeys.peopleIndex() })
      void qc.invalidateQueries({ queryKey: queryKeys.home() })
      void qc.invalidateQueries({ queryKey: ['search'] })
      void qc.invalidateQueries({ queryKey: queryKeys.importDetail(importId) })
    },
  })
}

export function useMergePerson(importId: number) {
  const qc = useQueryClient()
  return useMutation<MergePersonResponse, ApiClientError, { fromId: number; intoId: number }>({
    mutationFn: ({ fromId, intoId }) => request('POST', `/api/people/${fromId}/merge`, { intoId }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.importReview(importId) })
      void qc.invalidateQueries({ queryKey: queryKeys.importDetail(importId) })
      void qc.invalidateQueries({ queryKey: queryKeys.peopleIndex() })
      void qc.invalidateQueries({ queryKey: queryKeys.home() })
      void qc.invalidateQueries({ queryKey: ['person'] })
      void qc.invalidateQueries({ queryKey: ['search'] })
    },
  })
}

export function useRetryFailed(importId: number) {
  const qc = useQueryClient()
  return useMutation<JobsRetryResponse, ApiClientError, void>({
    mutationFn: () => request('POST', `/api/imports/${importId}/jobs/retry`, {}),
    onSuccess: (res) => {
      applyProgress(qc, importId, res.progress, res.reset > 0 || res.progress.pending > 0 ? 'extracting' : undefined)
    },
  })
}

export const deleteImportRequest = (importId: number) => request<DeleteImportResult>('DELETE', `/api/imports/${importId}`)
