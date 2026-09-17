// Synthetic export builders for tests, benches and the browser perf script. Invented names only — never real data.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { buildParsedExport } from './text'
import { decodeEntryName } from './zip'

export interface SynthMessage {
  sender: string
  /** 'YYYY-MM-DD HH:MM' */
  at: string
  body: string
}

export function wechatTime(at: string): string {
  const [d, t] = at.split(' ')
  const [y, m, day] = d.split('-')
  return `${y}年${m}月${day}日 ${t}`
}

export function buildExportText(msgs: SynthMessage[], opts: { crlf?: boolean; bom?: boolean; trailingNewline?: boolean } = {}): string {
  const blocks = msgs.map((m) => `·${m.sender}\n${wechatTime(m.at)}\n${m.body}\n`)
  let s = blocks.join('\n')
  if (opts.trailingNewline === false) s = s.replace(/\n+$/, '')
  if (opts.crlf) s = s.replace(/\n/g, '\r\n')
  if (opts.bom) s = '﻿' + s
  return s
}

export const MEDIA_DIR = '聊天记录内的图片、视频和文件'

/** Mac's English export layout, using only invented conversation content. */
export function macExportSample(mediaStamp = '202601051030', firstIndex = 1) {
  const imageName = `Weixin Image_${mediaStamp}_${firstIndex}.jpg`
  const secondImageName = `Weixin Image_${mediaStamp}_${firstIndex + 1}.jpg`
  const videoName = `Weixin Video_${mediaStamp}_${firstIndex}.mp4`
  const text = [
    '·测试甲\n2026-1-5 08:03\nHello，测试消息😀\n\n·清单项目\n  保留缩进',
    '·示例乙\n2026-1-5 08:04\n[Mini Program] 示例报名',
    '·示例乙\n2026-1-5 08:04\n[Link] 示例文章 https://example.com/read?a=1&b=2#section',
    `·示例乙\n2026-1-5 08:05\n[Photo] ${imageName}`,
    `·示例乙\n2026-1-5 08:05\n[Photo] ${secondImageName}`,
    `·示例乙\n2026-1-5 08:06\n[Video] ${videoName}`,
    '·测试甲\n2026-1-5 08:07\n收到[玫瑰]',
  ].join('\n\n') + '\n'
  const fileName = 'Chat History_20260105_120000.zip'
  const root = fileName.slice(0, -4)
  const mediaDir = `${root}/Images, videos, and files in chat history`
  const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
  const videoBytes = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 109, 112, 52, 50])
  const zip = zipSync({
    [`${root}/Chat History.txt`]: strToU8(text),
    [`${mediaDir}/${imageName}`]: imageBytes,
    [`${mediaDir}/${secondImageName}`]: imageBytes,
    [`${mediaDir}/${videoName}`]: videoBytes,
    [`${mediaDir}/notes.txt`]: strToU8('An unrelated text attachment.\n'.repeat(100)),
    [`__MACOSX/${root}/._Chat History.txt`]: new Uint8Array([1, 2, 3]),
    [`${root}/.DS_Store`]: new Uint8Array([1, 2, 3]),
  })
  return { fileName, text, zip, imageName, secondImageName, videoName, mediaDir, imageBytes, videoBytes }
}

export function buildExportZip(opts: {
  text: string | Uint8Array
  media?: { name: string; bytes: Uint8Array }[]
  txtName?: string
  /** WeChat iOS writes UTF-8 names without the UTF-8 flag; default true mimics that. */
  clearUtf8Flag?: boolean
  level?: 0 | 6
}): Uint8Array {
  const files: Zippable = {}
  files[opts.txtName ?? '聊天记录.txt'] = typeof opts.text === 'string' ? strToU8(opts.text) : opts.text
  for (const m of opts.media ?? []) files[`${MEDIA_DIR}/${m.name}`] = [m.bytes, { level: 0 }]
  const zip = zipSync(files, { level: opts.level ?? 6 })
  if (opts.clearUtf8Flag !== false) clearUtf8Flags(zip)
  return zip
}

/**
 * Simulates a LATER WeChat export of the same chat: keeps messages [from, to), and renames every generated media file
 * `微信(图片|视频)_<minute>_<n>.<ext>` to the new export minute with `n` counting from 1 through this export (as WeChat
 * does), in both the ZIP entries and the message bodies. Only media referenced by kept messages are included.
 */
export function reexportZip(zip: Uint8Array, opts: { exportMinute: string; from?: number; to?: number }): Uint8Array {
  const entries = unzipSync(zip)
  const byName = new Map<string, Uint8Array>()
  let txt = ''
  for (const [raw, bytes] of Object.entries(entries)) {
    const name = decodeEntryName(raw)
    if (name.endsWith('.txt')) txt = strFromU8(bytes)
    else if (!name.endsWith('/')) byName.set(name.slice(name.lastIndexOf('/') + 1), bytes)
  }
  const parsed = buildParsedExport(txt)
  const kept = parsed.messages.slice(opts.from ?? 0, opts.to ?? parsed.messages.length)
  const renamed = new Map<string, string>()
  const media: { name: string; bytes: Uint8Array }[] = []
  let n = 0
  const msgs = kept.map((m) => ({
    sender: m.senderName,
    at: m.sentAt,
    body: m.body.replace(/微信(图片|视频)_\d{12}_\d+(\.\w+)/g, (old, what: string, ext: string) => {
      let next = renamed.get(old)
      if (!next) {
        next = `微信${what}_${opts.exportMinute}_${++n}${ext}`
        renamed.set(old, next)
        const bytes = byName.get(old)
        if (bytes) media.push({ name: next, bytes })
      }
      return next
    }),
  }))
  return buildExportZip({ text: buildExportText(msgs), media })
}

/** Clear general-purpose bit 11 in every local and central header (walks the central directory). */
export function clearUtf8Flags(zip: Uint8Array): void {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let eocd = -1
  for (let i = zip.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('no EOCD')
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad central header')
    dv.setUint16(p + 8, dv.getUint16(p + 8, true) & ~0x0800, true)
    const local = dv.getUint32(p + 42, true)
    dv.setUint16(local + 6, dv.getUint16(local + 6, true) & ~0x0800, true)
    p += 46 + dv.getUint16(p + 28, true) + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true)
  }
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SENDERS = ['测试甲', '测试乙', 'Zed Demo 测试', '示例丙丙', '小样本']
const PHRASES = [
  '好的，明天见', '我在路上了', '周末一起吃饭吗？', '收到[OK]', '哈哈哈哈[捂脸]', '这个周六下午有空吗，想约你去看展',
  '刚到公司，今天事情有点多，晚点回你', '嗯', '可以', '[流泪]', '谢谢！', '记得带伞，下午有雨',
  '上次说的那家店我去了，味道一般般，不过环境不错\n下次换一家试试', '·这一行以圆点开头但不是新消息',
]

/**
 * N-message synthetic chat with a realistic kind mix, plus media entries. Returns text, zip, and expectations.
 * Media payloads are random-ish bytes stored uncompressed so ZIP size (and hashing cost) resembles a real export.
 */
export function generateChat(n: number, opts: { seed?: number; imageCount?: number; imageBytes?: number; videoBytes?: number } = {}) {
  const r = rng(opts.seed ?? 42)
  const imageCount = opts.imageCount ?? 40
  const imageBytes = opts.imageBytes ?? 200_000
  const videoBytes = opts.videoBytes ?? 8_000_000
  const msgs: SynthMessage[] = []
  let minute = Date.UTC(2025, 0, 1, 8, 0) / 60000
  let img = 0
  for (let i = 0; i < n; i++) {
    minute += r() < 0.05 ? Math.floor(r() * 600) : Math.floor(r() * 3)
    const d = new Date(minute * 60000)
    const at = d.toISOString().slice(0, 16).replace('T', ' ')
    const sender = SENDERS[Math.floor(r() * SENDERS.length)]
    const x = r()
    let body: string
    if (x < 0.02 && img < imageCount) body = `[图片] 微信图片_202501010800_${++img}.jpg`
    else if (x < 0.03) body = `[语音] ${1 + Math.floor(r() * 59)}"`
    else if (x < 0.035) body = '[转账] 朋友已确认收款'
    else if (x < 0.04) body = '[动画表情]'
    else body = PHRASES[Math.floor(r() * PHRASES.length)]
    msgs.push({ sender, at, body })
  }
  msgs.push({ sender: SENDERS[0], at: msgs[msgs.length - 1].at, body: '[视频] 微信视频_202501010800_1.mp4' })
  const fill = (size: number, seed: number) => {
    const b = new Uint8Array(size)
    const rr = rng(seed)
    for (let i = 0; i < size; i += 4) {
      const v = (rr() * 4294967296) >>> 0
      b[i] = v & 0xff
      b[i + 1] = (v >>> 8) & 0xff
      b[i + 2] = (v >>> 16) & 0xff
      b[i + 3] = v >>> 24
    }
    return b
  }
  const media = [
    ...Array.from({ length: img }, (_, k) => ({ name: `微信图片_202501010800_${k + 1}.jpg`, bytes: fill(imageBytes, k + 1) })),
    { name: '微信视频_202501010800_1.mp4', bytes: fill(videoBytes, 999) },
  ]
  const text = buildExportText(msgs)
  const zip = buildExportZip({ text, media })
  return { msgs, text, zip, messageCount: msgs.length, imageCount: img }
}
