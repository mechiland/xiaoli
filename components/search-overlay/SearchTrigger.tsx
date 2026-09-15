'use client'

import { Search } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { cn } from '@/lib/cn'
import { openSearch } from './store'

export interface SearchTriggerProps {
  /** 'hero' = home page's largest element; 'topbar' collapses to an icon button under 640px */
  variant: 'hero' | 'topbar'
  className?: string
}

const noopSubscribe = () => () => {}
/** "⌘K" on Apple platforms, "Ctrl K" elsewhere; empty during SSR so hydration never mismatches. */
function useShortcutLabel(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => (/Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K'),
    () => '',
  )
}

export function SearchTrigger({ variant, className }: SearchTriggerProps): React.JSX.Element {
  const shortcut = useShortcutLabel()
  if (variant === 'hero') {
    return (
      <button
        type="button"
        onClick={() => openSearch()}
        aria-keyshortcuts="Meta+K Control+K /"
        className={cn(
          'group flex h-16 w-full items-center gap-4 border border-line bg-paper px-6 text-left text-[18px] text-ink-3 transition-colors hover:border-line-strong',
          className,
        )}
      >
        <Search className="size-5 shrink-0" strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 flex-1 truncate">搜索人物、别名或信息</span>
        {shortcut && <kbd className="hidden shrink-0 border border-line px-1.5 font-data text-[12px] leading-5 text-ink-3 sm:inline">{shortcut}</kbd>}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => openSearch()}
      aria-label="搜索"
      aria-keyshortcuts="Meta+K Control+K /"
      className={cn(
        'flex h-8 items-center gap-2 border border-line bg-paper text-[13px] text-ink-3 transition-colors hover:border-line-strong',
        'w-8 justify-center sm:w-full sm:max-w-[360px] sm:justify-start sm:px-3',
        className,
      )}
    >
      <Search className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
      <span className="hidden truncate sm:inline">搜索人物、别名或信息</span>
      {shortcut && <kbd className="ml-auto hidden font-data text-[11px] text-ink-3 sm:inline">{shortcut}</kbd>}
    </button>
  )
}
