'use client'
// Overlay open state: module-level, so useImportOverlay() works from any client component without a provider (ARCHITECTURE §1 UI slots).
import { useSyncExternalStore } from 'react'

export interface ImportOverlayOpenOptions {
  /** preselect chat in step 2 */
  chatId?: number
  /** skip file picker */
  file?: File
}

export type OverlayState = { isOpen: boolean; opts: ImportOverlayOpenOptions | null; nonce: number }

let state: OverlayState = { isOpen: false, opts: null, nonce: 0 }
const serverSnapshot: OverlayState = { isOpen: false, opts: null, nonce: 0 }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function subscribeOverlay(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function getOverlayState(): OverlayState {
  return state
}

/**
 * True while the open overlay holds a created import (step 2 or submitting): a new open/drop must not replace it,
 * or the import would be orphaned without the abandon DELETE.
 */
let busy = false
export function setOverlayBusy(b: boolean): void {
  busy = b
}
export function isOverlayBusy(): boolean {
  return busy
}

export function openOverlay(opts?: ImportOverlayOpenOptions): void {
  if (state.isOpen && busy) return
  state = { isOpen: true, opts: opts ?? null, nonce: state.nonce + 1 }
  emit()
}

export function closeOverlay(): void {
  busy = false
  state = { isOpen: false, opts: null, nonce: state.nonce }
  emit()
}

export function useOverlayState(): OverlayState {
  return useSyncExternalStore(subscribeOverlay, getOverlayState, () => serverSnapshot)
}

export function useImportOverlay(): { open: (opts?: ImportOverlayOpenOptions) => void; close: () => void; isOpen: boolean } {
  const s = useOverlayState()
  return { isOpen: s.isOpen, open: openOverlay, close: closeOverlay }
}
