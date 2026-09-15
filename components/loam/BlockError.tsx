'use client'

import { cn } from '@/lib/cn'

/** Inline error in a block's own space: "这一块没有加载出来 · 重试". */
export function BlockError({
  onRetry,
  message = '这一块没有加载出来',
  className,
}: {
  onRetry?: () => void
  message?: string
  className?: string
}) {
  return (
    <div role="alert" className={cn('border-l border-line-strong py-1 pl-3 text-[14px] leading-6 text-ink-2', className)}>
      {message}
      {onRetry && (
        <>
          <span className="px-1.5 text-ink-3">·</span>
          <button type="button" onClick={onRetry} className="loam-text-button">
            重试
          </button>
        </>
      )}
    </div>
  )
}
