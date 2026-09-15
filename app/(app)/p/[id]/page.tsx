import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'
import { PersonView } from '@/components/person'
import { personHref, signInHref } from '@/lib/links'
import { queryKeys } from '@/lib/query'
import { getDb } from '@/server/db'
import { ApiError } from '@/server/errors'
import { loadPersonPage, type ProfileResult } from '@/server/person'
import { getServerUser } from '@/server/session'

// Server Component first paint (ARCHITECTURE §2.7, P2): profile fetched server-side, then TanStack Query takes over.
export const dynamic = 'force-dynamic'

type Loaded = { ok: true; profile: ProfileResult; selfId: number | null } | { ok: false; status: number }

const load = cache(async (ownerId: string, id: number): Promise<Loaded> => {
  try {
    const { profile, selfId } = await loadPersonPage(getDb(), ownerId, id)
    return { ok: true, profile, selfId }
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500
    if (status >= 500) console.log(JSON.stringify({ level: 'error', msg: 'person_page_load_failed', personId: id, name: (e as Error)?.name }))
    return { ok: false, status }
  }
})

function parseId(raw: string): number | null {
  return /^\d{1,12}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const id = parseId((await params).id)
  const user = await getServerUser()
  if (!id || !user) return {}
  const r = await load(user.id, id)
  return r.ok && 'person' in r.profile ? { title: r.profile.person.label } : {}
}

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (!id) notFound()
  const user = await getServerUser()
  if (!user) redirect(signInHref)

  const r = await load(user.id, id)
  if (!r.ok && r.status === 404) notFound()
  if (r.ok && 'redirectTo' in r.profile) redirect(personHref(r.profile.redirectTo))

  // A failed server fetch never throws the page: the view refetches through the API and shows per-block errors.
  const qc = new QueryClient()
  if (r.ok) qc.setQueryData(queryKeys.person(id), r.profile)
  const selfId = r.ok ? r.selfId : null
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <PersonView id={id} selfId={selfId} />
    </HydrationBoundary>
  )
}
