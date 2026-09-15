// Deterministic synthetic WeChat export builder (SPEC §6). All people, places, phone numbers, card numbers and
// addresses are fictional. Formats marked `guess` are invented-but-plausible variants of message types that SPEC §6
// lists as "未见样本" (quote reply, recall, contact card, location, file, link, forward, group system messages).
import { strToU8, zipSync, type Zippable } from 'fflate'
import { jpegBytes, mp4Bytes } from './assets'
import { splitExportText } from './split'

export const MEDIA_DIR = '聊天记录内的图片、视频和文件'
export const TXT_NAME = '聊天记录.txt'
export const GENERATOR_VERSION = 1

// ---------------------------------------------------------------- PRNG (mulberry32)
export class Rng {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }
  pick<T>(a: readonly T[]): T {
    return a[Math.floor(this.next() * a.length)]
  }
  shuffle<T>(a: readonly T[]): T[] {
    const r = [...a]
    for (let i = r.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[r[i], r[j]] = [r[j], r[i]]
    }
    return r
  }
}

// ---------------------------------------------------------------- time helpers ('YYYY-MM-DD HH:MM')
export function toMin(t: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(t)
  if (!m) throw new Error(`bad time ${t}`)
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60_000
}
export function fromMin(n: number): string {
  const d = new Date(n * 60_000)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}
export function wechatTime(t: string): string {
  const [d, hm] = t.split(' ')
  const [y, mo, da] = d.split('-')
  return `${y}年${mo}月${da}日 ${hm}`
}

// ---------------------------------------------------------------- kinds
export const STICKER_CODES = new Set(
  '微笑 撇嘴 色 发呆 得意 流泪 害羞 闭嘴 睡 大哭 尴尬 发怒 调皮 呲牙 惊讶 难过 囧 抓狂 吐 偷笑 愉快 白眼 傲慢 困 惊恐 憨笑 悠闲 咒骂 疑问 嘘 晕 衰 骷髅 敲打 再见 擦汗 抠鼻 鼓掌 坏笑 鄙视 委屈 快哭了 亲亲 可怜 笑脸 生病 脸红 破涕为笑 恐惧 失望 无语 嘿哈 捂脸 奸笑 机智 皱眉 耶 吃瓜 加油 汗 天啊 Emm 社会社会 旺柴 好的 打脸 哇 翻白眼 666 让我看看 叹气 苦涩 裂开 嘴唇 爱心 心碎 拥抱 强 弱 握手 胜利 抱拳 勾引 拳头 OK 合十 啤酒 咖啡 蛋糕 玫瑰 凋谢 菜刀 炸弹 便便 月亮 太阳 庆祝 礼物 红包 發 福 烟花 爆竹 猪头 跳跳 发抖 转圈'.split(
    ' ',
  ),
)

export type DeclaredKind =
  | 'text' | 'sticker_code' | 'image' | 'video' | 'voice' | 'transfer' | 'red_packet' | 'mini_program' | 'channels'
  | 'animated_sticker' | 'video_call' | 'quote' | 'recall' | 'system' | 'file' | 'link' | 'location' | 'contact_card'
  | 'forward' | 'unknown'

const KIND_RULES: [RegExp, DeclaredKind, boolean][] = [
  [/^\[图片\]/, 'image', false],
  [/^\[视频\] /, 'video', false],
  [/^\[语音\] \d+"$/, 'voice', false],
  [/^\[转账\]/, 'transfer', false],
  [/^\[微信红包\]/, 'red_packet', false],
  [/^\[小程序\] /, 'mini_program', false],
  [/^\[视频号\] /, 'channels', false],
  [/^\[动画表情\]/, 'animated_sticker', false],
  [/^\[视频通话\]$/, 'video_call', false],
  // ---- guesses (SPEC §6 "未见样本")
  [/^\[引用\] /, 'quote', true],
  [/^「[^」\n]*」\n- - -/, 'quote', true],
  [/撤回了一条消息$/, 'recall', true],
  [/^\[文件\] /, 'file', true],
  [/^\[链接\] /, 'link', true],
  [/^\[位置\] /, 'location', true],
  [/^\[名片\] /, 'contact_card', true],
  [/^\[聊天记录\] /, 'forward', true],
  [/^"[^"]+"(邀请"[^"]+"加入了群聊|修改群名为"[^"]+"| 拍了拍 "[^"]+")$/, 'system', true],
]

/** The generator's declaration of the kind (SPEC §6 table + DECISIONS A6 guesses). Not the parser. */
export function declaredKind(body: string): { kind: DeclaredKind; guess: boolean } {
  for (const [re, kind, guess] of KIND_RULES) if (re.test(body)) return { kind, guess }
  const codes = body.match(/^(\[[^[\]\n]{1,8}\])+$/)
  if (codes && [...body.matchAll(/\[([^[\]]+)\]/g)].every((m) => STICKER_CODES.has(m[1]))) return { kind: 'sticker_code', guess: false }
  const lead = /^\[([^[\]\n]+)\]/.exec(body)
  if (lead && !STICKER_CODES.has(lead[1])) return { kind: 'unknown', guess: false }
  return { kind: 'text', guess: false }
}

// ---------------------------------------------------------------- script types
export interface LineOpts {
  /** minutes after the previous line of the scene (default random 0..2) */
  dt?: number
  /** planted item ids this message is evidence for */
  p?: string[]
  /** negative (must-not-record) ids this message belongs to */
  n?: string[]
}
export type Line = [speaker: string, body: string, opts?: LineOpts]
export const L = (speaker: string, body: string, opts?: LineOpts): Line => [speaker, body, opts]
export interface Scene {
  at: string
  lines: Line[]
}
export type Role = 'A' | 'B' | 'C'
/** A calendar day a filler dialogue may be placed on. weekday: 0 = Sunday. */
export interface Slot {
  date: string
  month: number
  day: number
  weekday: number
}
export interface FillerDialogue {
  lines: [role: Role, body: string][]
  /** start-time window 'HH:MM' (inclusive, exclusive); default ['09:00', '21:00'] */
  at?: [string, string]
  /** calendar constraint */
  when?: (s: Slot) => boolean
  /** allowed speaker tags per role (see ChatScript.filler.tags); a role without an entry accepts any speaker */
  roles?: Partial<Record<Role, string[]>>
  /** too specific to happen twice in one chat (e.g. the same workbook page) */
  once?: boolean
}
export interface TextFormat {
  /** prefix the text file with a UTF-8 BOM */
  bom?: boolean
  /** CRLF line endings */
  crlf?: boolean
  /** default true; false = the file ends right after the last body character */
  trailingNewline?: boolean
}

export type Category = 'work' | 'location' | 'education' | 'family' | 'preference' | 'life_event' | 'other'
export interface MemberDef {
  key: string
  label: string
  /** display name as sender in this chat, when the person speaks */
  displayName?: string
  note?: string
}
export interface PlantedDef {
  id: string
  type: 'claim' | 'handle' | 'relation' | 'date' | 'event'
  person?: string
  text: string
  category?: Category
  handleKind?: 'mentioned' | 'real_name' | 'address_term'
  value?: string
  from?: string
  to?: string
  relationType?: string
  label?: string
  date?: { kind: string; month?: number; day?: number; year?: number; calendar: 'solar' | 'lunar' }
  validFrom?: string
  supersedes?: string
  optional?: boolean
  note?: string
}
export interface NegativeDef {
  id: string
  kind: 'transactional' | 'coordination' | 'inference_trap' | 'sensitive' | 'invisible_content'
  description: string
  forbidden?: string
}
export interface ExportDef {
  file: string
  from: string
  to: string
  /** chat type only (README / intent); never planted content */
  purpose: string
  /** SPEC §6 text-file edge cases (BOM, CRLF, missing final newline) */
  text?: TextFormat
}
export interface ChatScript {
  id: string
  title: string
  kind: 'private' | 'group'
  /** speaker code → display name */
  speakers: Record<string, string>
  selfCode: string
  members: MemberDef[]
  planted: PlantedDef[]
  negatives: NegativeDef[]
  sensitiveValues: string[]
  scenes: Scene[]
  filler: {
    seed: number
    count: number
    from: string
    to: string
    pool: FillerDialogue[]
    speakers: string[]
    /** speaker code → tags matched by FillerDialogue.roles */
    tags?: Record<string, string[]>
    /** max uses of one dialogue in this chat (default 2) */
    maxUses?: number
    /** min days between two uses of the same dialogue (default 7) */
    minRepeatGapDays?: number
  }
  extraMedia?: { name: string; kind: 'image' | 'video' }[]
  exports: ExportDef[]
}

export interface MediaRef {
  name: string
  kind: 'image' | 'video' | 'file'
  included: boolean
}
export interface LaidMessage {
  sender: string
  sentAt: string
  body: string
  kind: DeclaredKind
  guess: boolean
  p: string[]
  n: string[]
  media: MediaRef | null
  origin: 'script' | 'filler' | 'perf'
}

// ---------------------------------------------------------------- body tokens → media
export class MediaCounter {
  private counts = new Map<string, number>()
  next(stamp: string, ext: string): number {
    const k = `${stamp}:${ext}`
    const n = (this.counts.get(k) ?? 0) + 1
    this.counts.set(k, n)
    return n
  }
}

export function resolveBody(body: string, sentAt: string, counter: MediaCounter): { body: string; media: MediaRef | null } {
  const stamp = sentAt.replace(/[- :]/g, '')
  if (body === '{{img}}' || body === '{{img:missing}}') {
    const name = `微信图片_${stamp}_${counter.next(stamp, 'jpg')}.jpg`
    return { body: `[图片] ${name}`, media: { name, kind: 'image', included: body === '{{img}}' } }
  }
  if (body === '{{vid}}') {
    const name = `微信视频_${stamp}_${counter.next(stamp, 'mp4')}.mp4`
    return { body: `[视频] ${name}`, media: { name, kind: 'video', included: true } }
  }
  if (body.includes('{{')) throw new Error(`unknown token in body: ${body}`)
  const file = /^\[文件\] (.+)$/.exec(body)
  if (file) return { body, media: { name: file[1], kind: 'file', included: true } }
  if (/^\[图片\]\s*$/.test(body)) return { body, media: { name: '', kind: 'image', included: false } }
  return { body, media: null }
}

export function laidMessage(sender: string, sentAt: string, rawBody: string, counter: MediaCounter, origin: LaidMessage['origin'], p: string[] = [], n: string[] = []): LaidMessage {
  const { body, media } = resolveBody(rawBody, sentAt, counter)
  const { kind, guess } = declaredKind(body)
  return { sender, sentAt, body, kind, guess, p, n, media, origin }
}

// ---------------------------------------------------------------- layout
export function layoutChat(script: ChatScript): LaidMessage[] {
  const rng = new Rng(script.filler.seed)
  const counter = new MediaCounter()
  const planted = new Set(script.planted.map((x) => x.id))
  const negatives = new Set(script.negatives.map((x) => x.id))
  const used = new Set<string>()
  const speakerName = (code: string) => {
    const name = script.speakers[code]
    if (!name) throw new Error(`${script.id}: unknown speaker code ${code}`)
    return name
  }

  type Placed = { start: number; lines: { code: string; body: string; opts?: LineOpts }[]; origin: 'script' | 'filler' }
  const placed: Placed[] = []
  const busy: [number, number][] = []
  for (const s of [...script.scenes].sort((a, b) => toMin(a.at) - toMin(b.at))) {
    const start = toMin(s.at)
    placed.push({ start, origin: 'script', lines: s.lines.map(([code, body, opts]) => ({ code, body, opts })) })
    busy.push([start - 90, start + s.lines.length * 3 + 90])
  }
  const f = script.filler
  const fFrom = toMin(`${f.from} 00:00`)
  const fDays = Math.round((toMin(`${f.to} 00:00`) - fFrom) / 1440)
  const maxUses = f.maxUses ?? 2
  const gap = f.minRepeatGapDays ?? 7
  const hm = (s: string) => +s.slice(0, 2) * 60 + +s.slice(3, 5)
  const slots: Slot[] = Array.from({ length: fDays + 1 }, (_, d) => {
    const date = fromMin(fFrom + d * 1440).slice(0, 10)
    const js = new Date(`${date}T00:00:00Z`)
    return { date, month: js.getUTCMonth() + 1, day: js.getUTCDate(), weekday: js.getUTCDay() }
  })
  const uses = new Map<FillerDialogue, { day: number; a: string }[]>()
  const assignRoles = (dlg: FillerDialogue, avoidA: Set<string>): Record<string, string> | null => {
    const order = rng.shuffle(f.speakers)
    const map: Record<string, string> = {}
    const taken = new Set<string>()
    for (const role of ['A', 'B', 'C'] as Role[]) {
      if (!dlg.lines.some(([r]) => r === role)) continue
      const ok = (code: string) =>
        !taken.has(code) && (!dlg.roles?.[role] || dlg.roles[role]!.some((t) => f.tags?.[code]?.includes(t))) && !(role === 'A' && avoidA.has(code))
      const code = order.find(ok)
      if (!code) return null
      map[role] = code
      taken.add(code)
    }
    return map
  }
  for (let i = 0; i < f.count; i++) {
    let ok = false
    const candidates = rng.shuffle(f.pool.filter((d) => (uses.get(d)?.length ?? 0) < (d.once ? 1 : maxUses)))
    for (const dlg of candidates) {
      const prev = uses.get(dlg) ?? []
      const validDays = slots.flatMap((s, d) => ((!dlg.when || dlg.when(s)) && prev.every((u) => Math.abs(u.day - d) >= gap) ? [d] : []))
      if (!validDays.length) continue
      const [h0, h1] = (dlg.at ?? ['09:00', '21:00']).map(hm)
      for (let attempt = 0; attempt < 60 && !ok; attempt++) {
        const day = rng.pick(validDays)
        const start = fFrom + day * 1440 + rng.int(h0, h1 - 1)
        const end = start + dlg.lines.length * 3
        if (busy.some(([a, b]) => start < b && end > a)) continue
        const roleMap = assignRoles(dlg, new Set(prev.map((u) => u.a)))
        if (!roleMap) continue
        busy.push([start - 90, end + 90])
        placed.push({ start, origin: 'filler', lines: dlg.lines.map(([role, body]) => ({ code: roleMap[role], body })) })
        uses.set(dlg, [...prev, { day, a: roleMap.A }])
        ok = true
      }
      if (ok) break
    }
    if (!ok) throw new Error(`${script.id}: could not place filler dialogue ${i}; lower filler.count or add dialogues`)
  }
  placed.sort((a, b) => a.start - b.start)

  const out: LaidMessage[] = []
  let prevEnd = -Infinity
  for (const sc of placed) {
    if (sc.start < prevEnd) throw new Error(`${script.id}: scene at ${fromMin(sc.start)} overlaps previous scene ending ${fromMin(prevEnd)}`)
    let t = sc.start
    sc.lines.forEach((ln, i) => {
      if (i > 0) t += ln.opts?.dt ?? rng.int(0, 2)
      for (const id of ln.opts?.p ?? []) {
        if (!planted.has(id)) throw new Error(`${script.id}: undefined planted id ${id}`)
        used.add(id)
      }
      for (const id of ln.opts?.n ?? []) {
        if (!negatives.has(id)) throw new Error(`${script.id}: undefined negative id ${id}`)
        used.add(id)
      }
      out.push(laidMessage(speakerName(ln.code), fromMin(t), ln.body, counter, sc.origin, ln.opts?.p ?? [], ln.opts?.n ?? []))
    })
    prevEnd = t + 1
  }
  for (const id of [...planted, ...negatives]) if (!used.has(id)) throw new Error(`${script.id}: id ${id} has no evidence line`)
  return out
}

// ---------------------------------------------------------------- zip
export function exportTxt(messages: LaidMessage[], fmt: TextFormat = {}): string {
  let txt = messages.map((m) => `·${m.sender}\n${wechatTime(m.sentAt)}\n${m.body}\n\n`).join('')
  if (fmt.trailingNewline === false) txt = txt.replace(/\n+$/, '')
  if (fmt.crlf) txt = txt.replace(/\n/g, '\r\n')
  if (fmt.bom) txt = `﻿${txt}`
  return txt
}

/** `聊天记录_YYYYMMDD_HHMMSS.zip` → local wall-clock components (used as ZIP mtime, TZ-independent). */
export function exportStamp(file: string): [number, number, number, number, number, number] {
  const m = /_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.zip$/.exec(file)
  if (!m) return [2026, 9, 15, 12, 0, 0]
  return [+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]]
}

export function buildZip(messages: LaidMessage[], file: string, extraMedia: { name: string; kind: 'image' | 'video' }[] = [], fmt: TextFormat = {}): Uint8Array {
  const [y, mo, d, h, mi, s] = exportStamp(file)
  const mtime = new Date(y, mo - 1, d, h, mi, s) // local components → DOS time identical in every TZ
  const entries: Zippable = { [TXT_NAME]: [strToU8(exportTxt(messages, fmt)), { mtime }] }
  const add = (name: string, kind: 'image' | 'video' | 'file') => {
    const path = `${MEDIA_DIR}/${name}`
    if (entries[path]) return
    const bytes = kind === 'image' ? jpegBytes(name) : kind === 'video' ? mp4Bytes(name) : strToU8(`synthetic attachment: ${name}\n`)
    entries[path] = [bytes, { mtime }]
  }
  for (const m of messages) if (m.media?.included && m.media.name) add(m.media.name, m.media.kind)
  for (const e of extraMedia) add(e.name, e.kind)
  return zipSync(entries, { level: 6, mtime })
}

/** Throws if the §6 splitter does not recover exactly the laid-out messages. */
export function selfCheck(messages: LaidMessage[], label: string, fmt: TextFormat = {}): void {
  const split = splitExportText(exportTxt(messages, fmt))
  if (split.length !== messages.length) throw new Error(`${label}: splitter found ${split.length} messages, expected ${messages.length}`)
  split.forEach((s, i) => {
    const m = messages[i]
    if (s.senderName !== m.sender || s.sentAt !== m.sentAt || s.body !== m.body) throw new Error(`${label}: message ${i} differs after split`)
    if (i > 0 && s.sentAt < split[i - 1].sentAt) throw new Error(`${label}: time goes backwards at ${i}`)
  })
}

// ---------------------------------------------------------------- intent
export function edgeCases(messages: LaidMessage[]): Record<string, number[]> {
  const e: Record<string, number[]> = {
    multiline: [], bodyLineStartsWithDot: [], bodyLineLooksLikeTime: [], emptyImageName: [], missingMedia: [],
    unknownBracket: [], sameMinuteDuplicate: [], stickerOnly: [], stickerMixed: [], unicodeEmoji: [], mention: [],
    quote: [], recall: [], contactCard: [], location: [], link: [], file: [], forward: [], system: [],
    // text-file level (filled by buildExports from ExportDef.text): bom → [0], crlf → every idx, noTrailingNewline → [last idx]
    bom: [], crlf: [], noTrailingNewline: [],
  }
  messages.forEach((m, i) => {
    const lines = m.body.split('\n')
    if (lines.length > 1) e.multiline.push(i)
    if (lines.some((l) => l.startsWith('·'))) e.bodyLineStartsWithDot.push(i)
    if (lines.some((l) => /^\d{4}年\d{2}月\d{2}日/.test(l))) e.bodyLineLooksLikeTime.push(i)
    if (m.media?.kind === 'image' && m.media.name === '') e.emptyImageName.push(i)
    if (m.media && m.media.name && !m.media.included) e.missingMedia.push(i)
    if (m.kind === 'unknown') e.unknownBracket.push(i)
    const prev = messages[i - 1]
    if (prev && prev.sender === m.sender && prev.sentAt === m.sentAt && prev.body === m.body) e.sameMinuteDuplicate.push(i)
    if (m.kind === 'sticker_code') e.stickerOnly.push(i)
    if (m.kind === 'text' && [...m.body.matchAll(/\[([^[\]]+)\]/g)].some((x) => STICKER_CODES.has(x[1]))) e.stickerMixed.push(i)
    if (/\p{Extended_Pictographic}/u.test(m.body)) e.unicodeEmoji.push(i)
    if (/(^|\s)@\S+ \S/.test(m.body)) e.mention.push(i)
    const byKind: Partial<Record<DeclaredKind, string>> = { quote: 'quote', recall: 'recall', contact_card: 'contactCard', location: 'location', link: 'link', file: 'file', forward: 'forward', system: 'system' }
    const k = byKind[m.kind]
    if (k) e[k].push(i)
  })
  return e
}

export interface GeneratedExport {
  file: string
  bytes: Uint8Array
  intent: Record<string, unknown>
  messageCount: number
  dateFrom: string
  dateTo: string
  purpose: string
  kind: 'private' | 'group'
}

export function buildExports(script: ChatScript): GeneratedExport[] {
  const all = layoutChat(script)
  selfCheck(all, script.id)
  const slices = script.exports.map((ex) => {
    const from = toMin(ex.from)
    const to = toMin(ex.to)
    const indices = all.map((_, i) => i).filter((i) => toMin(all[i].sentAt) >= from && toMin(all[i].sentAt) <= to)
    return { ex, indices }
  })
  return slices.map(({ ex, indices }, si) => {
    const msgs = indices.map((i) => all[i])
    const fmt = ex.text ?? {}
    selfCheck(msgs, ex.file, fmt)
    const txt = exportTxt(msgs)
    const edges = edgeCases(msgs)
    if (fmt.bom) edges.bom = [0]
    if (fmt.crlf) edges.crlf = msgs.map((_, i) => i)
    if (fmt.trailingNewline === false) edges.noTrailingNewline = [msgs.length - 1]
    const idsIn = (field: 'p' | 'n', id: string) => msgs.flatMap((m, i) => (m[field].includes(id) ? [i] : []))
    const fullCount = (field: 'p' | 'n', id: string) => all.filter((m) => m[field].includes(id)).length
    const planted = script.planted
      .map((d) => ({ ...d, idx: idsIn('p', d.id), ...(idsIn('p', d.id).length < fullCount('p', d.id) ? { partial: true } : {}) }))
      .filter((d) => d.idx.length > 0)
    const negatives = script.negatives
      .map((d) => ({ ...d, idx: idsIn('n', d.id), ...(idsIn('n', d.id).length < fullCount('n', d.id) ? { partial: true } : {}) }))
      .filter((d) => d.idx.length > 0)
    const senders = new Map<string, number>()
    for (const m of msgs) senders.set(m.sender, (senders.get(m.sender) ?? 0) + 1)
    const kinds: Record<string, number> = {}
    for (const m of msgs) kinds[m.kind] = (kinds[m.kind] ?? 0) + 1
    const overlaps = slices
      .filter((_, sj) => sj !== si)
      .map((o) => {
        const shared = indices.filter((i) => o.indices.includes(i))
        if (!shared.length) return null
        return {
          with: o.ex.file,
          messages: shared.length,
          sentAtRange: [all[shared[0]].sentAt, all[shared[shared.length - 1]].sentAt],
          thisIdxRange: [indices.indexOf(shared[0]), indices.indexOf(shared[shared.length - 1])],
          otherIdxRange: [o.indices.indexOf(shared[0]), o.indices.indexOf(shared[shared.length - 1])],
        }
      })
      .filter(Boolean)
    const includedMedia = [...new Set(msgs.filter((m) => m.media?.included && m.media.name).map((m) => m.media!.name))]
    const intent = {
      intentVersion: 1,
      generator: 'scripts/synthetic/generate.ts',
      generatorVersion: GENERATOR_VERSION,
      note: 'Planted by the generator. Annotators must not read this file before freezing gold (ARCHITECTURE §7.6). Not gold: ids, texts and idx are the generator\'s intent only.',
      zip: ex.file,
      chatScript: script.id,
      purpose: ex.purpose,
      chat: { title: script.title, kind: script.kind },
      self: script.speakers[script.selfCode],
      messageCount: msgs.length,
      dateFrom: msgs[0].sentAt,
      dateTo: msgs[msgs.length - 1].sentAt,
      senders: [...senders].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      members: script.members,
      planted,
      negatives,
      sensitiveValues: script.sensitiveValues.filter((v) => txt.includes(v)),
      kinds,
      guessedFormats: msgs.flatMap((m, i) => (m.guess ? [{ idx: i, kind: m.kind }] : [])),
      textFile: { bom: !!fmt.bom, lineEnding: fmt.crlf ? 'crlf' : 'lf', trailingNewline: fmt.trailingNewline !== false },
      edgeCases: edges,
      media: {
        included: includedMedia,
        missing: msgs.filter((m) => m.media && m.media.name && !m.media.included).map((m) => m.media!.name),
        emptyName: msgs.filter((m) => m.media && m.media.name === '').length,
        unreferenced: (script.extraMedia ?? []).map((e) => e.name),
      },
      overlaps,
    }
    return {
      file: ex.file,
      bytes: buildZip(msgs, ex.file, script.extraMedia, fmt),
      intent,
      messageCount: msgs.length,
      dateFrom: msgs[0].sentAt,
      dateTo: msgs[msgs.length - 1].sentAt,
      purpose: ex.purpose,
      kind: script.kind,
    }
  })
}
