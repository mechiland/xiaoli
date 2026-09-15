'use client'
// BOOTSTRAP PLACEHOLDER created by core (ARCHITECTURE §1.1). Owner: import — overwrite freely.
// Exports exactly the §2.8 names/props with minimal behaviour.

import { useSyncExternalStore } from 'react'

export interface ImportOverlayOpenOptions {
  /** preselect chat in step 2 */
  chatId?: number
  /** skip file picker */
  file?: File
}

type OverlayState = { isOpen: boolean; opts: ImportOverlayOpenOptions | null }
let state: OverlayState = { isOpen: false, opts: null }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getSnapshot = () => state
const serverSnapshot: OverlayState = { isOpen: false, opts: null }

export function useImportOverlay(): { open: (opts?: ImportOverlayOpenOptions) => void; close: () => void; isOpen: boolean } {
  const s = useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot)
  return {
    isOpen: s.isOpen,
    open: (opts) => {
      state = { isOpen: true, opts: opts ?? null }
      emit()
    },
    close: () => {
      state = { isOpen: false, opts: null }
      emit()
    },
  }
}

/** No props; mounted once by core; the real one includes the drag-and-drop layer ("松开以导入"). Placeholder renders nothing. */
export function ImportOverlayHost(): React.JSX.Element {
  return <></>
}

export interface AttachmentUploadState {
  phase: 'idle' | 'uploading' | 'done' | 'needs_file' | 'error'
  total: number
  uploaded: number
  failedNames: string[]
  bytesTotal: number
  bytesUploaded: number
  retry: () => void
  resumeWithFile: (file: File) => Promise<'ok' | 'sha_mismatch' | 'parse_error'>
}

export function useAttachmentUploads(_importId: number): AttachmentUploadState {
  return {
    phase: 'idle',
    total: 0,
    uploaded: 0,
    failedNames: [],
    bytesTotal: 0,
    bytesUploaded: 0,
    retry: () => {},
    resumeWithFile: async () => 'parse_error',
  }
}

export function AttachmentUploadStatus(_props: { importId: number; className?: string }): React.JSX.Element | null {
  return null
}
