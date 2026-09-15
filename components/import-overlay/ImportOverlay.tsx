'use client'

import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CreateImportRequest, CreateImportResponse, ExportPreview, MappingResponse, MappingSuggestions, ParsedExport } from '@/contracts'
import { Button } from '@/components/ui/button'
import { ApiClientError } from '@/lib/api-client'
import { cn } from '@/lib/cn'
import { importHref } from '@/lib/links'
import { isParseError, parseExportZip, summarize } from '@/lib/wechat-export'
import { formatRange } from './format'
import { importUrl, requestJson } from './http'
import { AttachmentPicker, defaultSelection, PreviewStats } from './StepPreview'
import { buildMappingRequest, initialDraft, StepMapping, type MappingDraft } from './StepMapping'
import { closeOverlay, isOverlayBusy, openOverlay, setOverlayBusy, useOverlayState, type ImportOverlayOpenOptions } from './store'
import { registerUpload, removeUpload, startUploads } from './upload-store'

type Phase =
  | { step: 'pick'; notice?: string }
  | { step: 'parsing'; fileName: string; progress: number }
  | { step: 'parse_error'; fileName: string }
  | { step: 'duplicate'; fileName: string; importId: number; preview: ExportPreview }
  | { step: 'preview'; file: File; parsed: ParsedExport; preview: ExportPreview; selected: Set<string>; submitting: boolean; error: string | null }
  | {
      step: 'mapping'
      importId: number
      fileName: string
      preview: ExportPreview
      suggestions: MappingSuggestions
      draft: MappingDraft
      submitting: boolean
      error: string | null
    }

const STEPS = ['预览', '这是谁的聊天', '开始'] as const

function stepIndex(p: Phase): number {
  if (p.step === 'mapping') return p.submitting ? 2 : 1
  return 0
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)))

/** Why 开始 is disabled at step 2. */
function startBlocker(draft: MappingDraft, suggestions: MappingSuggestions): string {
  const needTitle = draft.chat.kind === 'new' && !draft.newTitle.trim()
  const needSenders = suggestions.senders.some((s) => !draft.picks[s.senderName])
  if (needTitle && needSenders) return '给新聊天起个名字、选好每个发送者后才能开始'
  if (needTitle) return '给新聊天起个名字'
  return '每个发送者都选好后才能开始'
}

/** Closing at step 2 abandons the created import (ARCHITECTURE §1.4, DECISIONS A7 #2). */
function abandonImport(importId: number) {
  removeUpload(importId)
  void fetch(importUrl(importId), { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(() => undefined)
}

export function ImportOverlayHost(): React.JSX.Element {
  const s = useOverlayState()
  const dragging = useGlobalDrop()
  return (
    <>
      {dragging && <DropVeil />}
      {s.isOpen && <ImportOverlay key={s.nonce} opts={s.opts} />}
    </>
  )
}

function ImportOverlay({ opts }: { opts: ImportOverlayOpenOptions | null }) {
  const router = useRouter()
  const qc = useQueryClient()
  const [phase, setPhase] = useState<Phase>({ step: 'pick' })
  const fileInput = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  const parseToken = useRef(0)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    setOverlayBusy(phase.step === 'mapping' || (phase.step === 'preview' && phase.submitting))
  }, [phase])

  const handleFile = useCallback(async (file: File) => {
    const token = ++parseToken.current
    const current = () => alive.current && token === parseToken.current
    performance.clearMarks('xiaoli:parse:start')
    performance.clearMarks('xiaoli:parse:end')
    performance.mark('xiaoli:parse:start')
    setPhase({ step: 'parsing', fileName: file.name, progress: 0.02 })
    let parsed: ParsedExport
    try {
      const buf = await file.arrayBuffer()
      if (!current()) return
      setPhase({ step: 'parsing', fileName: file.name, progress: 0.15 })
      await nextFrame()
      parsed = await parseExportZip(buf, {
        fileName: file.name,
        onProgress: (p) => current() && setPhase({ step: 'parsing', fileName: file.name, progress: 0.15 + p * 0.8 }),
      })
    } catch (err) {
      if (!current()) return
      if (!isParseError(err)) console.warn('[import] parse failed', (err as Error)?.name)
      setPhase({ step: 'parse_error', fileName: file.name })
      return
    }
    if (!current()) return
    const preview = summarize(parsed)
    try {
      const check = await requestJson<{ duplicate: boolean; importId?: number }>('POST', '/api/imports/check', { sha256: parsed.sha256 })
      if (!current()) return
      if (check.duplicate && check.importId) {
        setPhase({ step: 'duplicate', fileName: file.name, importId: check.importId, preview })
        return
      }
    } catch {
      // POST /api/imports enforces uniqueness again; a failed check does not block the preview
    }
    setPhase({ step: 'preview', file, parsed, preview, selected: defaultSelection(parsed.media), submitting: false, error: null })
  }, [])

  // file passed to open() (drop, home dropzone)
  useEffect(() => {
    if (opts?.file) void handleFile(opts.file)
  }, [opts, handleFile])

  // P1: preview (or duplicate notice) rendered → end mark
  useEffect(() => {
    if (phase.step === 'preview' || phase.step === 'duplicate') {
      if (performance.getEntriesByName('xiaoli:parse:end').length === 0 && performance.getEntriesByName('xiaoli:parse:start').length > 0) {
        requestAnimationFrame(() => performance.mark('xiaoli:parse:end'))
      }
    }
  }, [phase.step])

  const requestClose = () => {
    if (phase.step === 'preview' && phase.submitting) return
    if (phase.step === 'mapping') {
      if (phase.submitting) return
      abandonImport(phase.importId)
    }
    parseToken.current++
    closeOverlay()
  }

  const submitPreview = async () => {
    if (phase.step !== 'preview' || phase.submitting) return
    const { parsed, file, selected } = phase
    setPhase({ ...phase, submitting: true, error: null })
    const body: CreateImportRequest = {
      fileName: parsed.fileName || file.name,
      sha256: parsed.sha256,
      exportedAt: parsed.exportedAt,
      parserVersion: parsed.parserVersion,
      messages: parsed.messages,
      media: parsed.media,
      selectedAttachments: [...selected],
    }
    try {
      const res = await requestJson<CreateImportResponse>('POST', '/api/imports', body)
      if (!alive.current) {
        abandonImport(res.import.id)
        return
      }
      registerUpload(res.import.id, file, parsed.sha256, [...selected])
      setPhase({
        step: 'mapping',
        importId: res.import.id,
        fileName: file.name,
        preview: phase.preview,
        suggestions: res.suggestions,
        draft: initialDraft(res.suggestions, opts?.chatId ?? null),
        submitting: false,
        error: null,
      })
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ApiClientError && err.code === 'duplicate_import') {
        const importId = Number((err.details as { importId?: number })?.importId)
        setPhase({ step: 'duplicate', fileName: file.name, importId, preview: phase.preview })
        return
      }
      setPhase({ ...phase, submitting: false, error: err instanceof ApiClientError && err.status < 500 ? err.message : '没有保存成功' })
    }
  }

  const submitMapping = async () => {
    if (phase.step !== 'mapping' || phase.submitting) return
    const req = buildMappingRequest(phase.draft, phase.suggestions)
    if (!req) return
    const { importId } = phase
    setPhase({ ...phase, submitting: true, error: null })
    try {
      await requestJson<MappingResponse>('POST', `${importUrl(importId)}/mapping`, req)
      void startUploads(importId)
      void qc.invalidateQueries()
      setOverlayBusy(false)
      closeOverlay()
      router.push(importHref(importId))
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ApiClientError && err.status === 404) {
        removeUpload(importId)
        setPhase({ step: 'pick', notice: '这份文件在别处重新开始导入了' })
        return
      }
      if (err instanceof ApiClientError && err.status === 409 && err.message === '请重新选择这份文件') {
        removeUpload(importId)
        void fetch(importUrl(importId), { method: 'DELETE', credentials: 'same-origin' }).catch(() => undefined)
        setPhase({ step: 'pick', notice: '请重新选择这份文件' })
        return
      }
      setPhase({ ...phase, submitting: false, error: err instanceof ApiClientError && err.status < 500 ? err.message : '没有开始成功' })
    }
  }

  const pickAnother = () => {
    parseToken.current++
    setPhase({ step: 'pick' })
    requestAnimationFrame(() => fileInput.current?.click())
  }

  const current = stepIndex(phase)
  const canStart = phase.step === 'mapping' && buildMappingRequest(phase.draft, phase.suggestions) !== null

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && requestClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--loam-scrim)] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          data-import-overlay
          data-step={phase.step}
          ref={contentRef}
          onOpenAutoFocus={(e) => {
            // focus the dialog itself, not ×: an autofocused close button shows a focus ring after a drop
            e.preventDefault()
            contentRef.current?.focus({ preventScroll: true })
          }}
          onInteractOutside={(e) => {
            // a PersonPicker popover lives in its own portal; clicks inside it are not "outside"
            if ((e.target as HTMLElement | null)?.closest?.('[data-radix-popper-content-wrapper]')) e.preventDefault()
          }}
          className={cn(
            'fixed z-50 flex flex-col bg-paper text-ink outline-none',
            'inset-0 sm:inset-auto sm:left-1/2 sm:top-[6vh] sm:max-h-[88vh] sm:w-[640px] sm:-translate-x-1/2 sm:border sm:border-line',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          )}
        >
          <header className="shrink-0 border-b border-line px-5 pb-3.5 pt-[max(16px,env(safe-area-inset-top))] sm:px-7 sm:pt-5">
            <div className="flex items-start justify-between gap-4">
              <DialogPrimitive.Title className="font-serif text-[20px] font-semibold leading-8 tracking-[0.02em]">导入聊天记录</DialogPrimitive.Title>
              <DialogPrimitive.Close
                aria-label="关闭"
                disabled={(phase.step === 'mapping' || phase.step === 'preview') && phase.submitting}
                className="-mr-2 grid size-8 place-items-center text-ink-3 hover:text-ink disabled:opacity-40"
              >
                <X className="size-4" strokeWidth={1.5} />
              </DialogPrimitive.Close>
            </div>
            <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]" aria-label="步骤">
              {STEPS.map((label, i) => (
                <li key={label} className="flex items-center gap-2" aria-current={i === current ? 'step' : undefined}>
                  {i > 0 && <span aria-hidden className="h-px w-5 bg-line-strong sm:w-8" />}
                  <span className={cn('font-data tabular-nums', i === current ? 'text-ink' : i < current ? 'text-ink-2' : 'text-ink-3')}>{i + 1}</span>
                  <span className={cn(i === current ? 'border-b border-ink text-ink' : i < current ? 'text-ink-2' : 'text-ink-3')}>{label}</span>
                </li>
              ))}
            </ol>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
            <input
              ref={fileInput}
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              hidden
              data-import-file
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void handleFile(f)
              }}
            />
            {phase.step === 'pick' && <PickBody notice={phase.notice} onPick={() => fileInput.current?.click()} />}
            {phase.step === 'parsing' && <ParsingBody fileName={phase.fileName} progress={phase.progress} />}
            {phase.step === 'parse_error' && <ParseErrorBody fileName={phase.fileName} />}
            {phase.step === 'duplicate' && (
              <div className="space-y-6">
                <Notice title="这份文件已经导入过">
                  <p>
                    <FileName name={phase.fileName} /> · {formatRange(phase.preview.dateFrom, phase.preview.dateTo)} ·{' '}
                    <span className="font-data tabular-nums">{phase.preview.messageCount}</span> 条消息
                  </p>
                  <p className="mt-2">
                    <Link href={importHref(phase.importId)} onClick={() => closeOverlay()} className="loam-link">
                      查看当时的导入结果
                    </Link>
                  </p>
                </Notice>
              </div>
            )}
            {phase.step === 'preview' && (
              <div className="space-y-8">
                <p className="flex flex-wrap items-baseline gap-x-3 text-[13px] text-ink-3">
                  <FileName name={phase.file.name} />
                </p>
                <PreviewStats preview={phase.preview} />
                <section aria-labelledby="att-title">
                  <h3 id="att-title" className="mb-1 font-serif text-[16px] font-semibold">
                    附件
                  </h3>
                  <p className="mb-3 text-[13px] leading-6 text-ink-3">聊天内容在浏览器里解析；只有勾选的附件会上传。</p>
                  <AttachmentPicker
                    media={phase.parsed.media}
                    selected={phase.selected}
                    onChange={(selected) => setPhase({ ...phase, selected })}
                  />
                </section>
              </div>
            )}
            {phase.step === 'mapping' && (
              <StepMapping
                suggestions={phase.suggestions}
                draft={phase.draft}
                disabled={phase.submitting}
                onChange={(draft) => setPhase({ ...phase, draft })}
              />
            )}
          </div>

          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-line px-5 py-3.5 pb-[max(14px,env(safe-area-inset-bottom))] sm:px-7">
            {(phase.step === 'preview' || phase.step === 'mapping') && phase.error && (
              <p role="alert" className="mr-auto border-l border-line-strong pl-3 text-[13px] leading-6 text-ink-2">
                {phase.error}
              </p>
            )}
            {phase.step === 'preview' && (
              <>
                <button type="button" onClick={pickAnother} className="loam-text-button mr-auto text-[13px]" disabled={phase.submitting}>
                  重新选择文件
                </button>
                <Button onClick={submitPreview} disabled={phase.submitting} className="min-w-24">
                  {phase.submitting ? '正在保存…' : '下一步'}
                </Button>
              </>
            )}
            {(phase.step === 'parse_error' || phase.step === 'duplicate') && (
              <Button variant="outline" onClick={pickAnother}>
                重新选择文件
              </Button>
            )}
            {phase.step === 'mapping' && (
              <>
                {!canStart && !phase.error && (
                  <p className="mr-auto text-[13px] text-ink-3" data-start-hint>
                    {startBlocker(phase.draft, phase.suggestions)}
                  </p>
                )}
                <Button onClick={submitMapping} disabled={!canStart || phase.submitting} className="min-w-24">
                  {phase.submitting ? '正在开始…' : '开始'}
                </Button>
              </>
            )}
            {(phase.step === 'pick' || phase.step === 'parsing') && (
              <Button variant="outline" onClick={requestClose}>
                取消
              </Button>
            )}
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function FileName({ name }: { name: string }) {
  return <span className="break-all font-data text-[13px] text-ink-2">{name}</span>
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="status" className="border-l border-line-strong pl-4">
      <p className="font-serif text-[17px] font-semibold leading-7">{title}</p>
      <div className="mt-1 text-[14px] leading-7 text-ink-2">{children}</div>
    </div>
  )
}

function PickBody({ notice, onPick }: { notice?: string; onPick: () => void }) {
  return (
    <div className="space-y-5">
      {notice && <Notice title={notice}>可以重新选择这份文件继续导入。</Notice>}
      <div className="grid place-items-center gap-4 border border-dashed border-line-strong bg-ground/60 px-6 py-12 text-center">
        <p className="font-serif text-[18px] leading-8">把聊天记录 ZIP 拖到这里</p>
        <Button variant="outline" onClick={onPick}>
          选择文件
        </Button>
      </div>
      <p className="text-[13px] leading-6 text-ink-3">
        在微信聊天中多选消息 → 转发 → 其他应用，保存得到 <span className="font-data">聊天记录_日期_时间.zip</span>。文件在浏览器里解析，只上传解析出的消息和你勾选的图片。
      </p>
    </div>
  )
}

function ParsingBody({ fileName, progress }: { fileName: string; progress: number }) {
  return (
    <div className="space-y-4 py-6" aria-busy="true">
      <p className="text-[15px]">正在解析聊天记录…</p>
      <div className="h-[2px] w-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <div className="h-full bg-ink transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <p className="text-[13px] text-ink-3">
        <FileName name={fileName} />
      </p>
    </div>
  )
}

function ParseErrorBody({ fileName }: { fileName: string }) {
  return (
    <Notice title="无法识别这个文件">
      <p>
        <FileName name={fileName} />
      </p>
      <p className="mt-2">支持微信「转发到其他应用」导出的 ZIP 文件，文件名形如 <span className="whitespace-nowrap font-data">聊天记录_20260915_142841.zip</span>。</p>
    </Notice>
  )
}

function DropVeil() {
  return (
    <div data-drop-veil className="pointer-events-none fixed inset-0 z-[60] grid place-items-center bg-[var(--loam-scrim)] p-6">
      <div className="grid place-items-center gap-2 border border-dashed border-ink-3 bg-paper/80 px-12 py-10 text-center">
        <p className="font-serif text-[24px] font-semibold leading-9 tracking-[0.04em]">松开以导入</p>
        <p className="text-[13px] text-ink-3">微信导出的聊天记录 ZIP</p>
      </div>
    </div>
  )
}

/** Window-level drag-and-drop: "松开以导入" veil while files are dragged over any page; drop opens the overlay. */
function useGlobalDrop(): boolean {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      if (!isOverlayBusy()) setDragging(true)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = isOverlayBusy() ? 'none' : 'copy'
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const file = e.dataTransfer?.files?.[0]
      if (file && !isOverlayBusy()) openOverlay({ file })
    }
    const onEnd = () => {
      depth = 0
      setDragging(false)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', onEnd)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', onEnd)
    }
  }, [])
  return dragging
}
