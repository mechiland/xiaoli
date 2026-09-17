import Link from 'next/link'
import { Meta, PageShell } from '@/components/loam'

export default function NotFound() {
  return (
    <PageShell title="没有找到这一页" width="reading">
      <Meta>
        链接可能已经失效。<Link href="/" className="loam-link">回到首页</Link>
      </Meta>
    </PageShell>
  )
}
