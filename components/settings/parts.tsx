'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import type { SaveState } from './hooks'

/**
 * One setting: name on the left (168px column from 640px up), control and a quiet explanation on the right.
 * Stacks under 640px. Rows inside a section are separated by a 1px hairline.
 */
export function SettingRow({
  label,
  htmlFor,
  status,
  hint,
  align = 'text',
  children,
  className,
  ...rest
}: {
  label: ReactNode
  htmlFor?: string
  status?: ReactNode
  hint?: ReactNode
  /** 'control': the right column starts with a 36px input/button, so the name drops 4px to share its centre line */
  align?: 'text' | 'control'
  children: ReactNode
  className?: string
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>) {
  const Name = htmlFor ? 'label' : 'div'
  return (
    <div className={cn('grid gap-y-3 border-t border-line py-6 first:border-t-0 sm:grid-cols-[168px_minmax(0,1fr)] sm:gap-x-10', className)} {...rest}>
      <div className={cn('flex min-w-0 items-baseline justify-between gap-4 sm:block', align === 'control' && 'sm:pt-1')}>
        <Name {...(htmlFor ? { htmlFor } : {})} className="block text-[15px] leading-7 text-ink">
          {label}
        </Name>
        {status && <div className="shrink-0 sm:mt-0.5">{status}</div>}
      </div>
      <div className="min-w-0">
        {children}
        {hint && <p className="mt-3 max-w-[460px] text-[13px] leading-6 text-ink-3">{hint}</p>}
      </div>
    </div>
  )
}

/** Quiet inline save feedback: "正在保存…" → "已保存" (fades) / "没有保存成功 · 重试". Never a toast. */
export function SaveNote({ state, onRetry, savedText = '已保存' }: { state: SaveState; onRetry?: () => void; savedText?: string }) {
  return (
    <span aria-live="polite" data-save-state={state} className="block min-h-5 font-data text-[12px] leading-5">
      {state === 'saving' && <span className="text-ink-3">正在保存…</span>}
      {state === 'saved' && <span className="text-ink-3 motion-safe:animate-[settings-fade_2.4s_ease-in_forwards]">{savedText}</span>}
      {state === 'error' && (
        <span role="alert" className="text-danger">
          没有保存成功
          {onRetry && (
            <>
              <span className="px-1 text-ink-3">·</span>
              <button type="button" onClick={onRetry} className="loam-text-button">
                重试
              </button>
            </>
          )}
        </span>
      )}
    </span>
  )
}

/** Inline field error in the Loam danger tone with a 1px left rule (same as the auth form). */
export function FieldError({ children, id, className }: { children: ReactNode; id?: string; className?: string }) {
  return (
    <p id={id} role="alert" className={cn('border-l border-danger pl-3 text-[13px] leading-6 text-danger', className)}>
      {children}
    </p>
  )
}

/** Keyframes for SaveNote's fade (kept local so no core CSS change is needed). */
export function SettingsStyles() {
  return <style>{`@keyframes settings-fade{0%,70%{opacity:1}100%{opacity:0}}`}</style>
}
