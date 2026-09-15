'use client'
// The extraction progress loop (SPEC §9.9 "页面保持打开时，前端依次调用处理端点推进任务").
// One loop per import id at module scope: sequential POST /jobs/next while at least one page instance is mounted.
// React StrictMode double effects and quick back/forward navigation re-attach to the running loop instead of
// starting a second one; leaving the page stops scheduling (the in-flight request finishes on the server).

import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { ApiClientError } from '@/lib/api-client'
import { queryKeys } from '@/lib/query'
import { applyProgress, postJobsNext } from './data'

export type LoopPhase = 'idle' | 'running' | 'error'
export interface LoopSnapshot {
  phase: LoopPhase
  error: string | null
  /** true while halted for a delete */
  halted: boolean
}

interface Entry {
  owners: number
  running: boolean
  halted: boolean
  inflight: Promise<unknown> | null
  qc: QueryClient | null
  snap: LoopSnapshot
  listeners: Set<() => void>
}

const IDLE: LoopSnapshot = { phase: 'idle', error: null, halted: false }
const entries = new Map<number, Entry>()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function entryOf(importId: number): Entry {
  let e = entries.get(importId)
  if (!e) {
    e = { owners: 0, running: false, halted: false, inflight: null, qc: null, snap: IDLE, listeners: new Set() }
    entries.set(importId, e)
  }
  return e
}

function setSnap(e: Entry, patch: Partial<LoopSnapshot>) {
  e.snap = { ...e.snap, ...patch }
  for (const l of e.listeners) l()
}

async function run(importId: number, e: Entry) {
  e.running = true
  setSnap(e, { phase: 'running', error: null })
  try {
    while (e.owners > 0 && !e.halted) {
      const p = postJobsNext(importId)
      e.inflight = p
      let res
      try {
        res = await p
      } finally {
        e.inflight = null
      }
      const qc = e.qc
      if (qc) {
        applyProgress(qc, importId, res.progress, res.importStatus)
        if (res.processed) void qc.invalidateQueries({ queryKey: queryKeys.importReview(importId) })
      }
      if (res.importStatus !== 'extracting') {
        if (qc) {
          void qc.invalidateQueries({ queryKey: queryKeys.importReview(importId) })
          void qc.invalidateQueries({ queryKey: queryKeys.importDetail(importId) })
          void qc.invalidateQueries({ queryKey: queryKeys.home() })
        }
        break
      }
      // nothing claimable right now (another tab holds the running window): wait before asking again
      if (!res.processed) await sleep(2000)
    }
    setSnap(e, { phase: 'idle' })
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404 && e.qc) {
      void e.qc.invalidateQueries({ queryKey: queryKeys.importDetail(importId) })
    }
    const message = err instanceof ApiClientError && err.status > 0 && err.code !== 'internal' ? err.message : '读取中断了'
    setSnap(e, { phase: 'error', error: message })
  } finally {
    e.running = false
  }
}

function kick(importId: number) {
  const e = entryOf(importId)
  if (e.running || e.halted || e.owners === 0 || e.snap.phase === 'error') return
  void run(importId, e)
}

export function useExtractionLoop(importId: number, active: boolean) {
  const qc = useQueryClient()
  const e = entryOf(importId)
  const snap = useSyncExternalStore(
    (l) => {
      e.listeners.add(l)
      return () => e.listeners.delete(l)
    },
    () => e.snap,
    () => IDLE,
  )

  useEffect(() => {
    if (!active) return
    e.qc = qc
    e.owners += 1
    kick(importId)
    return () => {
      e.owners -= 1
    }
  }, [active, e, importId, qc])

  const resume = useCallback(() => {
    setSnap(e, { phase: 'idle', error: null })
    kick(importId)
  }, [e, importId])

  /** Stop scheduling and wait for the request in flight (delete-import: "the progress loop stops first"). */
  const halt = useCallback(async () => {
    e.halted = true
    setSnap(e, { halted: true })
    try {
      await e.inflight
    } catch {
      // its failure no longer matters
    }
  }, [e])

  const unhalt = useCallback(() => {
    e.halted = false
    setSnap(e, { halted: false })
    kick(importId)
  }, [e, importId])

  return { ...snap, running: snap.phase === 'running', resume, halt, unhalt }
}
