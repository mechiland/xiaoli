// BOOTSTRAP PLACEHOLDER created by core (ARCHITECTURE §1.1). Owner: import-result — overwrite freely.
import { Meta, PageShell } from '@/components/loam'

export default async function ImportResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <PageShell title={`导入 #${id}`} width="reading">
      <Meta>这一页还在建设中</Meta>
    </PageShell>
  )
}
