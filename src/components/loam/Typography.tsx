import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Props<T extends ElementType> = { as?: T; className?: string; children?: ReactNode } & Omit<
  ComponentPropsWithoutRef<T>,
  'as' | 'className' | 'children'
>

/** Page title — Noto Serif SC, the largest text on a page. */
export function PageTitle<T extends ElementType = 'h1'>({ as, className, ...rest }: Props<T>) {
  const Tag = (as ?? 'h1') as ElementType
  return <Tag className={cn('loam-page-title', className)} {...rest} />
}

/** Section heading — Noto Serif SC. */
export function SectionTitle<T extends ElementType = 'h2'>({ as, className, ...rest }: Props<T>) {
  const Tag = (as ?? 'h2') as ElementType
  return <Tag className={cn('loam-section-title', className)} {...rest} />
}

/** Reading prose — generous line-height. */
export function Prose<T extends ElementType = 'p'>({ as, className, ...rest }: Props<T>) {
  const Tag = (as ?? 'p') as ElementType
  return <Tag className={cn('loam-prose', className)} {...rest} />
}

/** Small secondary line (subtitles, "又名…"). */
export function Meta<T extends ElementType = 'p'>({ as, className, ...rest }: Props<T>) {
  const Tag = (as ?? 'p') as ElementType
  return <Tag className={cn('text-[13px] leading-6 text-ink-3', className)} {...rest} />
}

/** Data, labels, times — Inter with tabular figures. */
export function Data<T extends ElementType = 'span'>({ as, className, ...rest }: Props<T>) {
  const Tag = (as ?? 'span') as ElementType
  return <Tag className={cn('font-data tabular-nums', className)} {...rest} />
}

/** Uppercase-free small label (Inter) for field names and group letters. */
export function Label<T extends ElementType = 'span'>({ as, className, ...rest }: Props<T>) {
  const Tag = (as ?? 'span') as ElementType
  return <Tag className={cn('font-data text-[12px] tracking-wide text-ink-3', className)} {...rest} />
}

/** 1px hairline rule. */
export function Rule({ className }: { className?: string }) {
  return <hr className={cn('border-0 border-t border-line', className)} />
}
