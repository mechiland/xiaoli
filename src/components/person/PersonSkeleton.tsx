import { Skeleton, SkeletonLines } from '@/components/loam'

/** Loading shape of the person page: title, alias line, infobox column, two sections. */
export function PersonSkeleton() {
  return (
    <div aria-busy="true" aria-label="正在加载人物" data-person-skeleton>
      <div className="mb-8 border-b border-line pb-5 lg:mb-10">
        <Skeleton className="h-9 w-40 sm:h-10" />
        <Skeleton className="mt-3 h-3.5 w-56" />
      </div>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-12">
        <div className="mb-8 border border-line bg-paper px-4 py-3 lg:order-2 lg:mb-0 lg:px-5 lg:py-4">
          <SkeletonLines lines={2} className="lg:hidden" />
          <div className="hidden space-y-4 lg:block">
            <Skeleton className="h-4 w-24" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="grid grid-cols-[84px_1fr] gap-3">
                <Skeleton className="h-3.5 w-12" />
                <Skeleton className="h-3.5" />
              </div>
            ))}
          </div>
        </div>
        <div className="min-w-0 lg:order-1">
          {[5, 3].map((n, i) => (
            <div key={i} className={i > 0 ? 'mt-10' : ''}>
              <Skeleton className="h-5 w-16" />
              <div className="mt-3 border-t border-line pt-4">
                <SkeletonLines lines={n} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
