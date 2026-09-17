import { getCloudflareContext } from '@opennextjs/cloudflare'
import { eq } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
import { ImportNotFound, ImportResult } from '@/components/import-result'
import { signInHref } from '@/lib/links'
import { getDb, imports, owned, persons } from '@/server/db'
import { parseServerEnv } from '@/server/env'
import { getServerUser } from '@/server/session'

// /imports/:id — import result page (SPEC §9.9, ARCHITECTURE §1.10). Blocks are client-fetched; the server only checks
// that the import exists for this owner (an unknown or deleted id renders the missing state without a failing client
// fetch) and finds the user's own person, so the page can say 我 like the person page does. DECISIONS IR14.
export const dynamic = 'force-dynamic'

export default async function ImportResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d{1,12}$/.test(id) || Number(id) <= 0) notFound()
  const user = await getServerUser()
  if (!user) redirect(signInHref)
  const importId = Number(id)
  // APP_TZ (ARCHITECTURE §3): IsoString dates on this page ("…建立") are shown as the calendar day in this zone
  const tz = parseServerEnv(getCloudflareContext().env as unknown as Record<string, unknown>).APP_TZ

  let exists = true
  let selfId: number | null = null
  try {
    const db = getDb()
    const [imp, self] = await Promise.all([
      db.select({ id: imports.id }).from(imports).where(owned(imports, user.id, eq(imports.id, importId))).get(),
      db.select({ id: persons.id }).from(persons).where(owned(persons, user.id, eq(persons.isSelf, true))).get(),
    ])
    exists = Boolean(imp)
    selfId = self?.id ?? null
  } catch (e) {
    // a failed lookup never throws the page: the client blocks fetch on their own and show their own errors
    console.log(JSON.stringify({ level: 'error', msg: 'import_page_lookup_failed', importId, name: (e as Error)?.name }))
  }
  if (!exists) return <ImportNotFound />
  return <ImportResult importId={importId} tz={tz} selfId={selfId} />
}
