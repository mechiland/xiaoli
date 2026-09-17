import Link from 'next/link'
import type { PersonRefDTO } from '@/contracts'
import { personHref } from '@/lib/links'
import { linkMentions, sentence } from './format'

/** A claim sentence with mentioned persons linked (first occurrence each) and terminal punctuation. */
export function Statement({
  text,
  mentions,
  selfId,
  terminal = true,
  linkClassName = 'loam-link',
}: {
  text: string
  mentions: PersonRefDTO[]
  selfId: number | null
  terminal?: boolean
  linkClassName?: string
}) {
  const parts = linkMentions(terminal ? sentence(text) : text, mentions, selfId)
  return (
    <>
      {parts.map((p, i) =>
        'person' in p ? (
          <Link key={i} href={personHref(p.person.id)} className={linkClassName}>
            {p.text}
          </Link>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

/**
 * Inline spacing before trailing pieces (date, 确认 / 不对, hover actions). A widened collapsible space instead of a
 * margin: when the next piece wraps, the space is dropped at the line break, so the piece starts at the text edge.
 */
export function Gap({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span aria-hidden className={size === 'sm' ? '[word-spacing:0.28em]' : '[word-spacing:0.55em]'}>
      {' '}
    </span>
  )
}

/** Small inline text button used across the page ("确认", "不对", "改写", "补充"). */
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
  tone?: 'default' | 'quiet' | 'danger'
  className?: string
  type?: 'button' | 'submit'
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'>) {
  const toneCls =
    tone === 'danger'
      ? 'text-danger decoration-danger/40 hover:decoration-danger'
      : tone === 'quiet'
        ? 'text-ink-3 no-underline hover:text-ink-2'
        : 'text-ink-2 decoration-line-strong hover:text-ink hover:decoration-ink'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`font-sans text-[13px] leading-6 underline underline-offset-[3px] transition-colors disabled:cursor-default disabled:opacity-50 ${toneCls} ${className ?? ''}`}
      {...rest}
    >
      {children}
    </button>
  )
}

/** Inline failure line under a control. */
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
