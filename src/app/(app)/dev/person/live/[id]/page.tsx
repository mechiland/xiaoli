import { PersonView } from '@/components/person'
import { getDb } from '@/server/db'
import { getSelfPersonId } from '@/server/person'
import { getServerUser } from '@/server/session'

// Dev-only (dev/layout.tsx): the person view WITHOUT server-provided data, so the client fetches
// GET /api/people/:id — the showcase delays or fails that route to show the loading and per-block error states,
// and stubs it to show fixture profiles (e.g. a person with only proposed items).
export const dynamic = 'force-dynamic'

export default async function PersonLiveShowcase({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  const user = await getServerUser()
  const selfId = user ? await getSelfPersonId(getDb(), user.id) : null
  return <PersonView id={id} selfId={selfId} />
}
