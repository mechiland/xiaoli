// Client attachment upload queue (ARCHITECTURE §1.4 "Attachment upload lifecycle").
// Module scope: survives the overlay closing and client-side navigation. Holds the ZIP `File`, not unzipped bytes.
import type { ImportDetailResponse } from '@/contracts'
import { readMediaFiles, sha256Hex } from '@/lib/wechat-export'
import { importUrl, requestJson } from './http'

export type UploadPhase = 'idle' | 'uploading' | 'done' | 'needs_file' | 'error'

export interface UploadEntry {
  file: File
  sha256: string
  /** selected attachment names */
  names: string[]
  phase: Exclude<UploadPhase, 'needs_file'>
  total: number
  uploaded: number
  failedNames: string[]
  bytesTotal: number
  bytesUploaded: number
}

const entries = new Map<number, UploadEntry>()
const running = new Set<number>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function subscribeUploads(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function getUploadEntry(importId: number): UploadEntry | undefined {
  return entries.get(importId)
}

/** Ids with a runner entry in this tab, as a stable string snapshot ("12,13") for useSyncExternalStore. */
export function uploadIdsKey(): string {
  return [...entries.keys()].join(',')
}

function patch(importId: number, p: Partial<UploadEntry>): void {
  const cur = entries.get(importId)
  if (!cur) return
  entries.set(importId, { ...cur, ...p })
  emit()
}

/** After POST /api/imports returns the id (overlay step 1). Nothing uploads until startUploads. */
export function registerUpload(importId: number, file: File, sha256: string, names: string[]): void {
  entries.set(importId, { file, sha256, names, phase: 'idle', total: names.length, uploaded: 0, failedNames: [], bytesTotal: 0, bytesUploaded: 0 })
  emit()
}

export function removeUpload(importId: number): void {
  if (entries.delete(importId)) emit()
}

export const UPLOAD_RETRIES = 2
export const RETRY_DELAYS_MS = [600, 1800]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Uploads the selected names the server still reports as pending, one at a time, 2 retries each.
 * Returns when the queue is drained. Concurrent calls for the same import are ignored.
 */
export async function startUploads(importId: number, deps: { fetch?: typeof fetch; delays?: number[] } = {}): Promise<void> {
  const entry = entries.get(importId)
  if (!entry || running.has(importId)) return
  running.add(importId)
  const doFetch = deps.fetch ?? fetch
  const delays = deps.delays ?? RETRY_DELAYS_MS
  try {
    patch(importId, { phase: 'uploading', failedNames: [] })
    let pending: string[]
    try {
      const detail = await requestJson<ImportDetailResponse>('GET', importUrl(importId), undefined, { cache: 'no-store' })
      pending = detail.uploads.pendingNames
    } catch {
      patch(importId, { phase: 'error', failedNames: entry.names })
      return
    }
    const wanted = entry.names.length ? entry.names : pending
    const todo = wanted.filter((n) => pending.includes(n))
    const already = wanted.length - todo.length
    patch(importId, { total: wanted.length, uploaded: already })
    if (todo.length === 0) {
      patch(importId, { phase: 'done' })
      return
    }

    const media = await readMediaFiles(new Uint8Array(await entry.file.arrayBuffer()), todo)
    const bytesTotal = todo.reduce((s, n) => s + (media.get(n)?.byteLength ?? 0), 0)
    patch(importId, { bytesTotal, bytesUploaded: 0 })

    let uploaded = already
    let bytesUploaded = 0
    const failed: string[] = []
    for (const name of todo) {
      const data = media.get(name)
      if (!data) {
        failed.push(name)
        continue
      }
      let ok = false
      for (let attempt = 0; attempt <= UPLOAD_RETRIES && !ok; attempt++) {
        if (attempt > 0) await sleep(delays[attempt - 1] ?? 1000)
        try {
          const res = await doFetch(`${importUrl(importId)}/attachments/${encodeURIComponent(name)}`, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/octet-stream' },
            body: data as unknown as BodyInit,
          })
          if (res.ok) ok = true
          else if (res.status === 404 || res.status === 413 || res.status === 400) break // not retryable
        } catch {
          // network error → retry
        }
      }
      if (ok) {
        uploaded++
        bytesUploaded += data.byteLength
        patch(importId, { uploaded, bytesUploaded })
      } else {
        failed.push(name)
      }
    }
    patch(importId, { phase: failed.length ? 'error' : 'done', failedNames: failed })
  } finally {
    running.delete(importId)
  }
}

/** Retry only the failed names (file still in the store). */
export function retryUploads(importId: number): Promise<void> {
  return startUploads(importId)
}

/** Reload / new tab: re-select the same ZIP. The sha must match the import's file. */
export async function resumeWithFile(importId: number, file: File, expectedSha: string, pendingNames: string[]): Promise<'ok' | 'sha_mismatch' | 'parse_error'> {
  let sha: string
  try {
    sha = await sha256Hex(new Uint8Array(await file.arrayBuffer()))
  } catch {
    return 'parse_error'
  }
  if (sha !== expectedSha) return 'sha_mismatch'
  registerUpload(importId, file, sha, pendingNames)
  void startUploads(importId)
  return 'ok'
}

/** Test hook. */
export function __resetUploadsForTests(): void {
  entries.clear()
  running.clear()
}
