'use client'
// Public entry `@/components/search-overlay` (ARCHITECTURE §1.8, §2.8). Owner: search.

import { closeSearch, openSearch, useSearchOverlayState } from './store'

export { SearchOverlayHost } from './SearchOverlay'
export { SearchTrigger, type SearchTriggerProps } from './SearchTrigger'

export function useSearchOverlay(): { open: (q?: string) => void; close: () => void; isOpen: boolean } {
  const s = useSearchOverlayState()
  return { isOpen: s.isOpen, open: openSearch, close: closeSearch }
}
