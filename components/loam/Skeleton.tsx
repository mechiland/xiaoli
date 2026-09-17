import { cn } from '@/lib/cn'

/** Loading placeholder in the block's shape: flat warm bars, no shimmer gradient, no shadow. */
export function Skeleton({ className, ...rest }: React.ComponentProps<'div'>) {
  return <div aria-hidden className={cn('loam-skeleton h-4 w-full', className)} {...rest} />
}

/** N text lines of decreasing width. */
export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  const widths = ['w-full', 'w-11/12', 'w-4/5', 'w-2/3', 'w-3/4']
  return (
    <div className={cn('space-y-3', className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={widths[i % widths.length]} />
      ))}
    </div>
  )
}
