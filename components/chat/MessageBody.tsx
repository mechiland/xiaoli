'use client'
// Message content for the transcript: text, the same gray chips as the evidence block (SPEC §9.6), image thumbnails and
// the "图片未导入" placeholder (SPEC §9.10). Owner: chat.
import type { ReactNode } from 'react'
import type { AttachmentDTO, MessageDTO } from '@/contracts'

/** Same look as review's evidence chip (components/evidence/message.tsx), which its public entry does not export. */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="mx-[1px] inline-block rounded-[2px] border border-line bg-paper-hover px-1.5 align-[1px] text-[12px] leading-[18px] whitespace-nowrap text-ink-3">
      {children}
    </span>
  )
}

const TAG = /^\[[^\]\n]{1,12}\]\s?/
const rest = (body: string) => body.replace(TAG, '').trim()

function voiceSeconds(m: MessageDTO): number | null {
  if (typeof m.meta?.durationSec === 'number') return Math.round(m.meta.durationSec)
  const x = /(\d+)\s*["”″]/.exec(m.body)
  return x ? Number(x[1]) : null
}

const CHIP_LABEL: Partial<Record<MessageDTO['kind'], string>> = {
  animated_sticker: '动画表情',
  mini_program: '小程序',
  channels: '视频号',
  file: '文件',
  link: '链接',
  location: '位置',
  contact_card: '名片',
  forward: '聊天记录',
}

const safeUrl = (u: string | undefined) => (u && /^https?:\/\//i.test(u) ? u : null)

export interface BodyParts {
  /** runs on the sender's line */
  inline: ReactNode | null
  /** own line(s) below: thumbnails, quoted excerpt */
  block: ReactNode | null
}

export function ImageThumb({ att, onOpen }: { att: AttachmentDTO; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-chat-image={att.id}
      aria-label={att.fileName ? `放大图片 ${att.fileName}` : '放大图片'}
      className="group block h-[135px] w-[180px] max-w-full overflow-hidden rounded-[2px] border border-line bg-paper-hover"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- owner-checked stream, no Next image loader */}
      <img src={att.url!} alt={att.fileName ?? '图片'} loading="lazy" decoding="async" className="block h-full w-full object-cover transition-opacity group-hover:opacity-90" />
    </button>
  )
}

export function ImagePlaceholder({ fileName }: { fileName?: string | null }) {
  return (
    <span
      data-chat-image-missing
      title={fileName ?? undefined}
      className="flex h-[72px] w-[120px] items-center justify-center rounded-[2px] border border-line bg-paper-hover text-[12px] leading-5 text-ink-3"
    >
      图片未导入
    </span>
  )
}

export interface PartsOptions {
  /** person label for the quoted line's raw display name, when a loaded message shows that name is linked */
  quotedLabel?: string | null
}

export function messageParts(m: MessageDTO, onOpenImage: (att: AttachmentDTO) => void, opts: PartsOptions = {}): BodyParts {
  switch (m.kind) {
    case 'voice': {
      const sec = voiceSeconds(m)
      return { inline: <Chip>{sec != null ? `语音 ${sec} 秒` : '语音'}</Chip>, block: null }
    }
    case 'transfer': {
      const state = m.meta?.transferState ?? rest(m.body)
      return {
        inline: (
          <>
            <Chip>转账</Chip>
            {state && <span className="ml-1.5 text-ink-3">{state}</span>}
          </>
        ),
        block: null,
      }
    }
    case 'red_packet': {
      const greeting = m.meta?.greeting ?? rest(m.body)
      return {
        inline: (
          <>
            <Chip>红包</Chip>
            {greeting && <span className="ml-1.5">{greeting}</span>}
          </>
        ),
        block: null,
      }
    }
    case 'video_call': {
      const label = m.meta?.label ?? rest(m.body)
      const voiceCall = label.startsWith('语音通话')
      const detail = voiceCall ? label.slice(4).trim() : label
      return {
        inline: (
          <>
            <Chip>{voiceCall ? '语音通话' : '视频通话'}</Chip>
            {detail && <span className="ml-1.5 text-ink-3">{detail}</span>}
          </>
        ),
        block: null,
      }
    }
    case 'recall':
    case 'system':
      return { inline: <span className="text-ink-3">{m.body}</span>, block: null }
    case 'image': {
      const images = m.attachments.filter((a) => a.kind === 'image')
      const fileName = m.meta?.fileName ?? (rest(m.body) || null)
      const block =
        images.length === 0 ? (
          <ImagePlaceholder fileName={fileName} />
        ) : (
          <span className="flex flex-wrap gap-2">
            {images.map((a) => (a.uploaded && a.url ? <ImageThumb key={a.id} att={a} onOpen={() => onOpenImage(a)} /> : <ImagePlaceholder key={a.id} fileName={a.fileName} />))}
          </span>
        )
      return { inline: null, block }
    }
    case 'video': {
      const video = m.attachments.find((a) => a.kind === 'video' && a.uploaded && a.url)
      if (video) {
        return {
          inline: null,
          block: <video controls preload="metadata" src={video.url!} className="block max-h-[240px] max-w-[min(320px,100%)] rounded-[2px] border border-line bg-paper-hover" />,
        }
      }
      return {
        inline: (
          <>
            <Chip>视频</Chip>
            <span className="ml-1.5 text-ink-3">未导入</span>
          </>
        ),
        block: null,
      }
    }
    case 'quote': {
      const q = m.meta?.quoted
      const parts = m.body.split(/\n-(?:\s-){4,}\s?\n?/)
      const reply = q && parts.length > 1 ? parts.slice(1).join('\n').trim() : m.body
      return {
        inline: <span className="whitespace-pre-wrap">{reply}</span>,
        block: q ? (
          <span className="block border-l border-line-strong pl-2.5 text-[13px] leading-6 whitespace-pre-wrap text-ink-3">
            {opts.quotedLabel ?? q.senderName}：{q.body}
          </span>
        ) : null,
      }
    }
    default: {
      const chip = CHIP_LABEL[m.kind]
      if (!chip) return { inline: <span className="whitespace-pre-wrap">{m.body}</span>, block: null }
      const text = m.kind === 'animated_sticker' ? (m.meta?.label ?? rest(m.body)) : m.kind === 'file' ? (m.meta?.fileName ?? rest(m.body)) : (m.meta?.title ?? rest(m.body))
      const url = m.kind === 'link' || m.kind === 'channels' ? safeUrl(m.meta?.url) : null
      return {
        inline: (
          <>
            <Chip>{chip}</Chip>
            {text &&
              (url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="loam-link ml-1.5">
                  {text}
                </a>
              ) : (
                <span className="ml-1.5 whitespace-pre-wrap">{text}</span>
              ))}
          </>
        ),
        block: null,
      }
    }
  }
}
