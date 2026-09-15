'use client'
// BOOTSTRAP PLACEHOLDER created by core (ARCHITECTURE §1.1). Owner: search — overwrite freely.

import { Search } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { cn } from '@/lib/cn'

type OverlayState = { isOpen: boolean; q: string }
let state: OverlayState = { isOpen: false, q: '' }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const serverSnapshot: OverlayState = { isOpen: false, q: '' }

export function useSearchOverlay(): { open: (q?: string) => void; close: () => void; isOpen: boolean } {
  const s = useSyncExternalStore(subscribe, () => state, () => serverSnapshot)
  return {
    isOpen: s.isOpen,
    open: (q) => {
      state = { isOpen: true, q: q ?? '' }
      emit()
    },
    close: () => {
      state = { isOpen: false, q: '' }
      emit()
    },
  }
}

/** No props; the real host registers ⌘K / Ctrl K / '/'. Placeholder renders nothing. */
export function SearchOverlayHost(): React.JSX.Element {
  return <></>
}

export interface SearchTriggerProps {
  /** 'hero' = home page's largest element; 'topbar' collapses to an icon button under 640px */
  variant: 'hero' | 'topbar'
  className?: string
}

export function SearchTrigger({ variant, className }: SearchTriggerProps): React.JSX.Element {
  const { open } = useSearchOverlay()
  if (variant === 'hero') {
    return (
      <button
        type="button"
        onClick={() => open()}
        className={cn(
          'flex h-16 w-full items-center gap-4 border border-line bg-paper px-6 text-left text-[18px] text-ink-3 hover:border-line-strong',
          className,
        )}
      >
        <Search className="size-5" strokeWidth={1.5} aria-hidden />
        搜索人物、别名或信息
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => open()}
      aria-label="搜索"
      className={cn(
        'flex h-8 items-center gap-2 border border-line bg-paper text-[13px] text-ink-3 hover:border-line-strong',
        'w-8 justify-center sm:w-full sm:max-w-[360px] sm:justify-start sm:px-3',
        className,
      )}
    >
      <Search className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
      <span className="hidden truncate sm:inline">搜索人物、别名或信息</span>
      <kbd className="ml-auto hidden font-data text-[11px] text-ink-3 sm:inline">⌘K</kbd>
    </button>
  )
}
