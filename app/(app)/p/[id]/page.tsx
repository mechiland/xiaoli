// BOOTSTRAP PLACEHOLDER created by core (ARCHITECTURE §1.1). Owner: person — overwrite freely.
import { Meta, PageShell } from '@/components/loam'

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <PageShell title={`人物 #${id}`}>
      <Meta>这一页还在建设中</Meta>
    </PageShell>
  )
}
