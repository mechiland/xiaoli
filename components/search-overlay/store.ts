'use client'
// Module-level open state for the search overlay (ARCHITECTURE §1 "UI slots"): works from any client component, no provider.
import { useSyncExternalStore } from 'react'

export type SearchOverlayState = { isOpen: boolean; q: string; openCount: number }

let state: SearchOverlayState = { isOpen: false, q: '', openCount: 0 }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const serverSnapshot: SearchOverlayState = { isOpen: false, q: '', openCount: 0 }

export const getSearchOverlayState = () => state

export function openSearch(q?: string) {
  state = { isOpen: true, q: q ?? '', openCount: state.openCount + 1 }
  emit()
}

export function closeSearch() {
  if (!state.isOpen) return
  state = { ...state, isOpen: false }
  emit()
}

export function useSearchOverlayState(): SearchOverlayState {
  return useSyncExternalStore(subscribe, getSearchOverlayState, () => serverSnapshot)
}
