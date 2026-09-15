import { notFound } from 'next/navigation'
import { ImportResult } from '@/components/import-result'

// /imports/:id — import result page (SPEC §9.9, ARCHITECTURE §1.10). Data is client-fetched per block.
export default async function ImportResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id) || Number(id) <= 0) notFound()
  return <ImportResult importId={Number(id)} />
}
