// Synthetic export builders for tests, benches and the browser perf script. Invented names only — never real data.
import { zipSync, strToU8, type Zippable } from 'fflate'

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
