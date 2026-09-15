import type { MessageKind } from '@/contracts'
import { formatMsgTime } from '@/lib/time'

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export const KIND_LABEL: Record<MessageKind, string> = {
  text: '文字',
  sticker_code: '表情',
  image: '图片',
  video: '视频',
  voice: '语音',
  transfer: '转账',
  red_packet: '红包',
  mini_program: '小程序',
  channels: '视频号',
  animated_sticker: '动画表情',
  video_call: '通话',
  quote: '引用',
  recall: '撤回',
  system: '系统消息',
  file: '文件',
  link: '链接',
  location: '位置',
  contact_card: '名片',
  forward: '聊天记录',
  unknown: '其他',
}

/** '2025年10月25日 — 2026年4月5日' (one date when both are the same day). */
export function formatRange(from: string | null, to: string | null): string {
  if (!from || !to) return '—'
  const a = formatMsgTime(from, 'date')
  const b = formatMsgTime(to, 'date')
  return a === b ? a : `${a} — ${b}`
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i

/** "图片" when every name is an image (or no names are known — images are what gets selected by default), else "附件". */
export function attachmentNoun(names: string[]): { noun: string; unit: string } {
  return names.every((n) => IMAGE_EXT.test(n)) ? { noun: '图片', unit: '张' } : { noun: '附件', unit: '个' }
}
