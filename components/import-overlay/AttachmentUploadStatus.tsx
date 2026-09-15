'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ImportDetailResponse } from '@/contracts'
import { ApiClientError } from '@/lib/api-client'
import { cn } from '@/lib/cn'
import { queryKeys } from '@/lib/query'
import { attachmentNoun } from './format'
import { importUrl, requestJson } from './http'
import { getUploadEntry, resumeWithFile, retryUploads, subscribeUploads, type UploadPhase } from './upload-store'

export interface AttachmentUploadState {
  phase: UploadPhase
  total: number
  uploaded: number
  failedNames: string[]
  bytesTotal: number
  bytesUploaded: number
  retry: () => void
  resumeWithFile: (file: File) => Promise<'ok' | 'sha_mismatch' | 'parse_error'>
}

type UploadsView = AttachmentUploadState & {
  /** names the line talks about (pending or selected), for 图片/附件 wording */
  names: string[]
  /** no runner in this tab and GET /api/imports/:id failed */
  loadError: boolean
  reload: () => void
}

const fetchDetail = (importId: number) => requestJson<ImportDetailResponse>('GET', importUrl(importId))

/** Store (this tab's upload runner) first; otherwise the server's `uploads` from GET /api/imports/:id. */
export function useAttachmentUploads(importId: number): UploadsView {
  const entry = useSyncExternalStore(
    subscribeUploads,
    () => getUploadEntry(importId),
    () => undefined,
  )
  const qc = useQueryClient()
  const detail = useQuery({
    queryKey: queryKeys.importDetail(importId),
    queryFn: () => fetchDetail(importId),
    enabled: importId > 0,
    retry: (count, err) => !(err instanceof ApiClientError && err.status < 500) && count < 2,
  })

  // when this tab's runner finishes, the server's numbers changed
  const lastPhase = useRef(entry?.phase)
  useEffect(() => {
    if (lastPhase.current !== entry?.phase && (entry?.phase === 'done' || entry?.phase === 'error')) {
      void qc.invalidateQueries({ queryKey: queryKeys.importDetail(importId) })
    }
    lastPhase.current = entry?.phase
  }, [entry?.phase, importId, qc])

  const retry = () => void retryUploads(importId)
  const reload = () => void detail.refetch()
  const resume = async (file: File) => {
    const d: ImportDetailResponse = detail.data ?? (await qc.fetchQuery<ImportDetailResponse>({ queryKey: queryKeys.importDetail(importId), queryFn: () => fetchDetail(importId) }))
    return resumeWithFile(importId, file, d.import.fileSha256, d.uploads.pendingNames)
  }

  const common = { retry, resumeWithFile: resume, reload, loadError: false }
  if (entry && entry.phase !== 'idle') {
    return { ...entry, ...common, phase: entry.phase, names: entry.names }
  }
  const base = { ...common, failedNames: [], bytesTotal: 0, bytesUploaded: 0 }
  const u = detail.data?.uploads
  if (!u) return { ...base, phase: 'idle', total: 0, uploaded: 0, names: [], loadError: detail.isError }
  if (u.selected === 0) return { ...base, phase: 'idle', total: 0, uploaded: 0, names: [] }
  if (u.pendingNames.length > 0) return { ...base, phase: 'needs_file', total: u.selected, uploaded: u.uploaded, names: u.pendingNames }
  return { ...base, phase: 'done', total: u.selected, uploaded: u.uploaded, names: [] }
}

/** One quiet line under the import result subtitle (SPEC §8.2, §9.9). Renders null when nothing was selected. */
export function AttachmentUploadStatus({ importId, className }: { importId: number; className?: string }): React.JSX.Element | null {
  const s = useAttachmentUploads(importId)
  const input = useRef<HTMLInputElement>(null)
  const [resumeNote, setResumeNote] = useState<null | 'sha_mismatch' | 'parse_error' | 'reading'>(null)

  const line = (phase: string, content: React.ReactNode) => (
    <p role="status" aria-live="polite" data-upload-phase={phase} className={cn('text-[13px] leading-6 text-ink-3', className)}>
      {content}
    </p>
  )

  if (s.loadError) {
    return line(
      'load_error',
      <>
        <span>上传状态没有加载出来</span>
        <Sep />
        <button type="button" className="loam-text-button" onClick={s.reload}>
          重试
        </button>
      </>,
    )
  }
  if (s.phase === 'idle' || (s.phase === 'done' && s.total === 0)) return null
  const { noun, unit } = attachmentNoun(s.names.length ? s.names : s.failedNames)
  const pending = s.total - s.uploaded

  if (s.phase === 'uploading') {
    return line(
      s.phase,
      <span>
        正在上传{noun} <span className="font-data tabular-nums">{s.uploaded} / {s.total}</span>
      </span>,
    )
  }
  if (s.phase === 'done') return line(s.phase, <span>{noun}已上传</span>)
  if (s.phase === 'error') {
    return line(
      s.phase,
      <>
        <span>
          有 <span className="font-data tabular-nums">{s.failedNames.length}</span> {unit}{noun}没有上传成功
        </span>
        <Sep />
        <button type="button" className="loam-text-button" onClick={s.retry}>
          重试
        </button>
      </>,
    )
  }
  return line(
    s.phase,
    <>
      <span>
        {resumeNote === 'sha_mismatch' ? (
          '这不是同一份文件'
        ) : resumeNote === 'parse_error' ? (
          '无法读取这个文件'
        ) : (
          <>
            有 <span className="font-data tabular-nums">{pending}</span> {unit}{noun}还没有上传
          </>
        )}
      </span>
      <Sep />
      <button type="button" className="loam-text-button" disabled={resumeNote === 'reading'} onClick={() => input.current?.click()}>
        {resumeNote === 'sha_mismatch' || resumeNote === 'parse_error' ? '重新选择' : '重新选择这份文件继续'}
      </button>
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        hidden
        data-upload-resume-input
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setResumeNote('reading')
          const r = await s.resumeWithFile(file)
          setResumeNote(r === 'ok' ? null : r)
        }}
      />
    </>,
  )
}

function Sep() {
  return <span className="px-1.5 text-ink-3">·</span>
}
