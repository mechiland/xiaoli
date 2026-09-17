'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useImportOverlay } from '@/components/import-overlay'
import { EXAMPLE_ENGLISH_EXPORT_FILE_NAME, EXAMPLE_EXPORT_FILE_NAME } from '@/components/import-overlay/format'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { welcomeHref } from '@/lib/links'

const STEPS: { title: string; body: string }[] = [
  { title: '多选消息', body: '在微信聊天里选中想导入的消息；手机上可长按消息，点「多选」。' },
  { title: '转发', body: '点「转发」。' },
  { title: '其他应用', body: '在转发方式里选「其他应用」。' },
  { title: '选择本应用或保存到文件', body: '手机上直接选小丽；也可以保存到文件，再拖到这里。' },
]

/**
 * Empty home (SPEC §9.12): the search box's place is taken by a large drop zone that explains the WeChat export and
 * offers "选择文件". Drop or pick → `useImportOverlay().open({ file })`. Drags over the zone are handled here (and kept
 * from the window-level "松开以导入" veil), so the zone itself shows the drag-over state.
 */
export function EmptyHome({ needsOnboarding }: { needsOnboarding: boolean }) {
  const overlay = useImportOverlay()
  const zoneRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const openRef = useRef(overlay.open)
  openRef.current = overlay.open

  useEffect(() => {
    const el = zoneRef.current
    if (!el) return
    let depth = 0
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      depth++
      setDragging(true)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.stopPropagation()
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      depth = 0
      setDragging(false)
      const file = e.dataTransfer?.files?.[0]
      if (file) openRef.current({ file })
    }
    el.addEventListener('dragenter', onEnter)
    el.addEventListener('dragover', onOver)
    el.addEventListener('dragleave', onLeave)
    el.addEventListener('drop', onDrop)
    return () => {
      el.removeEventListener('dragenter', onEnter)
      el.removeEventListener('dragover', onOver)
      el.removeEventListener('dragleave', onLeave)
      el.removeEventListener('drop', onDrop)
    }
  }, [])

  return (
    <div className="mx-auto w-full max-w-[880px] px-5 pb-20 sm:px-8">
      <section aria-label="导入第一份聊天记录" className="flex min-h-[calc(100dvh-var(--loam-topbar-height))] flex-col justify-center py-8 sm:py-14">
        <div
          ref={zoneRef}
          data-home-dropzone
          data-dragging={dragging ? 'true' : 'false'}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button, a, input')) return
            inputRef.current?.click()
          }}
          className={cn(
            'cursor-pointer border border-dashed bg-paper px-6 py-9 transition-colors sm:px-14 sm:py-14',
            dragging ? 'border-ink-2 bg-highlight/60' : 'border-line-strong hover:border-ink-3',
          )}
        >
          <p className="font-data text-[12px] tracking-[0.08em] text-ink-3">导入第一份聊天记录</p>
          <h1 className="mt-3 font-serif text-[26px] font-semibold leading-snug tracking-[0.02em] sm:text-[32px]" aria-live="polite">
            {dragging ? (
              '松开以导入'
            ) : (
              <>
                <span className="hidden sm:inline">把微信聊天记录拖到这里</span>
                <span className="sm:hidden">从微信导入聊天记录</span>
              </>
            )}
          </h1>
          <p className="mt-3 text-[15px] leading-7 text-ink-2">
            小丽会把聊天读一遍，整理出关于每个人的信息，每一条都能点回原话，由你确认后记下。
          </p>

          <div className="mt-8 border-t border-line pt-6 sm:mt-10">
            <h2 className="font-data text-[12px] font-normal tracking-[0.08em] text-ink-3">怎样从微信导出</h2>
            <ol className="mt-4 grid gap-x-10 gap-y-4 sm:grid-cols-2">
              {STEPS.map((s, i) => (
                <li key={s.title} className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-baseline">
                  <span className="font-data text-[13px] tabular-nums text-ink-3">{i + 1}</span>
                  <div>
                    <p className="text-[15px] font-medium leading-7 text-ink">{s.title}</p>
                    <p className="text-[13px] leading-6 text-ink-2">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 sm:mt-10">
            <Button type="button" className="h-10 px-6" onClick={() => inputRef.current?.click()}>
              选择文件
            </Button>
            <span className="text-[13px] leading-6 text-ink-3">
              ZIP 文件，文件名形如 <span className="inline-block max-w-full break-words font-data">{EXAMPLE_EXPORT_FILE_NAME}</span> 或 <span className="inline-block max-w-full break-words font-data">{EXAMPLE_ENGLISH_EXPORT_FILE_NAME}</span>
            </span>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            data-home-file-input
            onChange={(e) => {
              const file = e.currentTarget.files?.[0]
              e.currentTarget.value = ''
              if (file) overlay.open({ file })
            }}
          />
        </div>

        {needsOnboarding && (
          <p className="mt-5 text-[13px] leading-6 text-ink-3">
            导入之前，可以先
            <Link href={welcomeHref} className="loam-link mx-0.5 text-ink-2">
              填写你在微信里的显示名
            </Link>
            ，导入时就能自动认出你。
          </p>
        )}
      </section>
    </div>
  )
}
