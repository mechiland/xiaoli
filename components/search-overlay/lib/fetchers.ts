'use client'
import type { ClientResponse } from 'hono/client'
import type { PersonResponse, SearchResponse, SearchTypes } from '@/contracts'
import { api, unwrap } from '@/lib/api-client'

/** GET /api/search (search module). */
export async function fetchSearch(q: string, types: SearchTypes, limit: number, signal?: AbortSignal): Promise<SearchResponse> {
  const res = await api.search.$get({ query: { q, types, limit: String(limit) } }, { init: { signal } })
  return unwrap(res as unknown as ClientResponse<SearchResponse>)
}

/** POST /api/people (owned by review) — used by the "新建人物『q』" empty-state action. */
export async function createPerson(label: string): Promise<PersonResponse> {
  const res = await api.people.$post({ json: { label } })
  return unwrap(res as unknown as ClientResponse<PersonResponse>)
}
