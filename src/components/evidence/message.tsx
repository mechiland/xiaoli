'use client'

import type { EvidenceMessageDTO } from '@/contracts'

/** Gray label for content the export does not contain (SPEC §9.6: shown, never hidden). */
export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="mx-[1px] inline-block rounded-[2px] border border-line bg-paper-hover px-1.5 align-[1px] text-[12px] leading-[18px] whitespace-nowrap text-ink-3">
      {children}
    </span>
  )
}

const TAG = /^\[[^\]\n]{1,12}\]\s?/

/** Body text after a leading `[标签]`, trimmed. */
function rest(body: string): string {
  return body.replace(TAG, '').trim()
}

function voiceSeconds(m: EvidenceMessageDTO): number | null {
  if (typeof m.meta?.durationSec === 'number') return Math.round(m.meta.durationSec)
  const x = /(\d+)\s*["”″]/.exec(m.body)
  return x ? Number(x[1]) : null
}

const CHIP_LABEL: Partial<Record<EvidenceMessageDTO['kind'], string>> = {
  image: '图片',
  video: '视频',
  animated_sticker: '动画表情',
  mini_program: '小程序',
  channels: '视频号',
  file: '文件',
  link: '链接',
  location: '位置',
  contact_card: '名片',
  forward: '聊天记录',
}

function Text({ children }: { children: React.ReactNode }) {
  return <span className="whitespace-pre-wrap">{children}</span>
}

export function MessageBody({ m }: { m: EvidenceMessageDTO }) {
  switch (m.kind) {
    case 'voice': {
      const s = voiceSeconds(m)
      return <Chip>{s != null ? `语音 ${s} 秒` : '语音'}</Chip>
    }
    case 'transfer': {
      const state = m.meta?.transferState ?? rest(m.body)
      return (
        <>
          <Chip>转账</Chip>
          {state && <span className="ml-1.5 text-ink-3">{state}</span>}
        </>
      )
    }
    case 'red_packet': {
      const greeting = m.meta?.greeting ?? rest(m.body)
      return (
        <>
          <Chip>红包</Chip>
          {greeting && <span className="ml-1.5">{greeting}</span>}
        </>
      )
    }
    case 'video_call': {
      const label = m.meta?.label ?? rest(m.body)
      const voiceCall = label.startsWith('语音通话')
      const detail = voiceCall ? label.slice(4).trim() : label
      return (
        <>
          <Chip>{voiceCall ? '语音通话' : '视频通话'}</Chip>
          {detail && <span className="ml-1.5 text-ink-3">{detail}</span>}
        </>
      )
    }
    case 'recall':
    case 'system':
      return <span className="text-ink-3">{m.body}</span>
    default: {
      const chip = CHIP_LABEL[m.kind]
      if (!chip) return <Text>{m.body}</Text>
      const text = m.kind === 'animated_sticker' ? (m.meta?.label ?? rest(m.body)) : (m.meta?.title ?? rest(m.body))
      return (
        <>
          <Chip>{chip}</Chip>
          {text && m.kind !== 'image' && m.kind !== 'video' && <span className="ml-1.5 whitespace-pre-wrap">{text}</span>}
        </>
      )
    }
  }
}
