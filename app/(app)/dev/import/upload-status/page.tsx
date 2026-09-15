import { PageShell } from '@/components/loam'
import { UploadStatusSamples } from './samples'

// Showcase host for the attachment upload status line (verify import/showcase, import/upload-resume).
// Until import-result (wave 3) mounts <AttachmentUploadStatus> on /imports/:id, this page is where the line is visible.
// /dev/** is 404 outside development.
export default async function UploadStatusShowcase({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const raw = (await searchParams).id
  const ids = (Array.isArray(raw) ? raw : (raw ?? '').split(','))
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0)
  return (
    <PageShell title="这份聊天记录带来的变化" subtitle="上传状态示例" width="reading">
      <UploadStatusSamples ids={ids} />
    </PageShell>
  )
}
