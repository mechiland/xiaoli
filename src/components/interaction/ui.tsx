'use client'
// Small shared pieces of the 来往 UI. Deliberate copies of the person page's idiom (each module owns its own
// components; only the public entries cross module lines, ARCHITECTURE §0).
import { cn } from '@/lib/cn'

/** Inline spacing before a trailing piece; dropped at a line break so the piece starts at the text edge. */
export function Gap({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span aria-hidden className={size === 'sm' ? '[word-spacing:0.28em]' : '[word-spacing:0.55em]'}>
      {' '}
    </span>
  )
}

/** " ·" glued to the end of the piece before it: a line may end with the separator, never start with one. */
export function Sep({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('px-0.5 text-ink-3', className)}>
      {' ·'}
    </span>
  )
}

export function TextButton({
  children,
  onClick,
  disabled,
  tone = 'default',
  className,
  type = 'button',
  ...rest
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  tone?: 'default' | 'quiet'
  className?: string
  type?: 'button' | 'submit'
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'>) {
  const toneCls =
    tone === 'quiet'
      ? 'text-ink-3 no-underline hover:text-ink-2'
      : 'text-ink-2 decoration-line-strong hover:text-ink hover:decoration-ink'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn('font-sans text-[13px] leading-6 underline underline-offset-[3px] transition-colors disabled:cursor-default disabled:opacity-50', toneCls, className)}
      {...rest}
    >
      {children}
    </button>
  )
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <p role="alert" className="mt-1 text-[13px] leading-6 text-danger">
      {message}
      {onRetry && (
        <>
          <span className="px-1.5 text-ink-3">·</span>
          <button type="button" onClick={onRetry} className="loam-text-button">
            重试
          </button>
        </>
      )}
    </p>
  )
}

/** Two text buttons separated by a slash — "确认 / 不对", "已完成 / 不用管". */
export function ButtonPair({
  first,
  second,
  disabled,
  onFirst,
  onSecond,
}: {
  first: string
  second: string
  disabled?: boolean
  onFirst: () => void
  onSecond: () => void
}) {
  return (
    <span className="inline-flex items-baseline gap-2 whitespace-nowrap align-baseline">
      <TextButton disabled={disabled} onClick={onFirst}>
        {first}
      </TextButton>
      <span className="text-[12px] text-ink-3" aria-hidden>
        /
      </span>
      <TextButton disabled={disabled} onClick={onSecond}>
        {second}
      </TextButton>
    </span>
  )
}

export const inputCls =
  'h-9 w-full min-w-0 rounded-[2px] border border-line-strong bg-paper px-3 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-3 focus-visible:border-ink-2 disabled:opacity-60'
