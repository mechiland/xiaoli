'use client'

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { ExportPreview, MediaFileInfo, MessageKind } from '@/contracts'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/cn'
import { formatBytes, formatRange, KIND_LABEL } from './format'

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024

export function tooLarge(m: MediaFileInfo): boolean {
  return m.byteSize > (m.kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)
}

/** Images checked, videos and files unchecked (SPEC §8.1). Only media a message refers to can be attached. */
export function defaultSelection(media: MediaFileInfo[]): Set<string> {
  return new Set(media.filter((m) => m.referenced && m.kind === 'image' && !tooLarge(m)).map((m) => m.name))
}

export function PreviewStats({ preview, className }: { preview: ExportPreview; className?: string }) {
  const kinds = (Object.entries(preview.byKind) as [MessageKind, number][]).sort((a, b) => b[1] - a[1])
  return (
    <dl className={cn('grid grid-cols-[72px_1fr] gap-x-5 gap-y-2.5 text-[14px] leading-6 sm:grid-cols-[88px_1fr]', className)}>
      <Term>消息</Term>
      <dd>
        <span className="font-data tabular-nums">{preview.messageCount.toLocaleString('zh-CN')}</span> 条
      </dd>
      <Term>时间</Term>
      <dd className="font-data tabular-nums">{formatRange(preview.dateFrom, preview.dateTo)}</dd>
      <Term>发送者</Term>
      <dd>
        <ul className="flex flex-wrap gap-x-4 gap-y-0.5">
          {preview.senders.map((s) => (
            <li key={s.name} className="min-w-0">
              <span className="break-all">{s.name}</span> <span className="font-data text-[13px] tabular-nums text-ink-3">{s.count}</span>
            </li>
          ))}
        </ul>
      </dd>
      <Term>类型</Term>
      <dd>
        <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-ink-2">
          {kinds.map(([k, n]) => (
            <li key={k}>
              {KIND_LABEL[k]} <span className="font-data text-[13px] tabular-nums text-ink-3">{n}</span>
            </li>
          ))}
        </ul>
      </dd>
      <Term>图片</Term>
      <dd className="text-ink-2">
        <span className="font-data tabular-nums">{preview.images.count}</span> 张
        <span className="px-1.5 text-ink-3">·</span>
        <span className="font-data tabular-nums">{formatBytes(preview.images.bytes)}</span>
      </dd>
      <Term>视频</Term>
      <dd className="text-ink-2">
        <span className="font-data tabular-nums">{preview.videos.count}</span> 个
        <span className="px-1.5 text-ink-3">·</span>
        <span className="font-data tabular-nums">{formatBytes(preview.videos.bytes)}</span>
      </dd>
    </dl>
  )
}

function Term({ children }: { children: React.ReactNode }) {
  return <dt className="pt-px font-data text-[12px] leading-6 tracking-wide text-ink-3">{children}</dt>
}

const GROUPS: { kind: MediaFileInfo['kind']; label: string; unit: string; hint: string }[] = [
  { kind: 'image', label: '图片', unit: '张', hint: '默认上传，聊天原文页会显示缩略图' },
  { kind: 'video', label: '视频', unit: '个', hint: '默认不上传' },
  { kind: 'file', label: '文件', unit: '个', hint: '默认不上传' },
]

export function AttachmentPicker({
  media,
  selected,
  onChange,
}: {
  media: MediaFileInfo[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const [expanded, setExpanded] = useState<MediaFileInfo['kind'] | null>(null)
  const usable = media.filter((m) => m.referenced)
  const groups = GROUPS.map((g) => ({ ...g, items: usable.filter((m) => m.kind === g.kind) })).filter((g) => g.items.length > 0)
  if (groups.length === 0) return <p className="text-[14px] text-ink-3">这份聊天记录里没有附件。</p>

  const set = (names: string[], on: boolean) => {
    const next = new Set(selected)
    for (const n of names) {
      if (on) next.add(n)
      else next.delete(n)
    }
    onChange(next)
  }

  return (
    <ul className="divide-y divide-line border-y border-line">
      {groups.map((g) => {
        const eligible = g.items.filter((m) => !tooLarge(m))
        const chosen = eligible.filter((m) => selected.has(m.name))
        const state = chosen.length === 0 ? false : chosen.length === eligible.length ? true : 'indeterminate'
        const bytes = chosen.reduce((s, m) => s + m.byteSize, 0)
        const totalBytes = g.items.reduce((s, m) => s + m.byteSize, 0)
        const partial = chosen.length > 0 && chosen.length < g.items.length
        const open = expanded === g.kind
        return (
          <li key={g.kind} className="py-2.5">
            <div className="flex items-center gap-3">
              <Checkbox
                id={`att-${g.kind}`}
                checked={state}
                disabled={eligible.length === 0}
                onCheckedChange={(v) => set(eligible.map((m) => m.name), v === true)}
                aria-label={`上传全部${g.label}`}
              />
              <label htmlFor={`att-${g.kind}`} className="min-w-0 flex-1 cursor-pointer text-[14px] leading-6">
                {g.label}
                <span className="ml-2 font-data text-[13px] tabular-nums text-ink-2">
                  {chosen.length} / {g.items.length} {g.unit}
                </span>
                <span className="ml-2 font-data text-[13px] tabular-nums text-ink-3" data-attachment-bytes>
                  {partial ? `${formatBytes(bytes)} / ${formatBytes(totalBytes)}` : `共 ${formatBytes(totalBytes)}`}
                </span>
                <span className="ml-3 hidden text-[12px] text-ink-3 sm:inline">{g.hint}</span>
              </label>
              <button
                type="button"
                onClick={() => setExpanded(open ? null : g.kind)}
                aria-expanded={open}
                className="flex shrink-0 items-center gap-1 text-[13px] text-ink-3 hover:text-ink"
              >
                逐项调整
                <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
            {open && (
              <ul className="mt-2 max-h-52 overflow-y-auto border-l border-line pl-4">
                {g.items.map((m) => {
                  const big = tooLarge(m)
                  const id = `att-item-${g.kind}-${m.name}`
                  return (
                    <li key={m.path} className="flex items-center gap-3 py-1">
                      <Checkbox id={id} checked={selected.has(m.name)} disabled={big} onCheckedChange={(v) => set([m.name], v === true)} />
                      <label htmlFor={id} className={cn('min-w-0 flex-1 truncate font-data text-[13px]', big ? 'text-ink-3' : 'text-ink-2')}>
                        {m.name}
                      </label>
                      <span className="shrink-0 font-data text-[12px] tabular-nums text-ink-3">{big ? '太大，不能上传' : formatBytes(m.byteSize)}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
