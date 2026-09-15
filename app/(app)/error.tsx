'use client'

import { BlockError, PageShell } from '@/components/loam'

/** Last-resort page error; the top bar (layout) stays intact. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageShell title="这一页没有加载出来" width="reading">
      <BlockError message="可能是网络或服务器暂时出了问题" onRetry={reset} />
    </PageShell>
  )
}
