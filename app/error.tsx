'use client'

import { BlockError, PageShell } from '@/components/loam'

export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageShell title="出错了" width="reading">
      <BlockError message="页面没有加载出来" onRetry={reset} />
    </PageShell>
  )
}
