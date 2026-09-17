import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Meta, PageTitle } from './Typography'

/**
 * Page shell: centered column on the warm ground. `width="reading"` for article-like pages (≈ 680px),
 * `"wide"` for pages with a side infobox (≈ 1040px).
 */
export function PageShell({
  title,
  subtitle,
  actions,
  width = 'wide',
  className,
  children,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  width?: 'reading' | 'wide'
  className?: string
  children?: ReactNode
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-5 pb-24 pt-10 sm:px-8 sm:pt-14',
        width === 'reading' ? 'max-w-[720px]' : 'max-w-[1180px]',
        className,
      )}
    >
      {(title || actions) && (
        <header className="mb-8 flex items-start justify-between gap-6 border-b border-line pb-5">
          <div className="min-w-0">
            {title && <PageTitle>{title}</PageTitle>}
            {subtitle && <Meta className="mt-2">{subtitle}</Meta>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-3 pt-2">{actions}</div>}
        </header>
      )}
      {children}
    </div>
  )
}
