import { PageShell, Skeleton, SkeletonLines } from '@/components/loam'

export default function AppLoading() {
  return (
    <PageShell width="reading">
      <Skeleton className="mb-8 h-9 w-48" />
      <SkeletonLines lines={5} />
    </PageShell>
  )
}
