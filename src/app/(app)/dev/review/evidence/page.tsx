import { eq } from 'drizzle-orm'
import { claims, getDb, owned } from '@/server/db'
import { getServerUser } from '@/server/session'
import { EvidenceShowcase, type LiveClaim } from './showcase'

// Showcase for the shared evidence component (ARCHITECTURE §12 `review/evidence-showcase`). Dev only (dev/layout.tsx).
export const dynamic = 'force-dynamic'

async function loadLive(ownerId: string | null, raw: string | string[] | undefined): Promise<LiveClaim | null> {
  if (!ownerId || typeof raw !== 'string' || !/^\d+$/.test(raw)) return null
  const row = await getDb()
    .select({ id: claims.id, statement: claims.statement, sourceKind: claims.sourceKind })
    .from(claims)
    .where(owned(claims, ownerId, eq(claims.id, Number(raw))))
    .get()
  return row ?? null
}

export default async function EvidenceShowcasePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const user = await getServerUser()
  const live = (await Promise.all([loadLive(user?.id ?? null, sp.claim), loadLive(user?.id ?? null, sp.claim2)])).filter((x): x is LiveClaim => x !== null)
  return <EvidenceShowcase live={live} />
}
