'use client'
// An uploaded image the browser cannot decode (a HEIC photo named .jpg, a damaged file): a quiet gray box in the place
// of the image, the format when known, and "下载原图". Thumbnail and viewer share it. DECISIONS chat C14. Owner: chat.
import { useEffect, useState } from 'react'
import type { AttachmentDTO } from '@/contracts'
import { downloadHref, undecodableFormatLabel } from './thumb'

/**
 * The stored mime comes from the file name, so it usually says image/jpeg; the stream's content-type is sniffed from
 * the bytes (server/chat/sniff.ts). Only when the stored type names no format is the stream asked for its headers —
 * it is `immutable` in the HTTP cache, and the body is aborted as soon as the headers arrive.
 */
function useFormatLabel(att: AttachmentDTO): string | null {
  const known = undecodableFormatLabel(att.mime, att.fileName)
  const [served, setServed] = useState<string | null>(null)
  useEffect(() => {
    if (known || !att.url) return
    const ctl = new AbortController()
    fetch(att.url, { signal: ctl.signal, credentials: 'same-origin' })
      .then((r) => {
        if (r.ok) setServed(undecodableFormatLabel(r.headers.get('content-type')))
        ctl.abort()
      })
      .catch(() => undefined)
    return () => ctl.abort()
  }, [att.url, known])
  return known ?? served
}

export function ImageUnavailable({ att, variant }: { att: AttachmentDTO; variant: 'thumb' | 'viewer' }) {
  const label = useFormatLabel(att)
  const text = `这张图片无法预览${label ? `（${label}）` : ''}`
  const link = att.url ? (
    <a href={downloadHref(att.url)} download="" data-chat-image-download className="loam-link text-ink-2">
      下载原图
    </a>
  ) : null
  if (variant === 'thumb') {
    return (
      <span
        data-chat-image-unavailable={att.id}
        data-format={label ?? undefined}
        title={att.fileName ?? undefined}
        className="flex h-[135px] w-[180px] max-w-full flex-col items-center justify-center gap-1.5 rounded-[2px] border border-line bg-paper-hover px-2 text-center text-[12px] leading-5 text-ink-3"
      >
        <span>{text}</span>
        {link}
      </span>
    )
  }
  return (
    <div
      data-chat-image-unavailable={att.id}
      data-format={label ?? undefined}
      className="mx-4 flex h-[min(320px,60dvh)] flex-col items-center justify-center gap-2 rounded-[2px] border border-line bg-paper-hover px-4 text-center text-[13px] leading-6 text-ink-2 sm:mx-auto sm:h-[320px] sm:w-[min(560px,calc(92vw-2rem))]"
    >
      <span>{text}</span>
      <span className="text-[12px] leading-5 text-ink-3">浏览器显示不了这张图片，可以下载原图，用手机或电脑的相册打开</span>
      {link && <span className="text-[13px]">{link}</span>}
    </div>
  )
}
