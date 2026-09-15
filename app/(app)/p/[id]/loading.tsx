import { PageShell } from '@/components/loam'
import { PersonSkeleton } from '@/components/person'

export default function PersonLoading() {
  return (
    <PageShell>
      <PersonSkeleton />
    </PageShell>
  )
}
