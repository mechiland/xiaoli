// In-memory synthetic dataset for the seed accounts (ARCHITECTURE §9). Pure apart from node:crypto hashing.
// Rows carry final ids from an IdAllocator (bases = current max id + gap), so FK references are resolved before insert.
import { createHash } from 'node:crypto'
import { LunarYear, Solar } from 'lunar-typescript'
import type { Category, ChatKind, HandleKind, ImportStats, ImportStatus, MessageKind, MessageMeta, Status, TargetType } from '@/contracts'
import { lunarLabel } from '@/lib/lunar'
import { sortKey } from '@/lib/pinyin'
import type * as schema from '@/server/db/schema'
import type { ManifestRef } from './manifest'
import {
  ADDRESS_SUFFIXES,
  CATEGORIES,
  EVENT_KINDS,
  FILLER_KINDS,
  QUESTIONS,
  RELATION_KINDS,
  SENSITIVE_CLAIMS,
  makeClaimText,
  makeFiller,
  type ClaimText,
  type FillerMessage,
} from './content'
import { SPECIAL_LABELS, TAGGED_LABELS, generateChineseLabels } from './names'
import { tinyPng } from './png'
import { createRng, SEED_RNG, type Rng } from './rng'

type Ins<T extends { $inferInsert: unknown }> = T['$inferInsert']

export const ENTITY_TABLES = ['chats', 'imports', 'messages', 'attachments', 'persons', 'handles', 'relations', 'claims', 'events', 'importantDates', 'extractionJobs', 'reviewLog', 'llmCalls'] as const
export type EntityTableName = (typeof ENTITY_TABLES)[number]
export interface IdAllocator {
  next(t: EntityTableName): number
}
export function createIdAllocator(bases: Partial<Record<EntityTableName, number>>): IdAllocator {
  const cur: Partial<Record<EntityTableName, number>> = { ...bases }
  return { next: (t) => (cur[t] = (cur[t] ?? 0) + 1) }
}

export interface SeedTables {
  chats: Ins<typeof schema.chats>[]
  imports: Ins<typeof schema.imports>[]
  persons: Ins<typeof schema.persons>[]
  handles: Ins<typeof schema.handles>[]
  messages: Ins<typeof schema.messages>[]
  importMessages: Ins<typeof schema.importMessages>[]
  attachments: Ins<typeof schema.attachments>[]
  claims: Ins<typeof schema.claims>[]
  claimMentions: Ins<typeof schema.claimMentions>[]
  events: Ins<typeof schema.events>[]
  eventParticipants: Ins<typeof schema.eventParticipants>[]
  importantDates: Ins<typeof schema.importantDates>[]
  relations: Ins<typeof schema.relations>[]
  evidence: Ins<typeof schema.evidence>[]
  extractionJobs: Ins<typeof schema.extractionJobs>[]
  reviewLog: Ins<typeof schema.reviewLog>[]
  llmCalls: Ins<typeof schema.llmCalls>[]
  userSettings: Ins<typeof schema.userSettings>[]
}
export const INSERT_ORDER: (keyof SeedTables)[] = ['chats', 'imports', 'persons', 'handles', 'messages', 'importMessages', 'attachments', 'claims', 'claimMentions', 'events', 'eventParticipants', 'importantDates', 'relations', 'evidence', 'extractionJobs', 'reviewLog', 'llmCalls', 'userSettings']

export interface R2Put {
  key: string
  bytes: Uint8Array
  mime: string
}

export interface AccountDataset {
  tables: SeedTables
  r2: R2Put[]
  refs: { persons: Record<string, ManifestRef>; imports: Record<string, ManifestRef>; chats: Record<string, ManifestRef>; claims: Record<string, ManifestRef> }
  counts: Record<string, number>
}

const DAY = 86_400_000
const HOUR = 3_600_000
const pad = (n: number) => String(n).padStart(2, '0')
const norm = (s: string) => s.normalize('NFKC').toLowerCase().trim()
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/** FNV-1a 64 over UTF-8 of `${senderName}${sentAt}${kind}${body}` (parser contract §1.2), 16 hex. */
export function fingerprint(m: { senderName: string; sentAt: string; kind: string; body: string }): string {
  let h = 0xcbf29ce484222325n
  for (const byte of Buffer.from(`${m.senderName}${m.sentAt}${m.kind}${m.body}`, 'utf8')) {
    h ^= BigInt(byte)
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return h.toString(16).padStart(16, '0')
}

function fmtWall(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
function addDays(today: string, k: number): { y: number; m: number; d: number } {
  const [y, m, d] = today.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + k * DAY)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

export function emptyTables(): SeedTables {
  return { chats: [], imports: [], persons: [], handles: [], messages: [], importMessages: [], attachments: [], claims: [], claimMentions: [], events: [], eventParticipants: [], importantDates: [], relations: [], evidence: [], extractionJobs: [], reviewLog: [], llmCalls: [], userSettings: [] }
}

interface P {
  id: number
  label: string
  isSelf: boolean
  row: Ins<typeof schema.persons>
  taken: Set<string>
  chats: C[]
}
interface C {
  id: number
  title: string
  kind: ChatKind
  members: P[]
  display: Map<number, { handleId: number; name: string }>
  segs: S[]
}
interface S {
  id: number
  tag?: string
  chat: C | null
  status: ImportStatus
  fromDay: number
  toDay: number
  createdDay: number
  drafts: Draft[]
  reuse?: { from: S; count: number }
  items: number
}
interface Draft {
  id: number
  seg: S
  sender: P
  kind: MessageKind
  body: string
  meta: MessageMeta | null
  t: number
  order: number
  attachment?: FillerMessage['attachment']
  seq?: number
  sentAt?: string
  index?: number
}
interface EvRef {
  targetType: TargetType
  targetId: number
  fact: Draft
  extra: number
}

type ClaimRow = Ins<typeof schema.claims>

class Builder {
  readonly t = emptyTables()
  readonly r: Rng
  readonly wallToday: number
  order = 0
  readonly persons: P[] = []
  readonly byLabel = new Map<string, P>()
  readonly chats: C[] = []
  readonly segs: S[] = []
  readonly evRefs: EvRef[] = []
  readonly handleKeys = new Set<string>()
  readonly r2: R2Put[] = []
  self!: P

  constructor(
    readonly owner: string,
    readonly ids: IdAllocator,
    readonly today: string,
    readonly now: Date,
    readonly selfName: string,
    seed: number,
  ) {
    this.r = createRng(seed)
    const [y, m, d] = today.split('-').map(Number)
    this.wallToday = Date.UTC(y, m - 1, d)
  }

  iso(daysAgo: number, extraMs = 0): string {
    return new Date(Math.min(this.now.getTime(), this.now.getTime() - daysAgo * DAY + extraMs)).toISOString()
  }

  person(label: string, o: { isSelf?: boolean; pinned?: boolean; importId?: number; mergedIntoId?: number; createdDay?: number } = {}): P {
    const id = this.ids.next('persons')
    const at = this.iso(o.createdDay ?? 500)
    const row: Ins<typeof schema.persons> = {
      id,
      ownerId: this.owner,
      createdAt: at,
      updatedAt: at,
      label,
      isSelf: Boolean(o.isSelf),
      mergedIntoId: o.mergedIntoId ?? null,
      pinned: Boolean(o.pinned),
      avatarR2Key: null,
      lastMessageAt: null,
      labelSort: sortKey(label),
      importId: o.importId ?? null,
    }
    this.t.persons.push(row)
    const p: P = { id, label, isSelf: Boolean(o.isSelf), row, taken: new Set(), chats: [] }
    if (o.mergedIntoId === undefined) {
      this.persons.push(p)
      this.byLabel.set(label, p)
    }
    if (o.isSelf) this.self = p
    return p
  }

  chat(title: string, kind: ChatKind, members: P[], firstImportId: number, createdDay: number): C {
    const id = this.ids.next('chats')
    const at = this.iso(createdDay)
    this.t.chats.push({ id, ownerId: this.owner, createdAt: at, updatedAt: at, title, kind, note: null })
    const c: C = { id, title, kind, members: [], display: new Map(), segs: [] }
    this.chats.push(c)
    for (const m of members) this.join(c, m, firstImportId, createdDay)
    return c
  }

  join(c: C, p: P, importId: number, createdDay: number): void {
    if (c.display.has(p.id)) return
    let name = p.isSelf ? this.selfName : c.kind === 'private' ? p.label : this.groupNick(p)
    const namesInUse = new Set([...c.display.values()].map((v) => v.name))
    if (namesInUse.has(name)) name = p.label
    const handleId = this.handle(p, c.kind === 'private' ? 'display_private' : 'display_group', name, c.id, importId, 'confirmed', 'manual', createdDay)
    if (handleId === null) throw new Error(`duplicate display handle ${name} in chat ${c.title}`)
    c.display.set(p.id, { handleId, name })
    c.members.push(p)
    p.chats.push(c)
  }

  groupNick(p: P): string {
    if (/^\p{Script=Han}{2,3}$/u.test(p.label) && this.r.chance(0.25)) return this.r.chance(0.5) ? p.label.slice(1) : `阿${p.label.slice(-1)}`
    return p.label
  }

  handle(p: P | null, kind: HandleKind, value: string, chatId: number | null, importId: number | null, status: Status, sourceKind: 'ai' | 'manual', createdDay: number): number | null {
    const key = `${kind}|${value}|${chatId ?? 0}`
    if (this.handleKeys.has(key)) return null
    this.handleKeys.add(key)
    const id = this.ids.next('handles')
    const at = this.iso(createdDay, HOUR)
    this.t.handles.push({ id, ownerId: this.owner, createdAt: at, updatedAt: at, personId: p?.id ?? null, kind, value, valueNorm: norm(value), chatId, status, importId, sourceKind })
    return id
  }

  seg(o: { id?: number; chat: C | null; tag?: string; status: ImportStatus; fromDay: number; toDay: number; createdDay: number; reuse?: { from: S; count: number } }): S {
    const s: S = { id: o.id ?? this.ids.next('imports'), tag: o.tag, chat: o.chat, status: o.status, fromDay: o.fromDay, toDay: o.toDay, createdDay: o.createdDay, drafts: [], reuse: o.reuse, items: 0 }
    this.segs.push(s)
    o.chat?.segs.push(s)
    return s
  }

  randT(s: S): number {
    const day = this.r.int(s.toDay, s.fromDay)
    return this.wallToday - day * DAY + (8 * 60 + this.r.int(0, 15 * 60 + 29)) * 60_000
  }

  nameIn(c: C, p: P): string {
    return c.display.get(p.id)?.name ?? p.label
  }

  say(s: S, sender: P, body: string, o: { kind?: MessageKind; meta?: MessageMeta | null; attachment?: FillerMessage['attachment']; t?: number } = {}): Draft {
    if (!s.chat || !s.chat.display.has(sender.id)) throw new Error(`${sender.label} is not a member of chat ${s.chat?.title}`)
    const d: Draft = { id: this.ids.next('messages'), seg: s, sender, kind: o.kind ?? 'text', body, meta: o.meta ?? null, t: o.t ?? this.randT(s), order: this.order++, attachment: o.attachment }
    s.drafts.push(d)
    return d
  }

  statusFor(s: S): Status {
    if (s.status === 'done') return 'confirmed'
    if (s.status === 'extracting') return 'proposed'
    return this.r.chance(0.3) ? 'confirmed' : 'proposed'
  }

  speakerFor(s: S, subject: P): { speaker: P; first: boolean } {
    const c = s.chat!
    if (c.display.has(subject.id) && !subject.isSelf && this.r.chance(0.8)) return { speaker: subject, first: true }
    const others = c.members.filter((m) => m.id !== subject.id)
    if (c.kind === 'private' && this.r.chance(0.7)) return { speaker: this.self, first: false }
    return { speaker: this.r.pick(others), first: false }
  }

  utter(s: S, subject: P, text: { first: string; third: string; category?: Category }): Draft {
    const { speaker, first } = this.speakerFor(s, subject)
    const t = this.randT(s)
    if (first && s.chat!.kind === 'private' && text.category && this.r.chance(0.35)) {
      this.say(s, this.self, this.r.pick(QUESTIONS[text.category]), { t: t - this.r.int(1, 20) * 60_000 })
    }
    const body = first ? text.first : text.third.replaceAll('{name}', this.nameIn(s.chat!, subject))
    return this.say(s, speaker, body, { t })
  }

  evidence(targetType: TargetType, targetId: number, fact: Draft, extra?: number): void {
    const x = this.r.next()
    this.evRefs.push({ targetType, targetId, fact, extra: extra ?? (x < 0.6 ? 0 : x < 0.9 ? 1 : 2) })
  }

  claim(subject: P, text: ClaimText, o: { seg: S | null; status: Status; manual?: boolean; sensitive?: boolean; confidence?: number }): ClaimRow {
    const id = this.ids.next('claims')
    const manual = Boolean(o.manual)
    const s = manual ? null : o.seg
    if (!manual && !s) throw new Error('AI claim needs a segment')
    const at = manual ? this.iso(this.r.int(3, 300)) : this.iso(s!.createdDay, this.r.int(1, 18) * 60_000)
    const row: ClaimRow = {
      id,
      ownerId: this.owner,
      createdAt: at,
      updatedAt: at,
      personId: subject.id,
      statement: text.statement,
      statementNorm: norm(text.statement),
      category: text.category,
      validFrom: text.validFrom ?? null,
      validTo: null,
      learnedAt: at,
      confidence: manual ? null : (o.confidence ?? Math.round((0.55 + this.r.next() * 0.43) * 100) / 100),
      sensitive: Boolean(o.sensitive),
      status: o.status,
      statusReason: null,
      statusChangedAt: at,
      supersedesClaimId: null,
      supersededByClaimId: null,
      importId: s?.id ?? null,
      jobId: null,
      sourceKind: manual ? 'manual' : 'ai',
    }
    subject.taken.add(text.statement)
    if (s) {
      const fact = this.utter(s, subject, text)
      this.evidence('claim', id, fact)
      s.items++
    }
    if (text.mention) {
      const other = this.byLabel.get(text.mention)
      if (other && other.id !== subject.id) this.t.claimMentions.push({ ownerId: this.owner, createdAt: at, claimId: id, personId: other.id })
    }
    this.t.claims.push(row)
    return row
  }

  supersede(oldRow: ClaimRow, newRow: ClaimRow, reason: 'superseded' | 'edited'): void {
    oldRow.status = 'superseded'
    oldRow.statusReason = reason
    oldRow.supersededByClaimId = newRow.id
    oldRow.statusChangedAt = newRow.createdAt
    oldRow.updatedAt = newRow.createdAt
    newRow.supersedesClaimId = oldRow.id
  }

  outdated(row: ClaimRow, daysAgo: number): void {
    const d = addDays(this.today, -daysAgo)
    row.status = 'superseded'
    row.statusReason = 'outdated'
    row.validTo = `${d.y}-${pad(d.m)}-${pad(d.d)}`
    row.statusChangedAt = this.iso(daysAgo)
    row.updatedAt = row.statusChangedAt
  }

  relation(from: P, to: P, kind: { type: string; label: string }, s: S, status?: Status): Ins<typeof schema.relations> {
    const id = this.ids.next('relations')
    const at = this.iso(s.createdDay, 2 * 60_000)
    const c = s.chat!
    const speaker = c.display.has(from.id) ? from : this.self
    const body = speaker.id === from.id ? `${this.nameIn(c, to)}是我${kind.label}` : `${this.nameIn(c, to)}是${this.nameIn(c, from)}的${kind.label}`
    const fact = this.say(s, speaker, body)
    const row: Ins<typeof schema.relations> = { id, ownerId: this.owner, createdAt: at, updatedAt: at, fromPersonId: to.id, toPersonId: from.id, type: kind.type, label: kind.label, status: status ?? this.statusFor(s), importId: s.id, sourceKind: 'ai' }
    this.t.relations.push(row)
    this.evidence('relation', id, fact, 0)
    s.items++
    return row
  }

  event(participants: P[], ek: { place: string; act: string }, s: S, happenedAt: string | null, status?: Status): Ins<typeof schema.events> {
    const id = this.ids.next('events')
    const at = this.iso(s.createdDay, 3 * 60_000)
    const c = s.chat!
    const speaker = participants.find((p) => !p.isSelf && c.display.has(p.id)) ?? this.self
    const names = participants.filter((p) => p.id !== speaker.id).map((p) => this.nameIn(c, p))
    const body = `上次和${names.length ? names.join('、') : '大家'}去${ek.place}${ek.act}，太开心了`
    const fact = this.say(s, speaker, body)
    const row: Ins<typeof schema.events> = { id, ownerId: this.owner, createdAt: at, updatedAt: at, summary: `一起去${ek.place}${ek.act}`, happenedAt, place: ek.place, status: status ?? this.statusFor(s), importId: s.id, sourceKind: 'ai' }
    this.t.events.push(row)
    const seen = new Set<number>()
    for (const p of participants) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      this.t.eventParticipants.push({ ownerId: this.owner, createdAt: at, eventId: id, personId: p.id })
    }
    this.evidence('event', id, fact, 0)
    s.items++
    return row
  }

  date(subject: P, d: { kind: string; calendar: 'solar' | 'lunar'; month: number; day: number; year?: number; isLeap?: boolean; label?: string }, s: S, status?: Status): Ins<typeof schema.importantDates> {
    const id = this.ids.next('importantDates')
    const at = this.iso(s.createdDay, 4 * 60_000)
    const when = d.calendar === 'lunar' ? lunarLabel(d.month, d.day, Boolean(d.isLeap)) : `${d.month}月${d.day}号`
    const phrase =
      d.kind === 'birthday'
        ? d.calendar === 'lunar'
          ? { first: `我过农历生日，${when}`, third: `{name}过农历生日，${when}` }
          : { first: `我生日是${when}`, third: `{name}生日是${when}` }
        : d.kind === 'anniversary'
          ? { first: `${when}是我们结婚纪念日`, third: `${when}是{name}的结婚纪念日` }
          : { first: `${when}是${d.label ?? '个重要的日子'}`, third: `${when}是{name}的${d.label ?? '重要日子'}` }
    const fact = this.utter(s, subject, phrase)
    const row: Ins<typeof schema.importantDates> = { id, ownerId: this.owner, createdAt: at, updatedAt: at, personId: subject.id, kind: d.kind, day: d.day, month: d.month, year: d.year ?? null, calendar: d.calendar, isLeapMonth: Boolean(d.isLeap), label: d.label ?? null, status: status ?? this.statusFor(s), importId: s.id, sourceKind: 'ai' }
    this.t.importantDates.push(row)
    this.evidence('date', id, fact, 0)
    s.items++
    return row
  }

  /** `@mentioned term，…` in a group: a `mentioned` and an `address_term` handle with the same evidence message. */
  aliasPair(subject: P, s: S, mentioned: string, term: string, status?: Status): void {
    const c = s.chat!
    const others = c.members.filter((m) => m.id !== subject.id)
    const fact = this.say(s, this.r.pick(others), `@${mentioned} ${term}，周末来不来？`)
    const st = status ?? this.statusFor(s)
    for (const [kind, value] of [['mentioned', mentioned], ['address_term', term]] as const) {
      const id = this.handle(subject, kind, value, c.id, s.id, st, 'ai', s.createdDay)
      if (id !== null) {
        this.evidence('handle', id, fact, 0)
        s.items++
      }
    }
  }

  realName(subject: P, s: S, value: string, status?: Status): void {
    const c = s.chat!
    const speaker = c.members.find((m) => m.isSelf)!
    const fact = this.say(s, speaker, `${this.nameIn(c, subject)}大名叫${value}`)
    const id = this.handle(subject, 'real_name', value, null, s.id, status ?? this.statusFor(s), 'ai', s.createdDay)
    if (id !== null) {
      this.evidence('handle', id, fact, 0)
      s.items++
    }
  }

  addressTerm(subject: P, s: S, term: string, status?: Status): void {
    const fact = this.say(s, this.self, `${term}，最近怎么样？`)
    const id = this.handle(subject, 'address_term', term, s.chat!.id, s.id, status ?? this.statusFor(s), 'ai', s.createdDay)
    if (id !== null) {
      this.evidence('handle', id, fact, 0)
      s.items++
    }
  }

  filler(s: S, n: number): void {
    const c = s.chat!
    for (let i = 0; i < n; i++) {
      const sender = this.r.pick(c.members)
      const t = this.randT(s)
      const other = this.nameIn(c, this.r.pick(c.members))
      const f = makeFiller(this.r, fmtWall(t).replace(/[- :]/g, ''), i + 1, other)
      this.say(s, sender, f.body, { kind: f.kind, meta: f.meta, attachment: f.attachment, t })
    }
  }

  /** one message of every MessageKind the filler knows */
  everyKind(s: S): void {
    const c = s.chat!
    for (const kind of FILLER_KINDS) {
      for (let tries = 0; tries < 2000; tries++) {
        const t = this.randT(s)
        const f = makeFiller(this.r, fmtWall(t).replace(/[- :]/g, ''), 90 + tries, this.nameIn(c, this.r.pick(c.members)))
        if (f.kind !== kind || (f.attachment && !f.attachment.fileName)) continue
        this.say(s, this.r.pick(c.members), f.body, { kind: f.kind, meta: f.meta, attachment: f.attachment, t })
        break
      }
    }
  }

  images(s: S, n: number): void {
    const c = s.chat!
    for (let i = 0; i < n; i++) {
      const t = this.randT(s)
      const fileName = `微信图片_${fmtWall(t).replace(/[- :]/g, '')}_${i + 1}.jpg`
      this.say(s, this.r.pick(c.members), `[图片] ${fileName}`, { kind: 'image', meta: { fileName }, t, attachment: { kind: 'image', fileName, byteSize: 120_000, mime: 'image/jpeg' } })
    }
  }

  claimText(subject: P, o: { category?: Category; chainable?: boolean } = {}): ClaimText {
    const others = this.persons.filter((p) => !p.isSelf && p.id !== subject.id)
    return makeClaimText(this.r, { otherLabels: others.length ? [this.r.pick(others).label] : [], yearBase: Number(this.today.slice(0, 4)) }, subject.taken, o)
  }

  finalize(settings: Ins<typeof schema.userSettings> | null, uploadLimit: number): void {
    const segById = new Map(this.segs.map((s) => [s.id, s]))
    const chatDrafts = new Map<number, Draft[]>()
    for (const c of this.chats) {
      const drafts = c.segs.flatMap((s) => s.drafts).sort((a, b) => a.t - b.t || a.order - b.order)
      drafts.forEach((d, i) => {
        d.seq = (i + 1) * 1024
        d.sentAt = fmtWall(d.t)
        d.index = i
      })
      chatDrafts.set(c.id, drafts)
    }

    // messages
    const lastByPerson = new Map<number, string>()
    for (const c of this.chats) {
      for (const d of chatDrafts.get(c.id)!) {
        const disp = c.display.get(d.sender.id)!
        const at = this.iso(d.seg.createdDay)
        this.t.messages.push({ id: d.id, ownerId: this.owner, createdAt: at, updatedAt: at, chatId: c.id, firstImportId: d.seg.id, senderHandleId: disp.handleId, senderName: disp.name, sentAt: d.sentAt!, seq: d.seq!, kind: d.kind, body: d.body, meta: d.meta, fingerprint: fingerprint({ senderName: disp.name, sentAt: d.sentAt!, kind: d.kind, body: d.body }) })
        const prev = lastByPerson.get(d.sender.id)
        if (!prev || prev < d.sentAt!) lastByPerson.set(d.sender.id, d.sentAt!)
      }
    }
    for (const p of this.t.persons) p.lastMessageAt = lastByPerson.get(p.id!) ?? null

    // imports + import_messages + attachments
    let uploaded = 0
    for (const s of this.segs) {
      const at = this.iso(s.createdDay)
      const own = [...s.drafts].sort((a, b) => a.seq! - b.seq!)
      const reused = s.reuse ? [...s.reuse.from.drafts].sort((a, b) => a.seq! - b.seq!).slice(-s.reuse.count) : []
      const all = [...reused, ...own]
      const stats: ImportStats = { byKind: {}, bySender: {}, images: { count: 0, bytes: 0 }, videos: { count: 0, bytes: 0 } }
      for (const d of all) {
        stats.byKind[d.kind] = (stats.byKind[d.kind] ?? 0) + 1
        const name = s.chat!.display.get(d.sender.id)!.name
        stats.bySender[name] = (stats.bySender[name] ?? 0) + 1
        if (d.attachment?.kind === 'image' && d.attachment.fileName) {
          stats.images.count++
          stats.images.bytes += d.attachment.byteSize
        }
        if (d.attachment?.kind === 'video') {
          stats.videos.count++
          stats.videos.bytes += d.attachment.byteSize
        }
      }
      const created = new Date(at)
      const local = new Date(created.getTime() + 8 * HOUR)
      const fileName = `聊天记录_${local.getUTCFullYear()}${pad(local.getUTCMonth() + 1)}${pad(local.getUTCDate())}_${pad(local.getUTCHours())}${pad(local.getUTCMinutes())}${pad(local.getUTCSeconds())}.zip`
      const sentTimes = all.map((d) => d.sentAt!).sort()
      this.t.imports.push({
        id: s.id,
        ownerId: this.owner,
        createdAt: at,
        updatedAt: at,
        chatId: s.chat?.id ?? null,
        fileName,
        fileSha256: sha256(`${this.owner}:${s.id}:${s.tag ?? ''}`),
        exportedAt: new Date(created.getTime() - HOUR).toISOString(),
        parserVersion: 'seed',
        status: s.status,
        messageCount: s.chat ? all.length : 120,
        newMessageCount: s.chat ? own.length : 0,
        dateFrom: sentTimes[0] ?? null,
        dateTo: sentTimes[sentTimes.length - 1] ?? null,
        stats: s.chat ? stats : { byKind: { text: 110, image: 10 }, bySender: { 我是小丽: 60, 未确认的朋友: 60 }, images: { count: 10, bytes: 1_200_000 }, videos: { count: 0, bytes: 0 } },
        error: null,
      })
      for (const d of all) this.t.importMessages.push({ ownerId: this.owner, createdAt: at, importId: s.id, messageId: d.id })

      let pending = 0
      for (const d of [...s.drafts].sort((a, b) => a.order - b.order)) {
        if (!d.attachment) continue
        const a = d.attachment
        let selected = false
        let r2Key: string | null = null
        let byteSize: number | null = a.byteSize || null
        let mime: string | null = a.mime
        if (a.kind === 'image' && a.fileName && s.tag === 'uploads-pending' && pending < 3) {
          selected = true
          pending++
        } else if (a.kind === 'image' && a.fileName && s.status === 'done' && s.tag !== 'uploads-pending' && uploaded < uploadLimit) {
          const bytes = tinyPng(uploaded)
          selected = true
          r2Key = `u/${this.owner}/att/${s.id}/${sha256(a.fileName)}-${a.fileName}`
          byteSize = bytes.length
          mime = 'image/png'
          this.r2.push({ key: r2Key, bytes, mime })
          uploaded++
        }
        const aid = this.ids.next('attachments')
        this.t.attachments.push({ id: aid, ownerId: this.owner, createdAt: at, updatedAt: at, messageId: d.id, kind: a.kind, fileName: a.fileName, selected, r2Key, byteSize, mime })
      }

      // extraction jobs (windows of ≤150 over this import's new messages)
      if (!s.chat || s.status === 'mapping') continue
      const minJobs = s.tag === 'in-progress' ? 6 : s.tag === 'failed-windows' ? 5 : 1
      const n = Math.max(minJobs, Math.ceil(own.length / 150))
      const size = Math.max(1, Math.ceil(own.length / n))
      const doneJobs = s.tag === 'in-progress' ? 2 : s.tag === 'failed-windows' ? n - 2 : n
      for (let i = 0; i < n; i++) {
        const chunk = own.slice(i * size, (i + 1) * size)
        const first = chunk[0] ?? own[own.length - 1]
        const last = chunk[chunk.length - 1] ?? first
        const status = s.tag === 'in-progress' ? (i < 2 ? 'done' : 'pending') : s.tag === 'failed-windows' && i >= n - 2 ? 'failed' : 'done'
        const jid = this.ids.next('extractionJobs')
        this.t.extractionJobs.push({
          id: jid,
          ownerId: this.owner,
          createdAt: at,
          updatedAt: at,
          importId: s.id,
          windowStartSeq: first?.seq ?? 0,
          windowEndSeq: last?.seq ?? 0,
          focusStartSeq: first?.seq ?? 0,
          focusEndSeq: last?.seq ?? 0,
          status,
          attempts: status === 'failed' ? 3 : status === 'done' ? 1 : 0,
          lockedAt: null,
          model: status === 'pending' ? null : 'deepseek-flash',
          promptVersion: status === 'pending' ? null : 'extract.v1',
          rawOutput: null,
          error: status === 'failed' ? 'invalid_json: 模型返回的内容不是合法的 JSON' : null,
          itemsCreated: status === 'done' ? Math.floor(s.items / Math.max(1, doneJobs)) : 0,
        })
        if (status === 'done' && this.t.llmCalls.length < 8 && s.status !== 'done') {
          this.t.llmCalls.push({ id: this.ids.next('llmCalls'), ownerId: this.owner, provider: 'deepseek', model: 'deepseek-flash', promptVersion: 'extract.v1', purpose: 'extract', importId: s.id, jobId: jid, evalRunId: null, inputTokens: 5200, outputTokens: 900, cacheHitTokens: 0, latencyMs: 8400, attempt: 1, mode: 'replay', cassetteKey: null, rawOutput: '{"newPersons":[],"handles":[],"relations":[],"claims":[],"events":[],"dates":[]}', finishReason: 'stop', errorCode: null, errorMessage: null, createdAt: at })
        }
      }
    }

    // evidence (fact message + optional neighbours)
    const evKeys = new Set<string>()
    for (const ref of this.evRefs) {
      const list = chatDrafts.get(ref.fact.seg.chat!.id)!
      const i = ref.fact.index!
      const msgs = [ref.fact]
      if (ref.extra >= 1 && i > 0) msgs.push(list[i - 1])
      if (ref.extra >= 2 && i + 1 < list.length) msgs.push(list[i + 1])
      for (const m of msgs) {
        const key = `${ref.targetType}:${ref.targetId}:${m.id}`
        if (evKeys.has(key)) continue
        evKeys.add(key)
        this.t.evidence.push({ ownerId: this.owner, createdAt: this.iso(ref.fact.seg.createdDay), targetType: ref.targetType, targetId: ref.targetId, messageId: m.id })
      }
    }

    // review log: accepts in reviewing imports and the two most recent done imports, rejects, supersedes, edits
    const recentDone = this.segs.filter((s) => s.status === 'done').sort((a, b) => a.createdDay - b.createdDay).slice(0, 2).map((s) => s.id)
    const log = (targetType: TargetType, targetId: number, action: Ins<typeof schema.reviewLog>['action'], before: unknown, after: unknown, at: string) =>
      this.t.reviewLog.push({ id: this.ids.next('reviewLog'), ownerId: this.owner, createdAt: at, updatedAt: at, targetType, targetId, action, before, after })
    let accepts = 0
    for (const c of this.t.claims) {
      const s = c.importId ? segById.get(c.importId) : undefined
      if (!s) continue
      const at = this.iso(s.createdDay, 2 * HOUR)
      if (c.status === 'confirmed' && (s.status === 'reviewing' || (recentDone.includes(s.id) && accepts < 400))) {
        log('claim', c.id!, 'accept', { status: 'proposed' }, { status: 'confirmed' }, at)
        accepts++
      } else if (c.status === 'rejected') log('claim', c.id!, 'reject', { status: 'proposed' }, { status: 'rejected' }, at)
      else if (c.status === 'superseded' && c.statusReason === 'edited') log('claim', c.id!, 'edit', { statement: c.statement }, { claimId: c.supersededByClaimId }, c.statusChangedAt)
      else if (c.status === 'superseded' && c.statusReason === 'outdated') log('claim', c.id!, 'supersede', { status: 'confirmed' }, { statusReason: 'outdated', validTo: c.validTo }, c.statusChangedAt)
    }

    if (settings) this.t.userSettings.push(settings)
  }
}

function segsWhere(b: Builder, p: P, pred: (s: S) => boolean): S[] {
  return p.chats.flatMap((c) => c.segs).filter(pred)
}

export interface BuildOptions {
  today: string
  now: Date
  seed?: number
}

/** The full `seed@xiaoli.test` dataset. */
export function buildMainAccount(owner: string, ids: IdAllocator, o: BuildOptions): AccountDataset {
  const b = new Builder(owner, ids, o.today, o.now, '我是小丽', o.seed ?? SEED_RNG)
  const r = b.r
  const T = TAGGED_LABELS
  const refs: AccountDataset['refs'] = { persons: {}, imports: {}, chats: {}, claims: {} }
  const tagP = (tag: string, p: P) => (refs.persons[tag] = { id: p.id, label: p.label })

  // import ids needed before persons created by those imports
  const reviewMixedId = ids.next('imports')
  const deleteMeId = ids.next('imports')

  // ---- persons ----
  const self = b.person('我', { isSelf: true, createdDay: 520 })
  const long = b.person(T.longProfile, { pinned: true })
  const sparse = b.person(T.sparseProfile)
  const heavy = b.person(T.proposedHeavy, { pinned: true })
  const history = b.person(T.withHistory, { pinned: true })
  const lunarSoon = b.person(T.lunarBirthdaySoon, { pinned: true })
  const leap = b.person(T.leapMonth)
  const longLabel = b.person(T.longLabel)
  const alice = b.person(T.privateLatin)
  const specials = SPECIAL_LABELS.filter((l) => l !== T.privateLatin).map((l) => b.person(l))
  const reserved = [...Object.values(T), ...SPECIAL_LABELS]
  const regularLabels = generateChineseLabels(createRng((o.seed ?? SEED_RNG) + 1), 181, reserved)
  const regular = regularLabels.map((l, i) => b.person(l, { pinned: i < 8 }))
  const deleteMe = b.person(T.deleteMe, { importId: deleteMeId, createdDay: 19 })
  const reviewNew = b.person(T.reviewNew, { importId: reviewMixedId, createdDay: 3 })
  // merged (hidden) persons
  b.person('知夏', { mergedIntoId: long.id, createdDay: 300 })
  b.person(regular[0].label.slice(1), { mergedIntoId: regular[0].id, createdDay: 250 })
  b.person('Kevin', { mergedIntoId: specials.find((p) => p.label === 'Kevin Wu')!.id, createdDay: 200 })

  for (const [tag, p] of [['long-profile', long], ['sparse-profile', sparse], ['proposed-heavy', heavy], ['with-history', history], ['lunar-birthday-soon', lunarSoon], ['leap-month', leap], ['long-label', longLabel], ['delete-me-person', deleteMe], ['review-new-person', reviewNew], ['private-alice', alice], ['self', self]] as const) tagP(tag, p)

  // ---- chats & imports ----
  const pool = r.shuffle([...regular])
  const gbMembers = [self, long, leap, heavy, ...pool.slice(0, 60), ...specials.filter((p) => ['Ivy Zhang', 'Emma', '🐱 橘子妈妈'].includes(p.label))]
  const owMembers = [self, long, sparse, lunarSoon, ...pool.slice(50, 88), ...specials.filter((p) => p.label === '8楼邻居刘阿姨')]
  const bdMembers = [self, long, alice, longLabel, ...pool.slice(83, 101), ...specials.filter((p) => ['Kevin Wu', 'Oscar Li', 'Uma Patel'].includes(p.label))]

  const gbId = ids.next('imports')
  const groupBig = b.chat('大学同学群', 'group', gbMembers, gbId, 420)
  const gb1 = b.seg({ id: gbId, chat: groupBig, status: 'done', fromDay: 420, toDay: 200, createdDay: 199 })
  const gb2 = b.seg({ chat: groupBig, status: 'done', fromDay: 198, toDay: 70, createdDay: 68, reuse: { from: gb1, count: 30 } })
  b.join(groupBig, reviewNew, reviewMixedId, 3)
  const reviewMixed = b.seg({ id: reviewMixedId, chat: groupBig, tag: 'review-mixed', status: 'reviewing', fromDay: 12, toDay: 4, createdDay: 3 })

  const owId = ids.next('imports')
  const owners = b.chat('小区业主群', 'group', owMembers, owId, 380)
  const ow1 = b.seg({ id: owId, chat: owners, status: 'done', fromDay: 380, toDay: 120, createdDay: 118 })
  const reviewEmpty = b.seg({ chat: owners, tag: 'review-empty', status: 'reviewing', fromDay: 8, toDay: 6, createdDay: 5 })

  const bdId = ids.next('imports')
  const badminton = b.chat('周末羽毛球', 'group', bdMembers, bdId, 300)
  const bd1 = b.seg({ id: bdId, chat: badminton, tag: 'uploads-pending', status: 'done', fromDay: 300, toDay: 90, createdDay: 88 })

  const plId = ids.next('imports')
  const privateLong = b.chat(long.label, 'private', [self, long], plId, 500)
  const pl1 = b.seg({ id: plId, chat: privateLong, status: 'done', fromDay: 500, toDay: 150, createdDay: 149 })
  const pl2 = b.seg({ chat: privateLong, status: 'done', fromDay: 148, toDay: 25, createdDay: 24 })

  const hiId = ids.next('imports')
  const hiChat = b.chat(history.label, 'private', [self, history], hiId, 460)
  const hi1 = b.seg({ id: hiId, chat: hiChat, status: 'done', fromDay: 460, toDay: 40, createdDay: 39 })

  const hvId = ids.next('imports')
  const hvChat = b.chat(heavy.label, 'private', [self, heavy], hvId, 200)
  const hv1 = b.seg({ id: hvId, chat: hvChat, status: 'done', fromDay: 200, toDay: 50, createdDay: 48 })

  const ipId = ids.next('imports')
  const ipChat = b.chat(lunarSoon.label, 'private', [self, lunarSoon], ipId, 60)
  const inProgress = b.seg({ id: ipId, chat: ipChat, tag: 'in-progress', status: 'extracting', fromDay: 60, toDay: 2, createdDay: 1 })

  const fwId = ids.next('imports')
  const fwChat = b.chat(alice.label, 'private', [self, alice], fwId, 90)
  const failedWin = b.seg({ id: fwId, chat: fwChat, tag: 'failed-windows', status: 'reviewing', fromDay: 90, toDay: 15, createdDay: 14 })

  const dmChat = b.chat(deleteMe.label, 'private', [self, deleteMe], deleteMeId, 30)
  const delSeg = b.seg({ id: deleteMeId, chat: dmChat, tag: 'delete-me', status: 'reviewing', fromDay: 30, toDay: 20, createdDay: 19 })

  const unfinished = b.seg({ chat: null, tag: 'unfinished', status: 'mapping', fromDay: 0, toDay: 0, createdDay: 0 })

  refs.chats['group-big'] = { id: groupBig.id, title: groupBig.title }
  refs.chats['group-owners'] = { id: owners.id, title: owners.title }
  refs.chats['group-badminton'] = { id: badminton.id, title: badminton.title }
  refs.chats['private-long'] = { id: privateLong.id, title: privateLong.title }
  refs.chats['private-history'] = { id: hiChat.id, title: hiChat.title }
  refs.chats['private-heavy'] = { id: hvChat.id, title: hvChat.title }
  refs.chats['private-in-progress'] = { id: ipChat.id, title: ipChat.title }
  refs.chats['private-failed-windows'] = { id: fwChat.id, title: fwChat.title }
  refs.chats['delete-me'] = { id: dmChat.id, title: dmChat.title }
  const segTags: [string, S][] = [['group-big-1', gb1], ['group-big-2', gb2], ['review-mixed', reviewMixed], ['owners-1', ow1], ['review-empty', reviewEmpty], ['uploads-pending', bd1], ['private-long-1', pl1], ['private-long-2', pl2], ['with-history', hi1], ['proposed-heavy-chat', hv1], ['in-progress', inProgress], ['failed-windows', failedWin], ['delete-me', delSeg], ['unfinished', unfinished]]
  for (const [tag, s] of segTags) refs.imports[tag] = { id: s.id, title: s.chat?.title ?? '' }

  // explicit media first (uploads-pending needs 3 selected images; ≥10 images get uploaded)
  b.images(bd1, 4)
  b.images(gb1, 4)
  b.images(pl1, 4)
  b.images(ow1, 3)
  b.everyKind(gb1)

  const doneSegs = b.segs.filter((s) => s.status === 'done')
  const doneFor = (p: P) => {
    const own = segsWhere(b, p, (s) => s.status === 'done')
    return own.length && r.chance(0.85) ? own : doneSegs
  }
  const reviewFor = (p: P): S => {
    if (p.chats.includes(fwChat)) return failedWin
    if (p.chats.includes(ipChat)) return r.chance(0.5) ? inProgress : ow1.chat === owners ? reviewMixed : reviewMixed
    const x = r.next()
    return x < 0.8 ? reviewMixed : x < 0.9 ? failedWin : inProgress
  }
  const byCreated = (xs: S[]) => [...xs].sort((a, c) => c.createdDay - a.createdDay) // oldest first
  const confirmedClaim = (p: P, segs: S[], o: { category?: Category; sensitive?: boolean } = {}) => {
    if (o.sensitive) {
      const text = SENSITIVE_CLAIMS.find((c) => !p.taken.has(c.statement))
      if (text) return b.claim(p, text, { seg: r.pick(segs), status: 'confirmed', sensitive: true })
    }
    return b.claim(p, b.claimText(p, { category: o.category }), { seg: r.pick(segs), status: 'confirmed' })
  }

  // ---- long-profile: 60 claims, 15 aliases, 8 relations, 6 events, 5 dates ----
  const longDone = [gb1, gb2, ow1, bd1, pl1, pl2]
  const searchable = b.claim(long, { category: 'preference', statement: '收藏了一整套景德镇青花茶具', first: '我收藏了一整套景德镇青花茶具，下次来家里喝茶', third: '{name}收藏了一整套景德镇青花茶具' }, { seg: pl2, status: 'confirmed', confidence: 0.93 })
  refs.claims['claim-searchable'] = { id: searchable.id!, personId: long.id, statement: searchable.statement }
  const shared = b.claim(long, { category: 'work', statement: '在杭州的一家动画工作室做制片', first: '我现在在杭州的一家动画工作室做制片', third: '{name}现在在杭州的一家动画工作室做制片' }, { seg: pl1, status: 'confirmed', confidence: 0.9 })
  const sharedFact = b.say(delSeg, b.self, `${long.label}现在在杭州的一家动画工作室做制片，你可以找她聊聊`)
  b.evidence('claim', shared.id!, sharedFact, 0)
  refs.claims['delete-me-shared'] = { id: shared.id!, personId: long.id, statement: shared.statement }
  const oldWork = b.claim(long, b.claimText(long, { category: 'work', chainable: true }), { seg: pl1, status: 'confirmed' })
  const newWork = b.claim(long, b.claimText(long, { category: 'work', chainable: true }), { seg: pl2, status: 'confirmed' })
  b.supersede(oldWork, newWork, 'superseded')
  b.claim(long, b.claimText(long, { category: 'location' }), { seg: reviewMixed, status: 'proposed', confidence: 0.91 })
  b.claim(long, b.claimText(long, { category: 'family' }), { seg: reviewMixed, status: 'proposed', confidence: 0.62 })
  b.claim(long, b.claimText(long), { seg: gb2, status: 'rejected' })
  b.claim(long, b.claimText(long, { category: 'preference' }), { seg: null, status: 'confirmed', manual: true })
  b.claim(long, b.claimText(long, { category: 'other' }), { seg: null, status: 'confirmed', manual: true })
  for (let i = 0; b.t.claims.filter((c) => c.personId === long.id).length < 60; i++) confirmedClaim(long, longDone, { category: CATEGORIES[i % CATEGORIES.length] })
  // aliases: display handles in 4 chats + 4 mentioned + 4 address terms + 3 real names = 15
  b.aliasPair(long, gb1, '知夏', '夏姐')
  b.aliasPair(long, ow1, '夏夏', '林老师')
  b.aliasPair(long, bd1, 'Linda', '林姐')
  b.aliasPair(long, gb2, '小林', '林班长')
  b.realName(long, pl1, '林知夏')
  b.realName(long, gb1, 'Linda Lin')
  b.realName(long, ow1, '林夏')
  const [rA, rB, rC, rD, rE] = pool.slice(0, 5)
  b.relation(self, long, { type: 'classmate', label: '大学同学' }, pl1)
  b.relation(long, rA, { type: 'spouse', label: '老公' }, pl1)
  b.relation(long, rB, { type: 'parent', label: '妈妈' }, pl2)
  b.relation(long, rC, { type: 'child', label: '女儿' }, pl2)
  b.relation(long, rD, { type: 'colleague', label: '同事' }, gb2)
  b.relation(long, rE, { type: 'friend', label: '好朋友' }, gb1)
  b.relation(long, longLabel, { type: 'classmate', label: '大学同学' }, bd1)
  b.relation(long, heavy, { type: 'relative', label: '表姐' }, reviewMixed, 'proposed')
  b.event([long, self], EVENT_KINDS[0], pl1, '2025-10')
  b.event([long, rA, rC], EVENT_KINDS[1], pl2, '2026-02')
  b.event([long, longLabel, alice], EVENT_KINDS[2], bd1, '2026-04-12')
  b.event([long, rD], EVENT_KINDS[3], gb2, '2026-05')
  b.event([long, self, rE], EVENT_KINDS[4], gb1, '2025-07-20')
  b.event([long, heavy, reviewNew], EVENT_KINDS[6], reviewMixed, '2026-09', 'proposed')
  const soonAnniv = addDays(o.today, 20)
  b.date(long, { kind: 'birthday', calendar: 'lunar', month: 3, day: 12, year: 1991 }, pl1)
  b.date(long, { kind: 'anniversary', calendar: 'solar', month: soonAnniv.m, day: soonAnniv.d, year: 2019 }, pl2)
  b.date(long, { kind: 'memorial', calendar: 'solar', month: 11, day: 2, label: '外婆的忌日' }, pl1)
  b.date(long, { kind: 'other', calendar: 'solar', month: 6, day: 1, year: 2021, label: '入职纪念日' }, gb2)
  b.date(long, { kind: 'other', calendar: 'solar', month: 4, day: 18, label: '搬家纪念日' }, reviewMixed, 'proposed')
  b.addressTerm(history, hi1, '老曾')

  // ---- sparse-profile: exactly one claim ----
  confirmedClaim(sparse, [ow1], { category: 'work' })

  // ---- proposed-heavy: 10 proposed + 8 confirmed ----
  for (let i = 0; i < 10; i++) b.claim(heavy, b.claimText(heavy, { category: CATEGORIES[i % CATEGORIES.length] }), { seg: reviewMixed, status: 'proposed', confidence: i % 2 ? 0.66 : 0.9 })
  for (let i = 0; i < 8; i++) confirmedClaim(heavy, [hv1, gb1, gb2])
  b.relation(self, heavy, { type: 'colleague', label: '前同事' }, hv1)

  // ---- with-history: superseded chains, outdated, edited ----
  const chain = (cat: Category, n: number) => {
    const rows = Array.from({ length: n }, () => b.claim(history, b.claimText(history, { category: cat, chainable: true }), { seg: hi1, status: 'confirmed' }))
    for (let i = 0; i < rows.length - 1; i++) b.supersede(rows[i], rows[i + 1], 'superseded')
    return rows
  }
  chain('work', 3)
  chain('location', 2)
  chain('education', 2)
  for (let i = 0; i < 2; i++) b.outdated(confirmedClaim(history, [hi1], { category: i ? 'preference' : 'other' }), 30 + i * 10)
  const editedOld = confirmedClaim(history, [hi1], { category: 'family' })
  const editedNew = b.claim(history, { ...b.claimText(history, { category: 'family' }) }, { seg: hi1, status: 'confirmed' })
  b.supersede(editedOld, editedNew, 'edited')
  refs.claims['history-edited'] = { id: editedOld.id!, personId: history.id, statement: editedOld.statement }
  for (let i = 0; i < 6; i++) confirmedClaim(history, [hi1])
  b.date(history, { kind: 'birthday', calendar: 'solar', month: 2, day: 29, year: 1992 }, hi1)

  // ---- lunar-birthday-soon, leap-month, long-label ----
  for (let i = 0; i < 9; i++) confirmedClaim(lunarSoon, [ow1])
  for (let i = 0; i < 3; i++) b.claim(lunarSoon, b.claimText(lunarSoon), { seg: inProgress, status: 'proposed' })
  let k = 12
  let lunar = Solar.fromYmd(addDays(o.today, k).y, addDays(o.today, k).m, addDays(o.today, k).d).getLunar()
  while (lunar.getMonth() < 0 || lunar.getDay() === 30) {
    k++
    const d = addDays(o.today, k)
    lunar = Solar.fromYmd(d.y, d.m, d.d).getLunar()
  }
  b.date(lunarSoon, { kind: 'birthday', calendar: 'lunar', month: lunar.getMonth(), day: lunar.getDay(), year: 1985 }, ow1)
  for (let i = 0; i < 10; i++) confirmedClaim(leap, [gb1, gb2])
  let leapYear = 1987
  while (LunarYear.fromYear(leapYear).getLeapMonth() === 0) leapYear++
  b.date(leap, { kind: 'birthday', calendar: 'lunar', month: LunarYear.fromYear(leapYear).getLeapMonth(), day: 18, year: leapYear, isLeap: true }, gb2)
  for (let i = 0; i < 5; i++) confirmedClaim(longLabel, [bd1])

  // ---- delete-me: 3 proposed + 2 confirmed, only its own messages ----
  for (let i = 0; i < 3; i++) b.claim(deleteMe, b.claimText(deleteMe), { seg: delSeg, status: 'proposed' })
  for (let i = 0; i < 2; i++) b.claim(deleteMe, b.claimText(deleteMe), { seg: delSeg, status: 'confirmed' })
  b.filler(delSeg, 40 - delSeg.drafts.length)

  // ---- review-mixed extras: new person, changes, aliases, dates, events ----
  for (let i = 0; i < 6; i++) b.claim(reviewNew, b.claimText(reviewNew, { category: CATEGORIES[i] }), { seg: reviewMixed, status: 'proposed', confidence: i < 3 ? 0.88 : 0.58 })
  b.aliasPair(reviewNew, reviewMixed, '遥遥', '贺老师', 'proposed')
  b.relation(reviewNew, leap, { type: 'relative', label: '表妹' }, reviewMixed, 'proposed')
  b.date(reviewNew, { kind: 'birthday', calendar: 'solar', month: 12, day: 3 }, reviewMixed, 'proposed')

  // ---- regular persons + specials: fill up to exactly 5000 claims ----
  const TARGET = 5000
  const filler = [...regular, ...specials, alice]
  const weights = filler.map(() => 0.3 + r.next() * 1.4)
  const remaining = TARGET - b.t.claims.length
  const wsum = weights.reduce((a, w) => a + w, 0)
  const budget = weights.map((w) => Math.max(1, Math.floor((w / wsum) * remaining)))
  let diff = remaining - budget.reduce((a, n) => a + n, 0)
  for (let i = 0; diff !== 0; i = (i + 1) % budget.length) {
    if (diff > 0) {
      budget[i]++
      diff--
    } else if (budget[i] > 1) {
      budget[i]--
      diff++
    }
  }
  const changeCandidates: ClaimRow[] = []
  filler.forEach((p, idx) => {
    let made = 0
    const k2 = budget[idx]
    while (made < k2) {
      const x = r.next()
      if (x < 0.02) {
        b.claim(p, b.claimText(p), { seg: null, status: 'confirmed', manual: true })
        made++
      } else if (x < 0.065 && k2 - made >= 2) {
        const segs = byCreated(doneFor(p))
        const cat = r.pick(['work', 'location', 'education'] as const)
        const oldRow = b.claim(p, b.claimText(p, { category: cat, chainable: true }), { seg: segs[0], status: 'confirmed' })
        const newRow = b.claim(p, b.claimText(p, { category: cat, chainable: true }), { seg: segs[segs.length - 1], status: 'confirmed' })
        b.supersede(oldRow, newRow, 'superseded')
        made += 2
      } else if (x < 0.095) {
        b.claim(p, b.claimText(p), { seg: r.pick(doneFor(p)), status: 'rejected' })
        made++
      } else if (x < 0.28) {
        const s = reviewFor(p)
        // reviewing imports are partly handled (35% accepted); extracting ones are all still proposed
        b.claim(p, b.claimText(p), { seg: s, status: s.status === 'reviewing' && r.chance(0.35) ? 'confirmed' : 'proposed' })
        made++
      } else {
        const row = confirmedClaim(p, doneFor(p), { sensitive: r.chance(0.05) })
        if (p.chats.includes(groupBig) && ['work', 'location'].includes(row.category) && !row.sensitive) changeCandidates.push(row)
        made++
      }
    }
  })
  // "变化": proposed claims in review-mixed replacing existing confirmed ones — they count toward 5000, so swap out plain confirmed claims
  const changes = r.sample(changeCandidates, 8)
  changes.forEach((oldRow, i) => {
    const p = b.persons.find((x) => x.id === oldRow.personId)!
    const replacement = b.claim(p, b.claimText(p, { category: oldRow.category as Category, chainable: true }), { seg: reviewMixed, status: 'proposed', confidence: i % 2 ? 0.72 : 0.94 })
    replacement.supersedesClaimId = oldRow.id
    if (i === 0) refs.claims['review-change'] = { id: replacement.id!, personId: p.id, statement: replacement.statement }
  })
  // keep the total exact: drop the same number of plain manual/confirmed claims without evidence dependents (manual ones)
  let over = b.t.claims.length - TARGET
  for (let i = b.t.claims.length - 1; i >= 0 && over > 0; i--) {
    const c = b.t.claims[i]
    if (c.sourceKind === 'manual' && c.personId !== long.id) {
      b.t.claims.splice(i, 1)
      b.t.claimMentions = b.t.claimMentions.filter((m) => m.claimId !== c.id)
      over--
    }
  }
  const sensitive = b.t.claims.find((c) => c.sensitive)
  if (sensitive) refs.claims.sensitive = { id: sensitive.id!, personId: sensitive.personId, statement: sensitive.statement }

  // ---- aliases, relations, events, dates for regular persons ----
  const gbRegular = gbMembers.filter((p) => regular.includes(p))
  for (const p of r.sample(gbRegular, 40)) b.aliasPair(p, r.pick([gb1, gb2, reviewMixed]), `${p.label.slice(-1)}${p.label.slice(-1)}`, `${p.label.slice(0, 1)}${r.pick(ADDRESS_SUFFIXES)}`)
  for (const p of r.sample(owMembers.filter((x) => regular.includes(x)), 20)) b.aliasPair(p, ow1, `${p.label.slice(0, 1)}老板`, `${p.label.slice(-1)}哥`)
  for (const p of r.sample(regular, 20)) b.realName(p, r.pick([pl1, pl2, hi1, hv1]), `${p.label}${r.pick(['', '（曾用名）'])}`.replace('（曾用名）', r.pick(['文', '明', '华'])))
  for (const p of r.sample(filler, 70)) {
    const s = r.pick(doneFor(p))
    b.relation(self, p, r.pick(RELATION_KINDS.filter((k3) => !['spouse', 'parent', 'child'].includes(k3.type))), s, r.chance(0.04) ? 'rejected' : undefined)
  }
  for (let i = 0; i < 40; i++) {
    const [a1, a2] = r.sample(filler, 2)
    const s = r.chance(0.15) ? reviewMixed : r.pick(doneFor(a1))
    b.relation(a1, a2, r.pick(RELATION_KINDS), s)
  }
  for (let i = 0; i < 110; i++) {
    const s = r.chance(0.1) ? reviewMixed : r.pick(doneSegs)
    const members = s.chat!.members.filter((m) => !m.isSelf)
    const ps = r.sample(members.length >= 2 ? members : filler, r.int(1, 3))
    if (r.chance(0.4)) ps.push(self)
    const d = addDays(o.today, -s.fromDay + r.int(0, Math.max(0, s.fromDay - s.toDay)))
    b.event(ps, r.pick(EVENT_KINDS), s, r.chance(0.5) ? `${d.y}-${pad(d.m)}` : `${d.y}-${pad(d.m)}-${pad(d.d)}`)
  }
  const soonOffsets = [0, 1, 3, 6, 9, 14, 19, 23, 28]
  const datePeople = r.sample(filler, 95)
  datePeople.forEach((p, i) => {
    const s = r.pick(doneFor(p))
    if (i < soonOffsets.length) {
      const d = addDays(o.today, soonOffsets[i])
      b.date(p, { kind: i === 4 ? 'anniversary' : 'birthday', calendar: 'solar', month: d.m, day: d.d, year: 1980 + r.int(0, 20) }, s)
    } else if (i < soonOffsets.length + 15) {
      b.date(p, { kind: 'birthday', calendar: 'lunar', month: r.int(1, 12), day: r.int(1, 29), year: 1970 + r.int(0, 30) }, s)
    } else if (i < soonOffsets.length + 25) {
      b.date(p, { kind: 'anniversary', calendar: 'solar', month: r.int(1, 12), day: r.int(1, 28), year: 2010 + r.int(0, 15) }, s)
    } else {
      b.date(p, { kind: 'birthday', calendar: 'solar', month: r.int(1, 12), day: r.int(1, 28), year: r.chance(0.7) ? 1965 + r.int(0, 40) : undefined }, s)
    }
  })

  // ---- conversational filler across segments ----
  const fillerPlan: [S, number][] = [[gb1, 70], [gb2, 55], [reviewMixed, 35], [ow1, 55], [reviewEmpty, 25], [bd1, 45], [pl1, 55], [pl2, 45], [hi1, 35], [hv1, 35], [inProgress, 220], [failedWin, 150]]
  for (const [s, n] of fillerPlan) b.filler(s, n)

  b.finalize({ ownerId: owner, selfDisplayNames: ['我是小丽'], extractModel: null, highConfidenceThreshold: 0.8, onboardedAt: b.iso(520), updatedAt: b.iso(520) }, 10)

  return { tables: b.t, r2: b.r2, refs, counts: countTables(b.t) }
}

/** `seed2@xiaoli.test`: 10 persons whose labels overlap seed's, 1 chat, 1 import (isolation checks). */
export function buildIsolationAccount(owner: string, ids: IdAllocator, o: BuildOptions): AccountDataset {
  const b = new Builder(owner, ids, o.today, o.now, '隔离测试', (o.seed ?? SEED_RNG) + 2)
  const r = b.r
  const refs: AccountDataset['refs'] = { persons: {}, imports: {}, chats: {}, claims: {} }
  const self = b.person('我', { isSelf: true, createdDay: 100 })
  const overlap = generateChineseLabels(createRng((o.seed ?? SEED_RNG) + 1), 181, [...Object.values(TAGGED_LABELS), ...SPECIAL_LABELS]).slice(0, 9)
  const people = [b.person(TAGGED_LABELS.longProfile), ...overlap.map((l) => b.person(l))]
  const importId = ids.next('imports')
  const chat = b.chat('同学群', 'group', [self, ...people], importId, 90)
  const seg = b.seg({ id: importId, chat, status: 'done', fromDay: 90, toDay: 30, createdDay: 29 })
  for (const p of people) for (let i = 0; i < 3; i++) b.claim(p, b.claimText(p), { seg, status: 'confirmed' })
  b.relation(self, people[0], { type: 'friend', label: '老朋友' }, seg)
  b.filler(seg, 40)
  b.finalize({ ownerId: owner, selfDisplayNames: ['隔离测试'], extractModel: null, highConfidenceThreshold: 0.8, onboardedAt: b.iso(100), updatedAt: b.iso(100) }, 0)
  refs.persons['overlap-long-profile'] = { id: people[0].id, label: people[0].label }
  refs.chats.group = { id: chat.id, title: chat.title }
  refs.imports.done = { id: seg.id, title: chat.title }
  void r
  return { tables: b.t, r2: b.r2, refs, counts: countTables(b.t) }
}

export function countTables(t: SeedTables): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const k of INSERT_ORDER) counts[k] = t[k].length
  counts.visiblePersons = t.persons.filter((p) => !p.isSelf && p.mergedIntoId == null).length
  return counts
}
