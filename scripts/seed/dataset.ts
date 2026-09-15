// In-memory synthetic dataset for the seed accounts (ARCHITECTURE §9). Pure apart from node:crypto hashing.
// Rows carry final ids from an IdAllocator (bases = current max id + gap), so FK references are resolved before insert.
// Every person has a persona (persona.ts): claims, relations, events and dates derive from it, so a profile reads as one life.
import { createHash } from 'node:crypto'
import { LunarYear, Solar } from 'lunar-typescript'
import type { Category, ChatKind, HandleKind, ImportStats, ImportStatus, MessageKind, MessageMeta, Status, TargetType } from '@/contracts'
import { lunarLabel } from '@/lib/lunar'
import { sortKey } from '@/lib/pinyin'
import type * as schema from '@/server/db/schema'
import type { ManifestRef } from './manifest'
import { EVENT_KINDS, REJECTED_CLAIMS, SENSITIVE_CLAIMS, makeFiller, type EventKind, type FillerMessage } from './content'
import { SPECIAL_LABELS, TAGGED_LABELS, generateChineseLabels, givenName, nameEra, nameGender, surnameOf } from './names'
import { Clock, addressTermFor, changeFactFor, factsOf, jobPhrase, makePersona, type Chain, type Fact, type Gender, type Job, type Persona, type PersonaSpec, type School, type YM } from './persona'
import { tinyPng } from './png'
import { fingerprint } from '@/lib/wechat-export'
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

/** Parser contract §1.2 (wechat-export@2): the seed uses the parser's own fingerprint, never a copy. */
export { fingerprint }

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
  gender: Gender
  row: Ins<typeof schema.persons>
  /** fact keys (`W.job`) and statements (`s:…`) already claimed */
  used: Set<string>
  chats: C[]
  persona?: Persona
  facts: Fact[]
  chains: Chain[]
  /** other person id → how this person names them ("妈妈": the other one is my mother) */
  rel: Map<number, string>
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
type Window = [number, number]
/** What a claim needs to be said in chat and stored. */
export interface ClaimInput {
  key?: string
  category: Category
  statement: string
  first: string
  third: string
  validFrom?: string
  validTo?: string
  window?: Window
  mentionIds?: number[]
  q?: string
}

const KIN = new Set(['妈妈', '爸爸', '女儿', '儿子', '老公', '老婆', '姐姐', '哥哥', '妹妹', '弟弟', '表姐', '表妹', '表哥', '表弟', '堂姐', '堂妹', '堂哥', '堂弟'])
const SERVICE = new Set(['装修师傅', '理发师', '客户'])

export function relationType(label: string): string {
  if (label === '妈妈' || label === '爸爸') return 'parent'
  if (label === '女儿' || label === '儿子') return 'child'
  if (label === '老公' || label === '老婆') return 'spouse'
  if (['姐姐', '哥哥', '妹妹', '弟弟'].includes(label)) return 'sibling'
  if (/^[表堂]/.test(label)) return 'relative'
  if (label.includes('同学')) return 'classmate'
  if (label.includes('同事')) return 'colleague'
  if (label === '装修师傅' || label === '理发师') return 'service_provider'
  if (label === '客户') return 'client'
  if (label === '邻居') return 'other'
  return 'friend'
}

class Builder {
  readonly t = emptyTables()
  readonly r: Rng
  readonly clk: Clock
  readonly wallToday: number
  order = 0
  readonly persons: P[] = []
  readonly byLabel = new Map<string, P>()
  readonly byId = new Map<number, P>()
  readonly chats: C[] = []
  readonly segs: S[] = []
  readonly evRefs: EvRef[] = []
  readonly handleKeys = new Set<string>()
  readonly r2: R2Put[] = []
  /** `${chatTitle}|${personId}` → fixed group display name */
  readonly nicks = new Map<string, string>()
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
    this.clk = new Clock(today)
    const [y, m, d] = today.split('-').map(Number)
    this.wallToday = Date.UTC(y, m - 1, d)
  }

  iso(daysAgo: number, extraMs = 0): string {
    return new Date(Math.min(this.now.getTime(), this.now.getTime() - daysAgo * DAY + extraMs)).toISOString()
  }

  person(label: string, o: { isSelf?: boolean; pinned?: boolean; importId?: number; mergedIntoId?: number; createdDay?: number; gender?: Gender } = {}): P {
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
    const gender = o.gender ?? nameGender(label) ?? (this.r.chance(0.5) ? 'f' : 'm')
    const p: P = { id, label, isSelf: Boolean(o.isSelf), gender, row, used: new Set(), chats: [], facts: [], chains: [], rel: new Map() }
    if (o.mergedIntoId === undefined) {
      this.persons.push(p)
      this.byLabel.set(label, p)
      this.byId.set(id, p)
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
    let name = p.isSelf ? this.selfName : c.kind === 'private' ? p.label : this.groupNick(c, p)
    const namesInUse = new Set([...c.display.values()].map((v) => v.name))
    if (namesInUse.has(name)) name = p.label
    const handleId = this.handle(p, c.kind === 'private' ? 'display_private' : 'display_group', name, c.id, importId, 'confirmed', 'manual', createdDay)
    if (handleId === null) throw new Error(`duplicate display handle ${name} in chat ${c.title}`)
    c.display.set(p.id, { handleId, name })
    c.members.push(p)
    p.chats.push(c)
  }

  groupNick(c: C, p: P): string {
    const fixed = this.nicks.get(`${c.title}|${p.id}`)
    if (fixed) return fixed
    if (/^\p{Script=Han}{3}$/u.test(p.label) && this.r.chance(0.25)) return this.r.chance(0.5) ? p.label.slice(1) : `阿${p.label.slice(-1)}`
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

  /** day range (older, newer — days ago) where a message in `s` also satisfies `w` */
  dayRange(s: S, w?: Window): Window | null {
    const older = Math.min(s.fromDay, w ? w[0] : Number.POSITIVE_INFINITY)
    const newer = Math.max(s.toDay, w ? w[1] : 0)
    return older >= newer ? [older, newer] : null
  }
  fits(s: S, w?: Window): boolean {
    return s.chat !== null && this.dayRange(s, w) !== null
  }
  timeIn(s: S, w?: Window): number {
    const rg = this.dayRange(s, w)
    if (!rg) throw new Error(`no time in import ${s.tag ?? s.id} for window ${w}`)
    const day = this.r.int(rg[1], rg[0])
    return this.wallToday - day * DAY + (8 * 60 + this.r.int(0, 15 * 60 + 29)) * 60_000
  }
  randT(s: S): number {
    return this.timeIn(s)
  }

  nameIn(c: C, p: P): string {
    return c.display.get(p.id)?.name ?? p.label
  }

  /** How `speaker` refers to `subject` in chat `c`. */
  refName(c: C, speaker: P, subject: P): string {
    if (c.display.has(subject.id)) return this.nameIn(c, subject)
    const l = speaker.rel.get(subject.id)
    if (l && KIN.has(l)) return `我${l}`
    if (l && !SERVICE.has(l)) return `我${l}${subject.label}`
    return subject.label
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

  /**
   * Who says a fact about `subject` in `s`: the subject (always in their private chat), otherwise someone who knows them
   * (a relation in the chat), otherwise self. Persons the fact mentions never say it, and kin never state family facts.
   */
  speakerFor(s: S, subject: P, fact: Pick<ClaimInput, 'mentionIds' | 'category' | 'key'>): { speaker: P; first: boolean } {
    const c = s.chat!
    const member = c.display.has(subject.id)
    if (member && (c.kind === 'private' || this.r.chance(0.8))) return { speaker: subject, first: true }
    const banned = new Set(fact.mentionIds ?? [])
    const familyFact = fact.category === 'family' || Boolean(fact.key?.startsWith('LE.kid')) || fact.key === 'LE.marry'
    const ok = (m: P) => m.id !== subject.id && !banned.has(m.id) && !(familyFact && KIN.has(subject.rel.get(m.id) ?? ''))
    const knowers = c.members.filter((m) => !m.isSelf && ok(m) && subject.rel.has(m.id))
    if (knowers.length) return { speaker: this.r.pick(knowers), first: false }
    if (ok(this.self)) return { speaker: this.self, first: false }
    const others = c.members.filter(ok)
    return { speaker: others.length ? this.r.pick(others) : this.self, first: false }
  }

  speak(s: S, subject: P, fact: ClaimInput): Draft {
    const { speaker, first } = this.speakerFor(s, subject, fact)
    const t = this.timeIn(s, fact.window)
    if (first && s.chat!.kind === 'private' && fact.q && this.r.chance(0.35)) {
      this.say(s, this.self, fact.q, { t: t - this.r.int(1, 20) * 60_000 })
    }
    const body = first
      ? fact.first
      : fact.third.replace(/\{name\}(.?)/gu, (_m, next: string) => {
          const n = this.refName(s.chat!, speaker, subject)
          return n + (/[A-Za-z]$/.test(n) && /[A-Za-z0-9]/.test(next) ? ' ' : '') + next
        })
    return this.say(s, speaker, body, { t })
  }

  evidence(targetType: TargetType, targetId: number, fact: Draft, extra?: number): void {
    const x = this.r.next()
    this.evRefs.push({ targetType, targetId, fact, extra: extra ?? (x < 0.6 ? 0 : x < 0.9 ? 1 : 2) })
  }

  claim(subject: P, fact: ClaimInput, o: { seg: S | null; status: Status; manual?: boolean; sensitive?: boolean; confidence?: number }): ClaimRow {
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
      statement: fact.statement,
      statementNorm: norm(fact.statement),
      category: fact.category,
      validFrom: fact.validFrom ?? null,
      validTo: fact.validTo ?? null,
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
    if (fact.key) subject.used.add(fact.key)
    subject.used.add(`s:${fact.statement}`)
    if (s) {
      const said = this.speak(s, subject, fact)
      this.evidence('claim', id, said)
      s.items++
    }
    for (const m of new Set(fact.mentionIds ?? [])) {
      if (m !== subject.id && this.byId.has(m)) this.t.claimMentions.push({ ownerId: this.owner, createdAt: at, claimId: id, personId: m })
    }
    this.t.claims.push(row)
    return row
  }

  supersede(oldRow: ClaimRow, newRow: ClaimRow, reason: 'superseded' | 'edited'): void {
    // the replacement is never learned before the claim it replaces (same import: minutes can be out of order)
    if (newRow.createdAt! < oldRow.createdAt!) newRow.createdAt = newRow.updatedAt = newRow.learnedAt = newRow.statusChangedAt = oldRow.createdAt
    const changed = newRow.createdAt!
    oldRow.status = 'superseded'
    oldRow.statusReason = reason
    oldRow.supersededByClaimId = newRow.id
    oldRow.statusChangedAt = changed
    oldRow.updatedAt = changed
    if (reason === 'superseded' && newRow.validFrom && !oldRow.validTo) oldRow.validTo = newRow.validFrom
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

  /** Chat line in which `x` says that `y` is their `label`. */
  relationBody(c: C, x: P, y: P, label: string, name: string): string {
    const partner = c.kind === 'private' && c.display.has(y.id)
    switch (relationType(label)) {
      case 'spouse':
        return `我${label}${name}今天加班，晚饭我自己解决`
      case 'parent':
        return `我${label}${name}下周来看我们`
      case 'child':
        return y.persona?.stage === 'child' ? `我${label}${name}这学期当上了小组长` : `我${label}${name}周末回家吃饭`
      case 'sibling':
        return `我${label}${name}过年回来`
      case 'relative':
        return `我${label}${name}说周末一起吃饭`
      case 'classmate':
        return partner ? '咱俩大学四年同学，这点小事还客气啥' : label === '大学同学' ? `我跟${name}大学四年都是一个班的` : `${name}是我${label}`
      case 'colleague':
        return partner ? (label === '前同事' ? '咱俩以前是一个部门的同事' : '咱俩一个组的，明天会上见') : label === '前同事' ? `${name}是我以前公司的同事` : `${name}是我同事，就坐我对面`
      case 'service_provider':
        return label === '理发师' ? `我一直在${name}那儿剪头发` : `我家装修就是找的${name}，手艺很好`
      case 'other':
        return `我跟${name}是对门邻居`
      default:
        if (label === '球友') return partner ? '咱俩打球认识也快一年了' : `${name}是我在球馆认识的球友`
        return partner ? '咱俩认识这么多年的老朋友了' : `${name}是我认识十几年的${label}`
    }
  }

  /** `y` is `x`'s `label`. Stored as from = y, to = x (DECISIONS I2); both persons remember the relation. */
  relation(x: P, y: P, label: string, s: S, status?: Status): Ins<typeof schema.relations> {
    const id = this.ids.next('relations')
    const at = this.iso(s.createdDay, 2 * 60_000)
    const c = s.chat!
    const nm = (p: P) => (c.display.has(p.id) ? this.nameIn(c, p) : p.label)
    const speaker = c.display.has(x.id) ? x : this.self
    const body = speaker.id === x.id ? this.relationBody(c, x, y, label, nm(y)) : `${nm(y)}是${nm(x)}的${label}`
    const fact = this.say(s, speaker, body)
    const type = relationType(label)
    const row: Ins<typeof schema.relations> = { id, ownerId: this.owner, createdAt: at, updatedAt: at, fromPersonId: y.id, toPersonId: x.id, type, label, status: status ?? this.statusFor(s), importId: s.id, sourceKind: 'ai' }
    this.t.relations.push(row)
    this.evidence('relation', id, fact, 0)
    s.items++
    if (row.status !== 'rejected') {
      x.rel.set(y.id, label)
      y.rel.set(x.id, inverseLabel(label, x, y))
    }
    return row
  }

  /** An outing: the message that mentions it is sent 1–45 days after it happened. */
  event(participants: P[], kind: EventKind, s: S, when: { y: number; m: number; d?: number }, status?: Status): boolean {
    const c = s.chat!
    const happened = when.d ? this.clk.ago(when.y, when.m, when.d) : this.clk.endAgo({ y: when.y, m: when.m })
    const w: Window = [Math.max(0, happened - 1), Math.max(0, happened - 45)]
    if (happened < 1 || !this.fits(s, w)) return false
    const speaker = participants.find((p) => !p.isSelf && c.display.has(p.id)) ?? this.self
    const others = participants.filter((p) => p.id !== speaker.id)
    if (!others.length) return false
    const names = others.map((p) => (p.isSelf ? (c.kind === 'private' ? '你' : '小丽') : this.refName(c, speaker, p)))
    const who = `和${names.join('、')}`
    const body = this.r.pick([`上次${who}${kind.phrase}，太开心了`, `前阵子${who}${kind.phrase}，照片我整理好发出来`, `${who}${kind.phrase}那天天气真好`])
    const fact = this.say(s, speaker, body, { t: this.timeIn(s, w) })
    const id = this.ids.next('events')
    const at = this.iso(s.createdDay, 3 * 60_000)
    const happenedAt = when.d ? `${when.y}-${pad(when.m)}-${pad(when.d)}` : `${when.y}-${pad(when.m)}`
    this.t.events.push({ id, ownerId: this.owner, createdAt: at, updatedAt: at, summary: `一起${kind.phrase}`, happenedAt, place: kind.place, status: status ?? this.statusFor(s), importId: s.id, sourceKind: 'ai' })
    const seen = new Set<number>()
    for (const p of participants) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      this.t.eventParticipants.push({ ownerId: this.owner, createdAt: at, eventId: id, personId: p.id })
    }
    this.evidence('event', id, fact, 0)
    s.items++
    return true
  }

  date(subject: P, d: { kind: string; calendar: 'solar' | 'lunar'; month: number; day: number; year?: number; isLeap?: boolean; label?: string }, s: S, status?: Status): Ins<typeof schema.importantDates> {
    const id = this.ids.next('importantDates')
    const at = this.iso(s.createdDay, 4 * 60_000)
    const when = d.calendar === 'lunar' ? lunarLabel(d.month, d.day, Boolean(d.isLeap)) : `${d.month}月${d.day}号`
    const phrase: ClaimInput =
      d.kind === 'birthday'
        ? d.calendar === 'lunar'
          ? { category: 'other', statement: '', first: `我过农历生日，${when}`, third: `{name}过农历生日，${when}` }
          : { category: 'other', statement: '', first: `我生日是${when}`, third: `{name}生日是${when}` }
        : d.kind === 'anniversary'
          ? { category: 'family', statement: '', first: `${when}是我们结婚纪念日`, third: `${when}是{name}的结婚纪念日` }
          : { category: 'other', statement: '', first: `${when}是${d.label ?? '个重要的日子'}`, third: `{name}说${when}是${d.label ?? '个重要的日子'}` }
    const fact = this.speak(s, subject, phrase)
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
    const fact = this.say(s, this.r.pick(others), `@${mentioned} ${term}，${this.r.pick(['周末来不来？', '照片发我一份', '你到了没？'])}`)
    const st = status ?? this.statusFor(s)
    for (const [kind, value] of [['mentioned', mentioned], ['address_term', term]] as const) {
      const id = this.handle(subject, kind, value, c.id, s.id, st, 'ai', s.createdDay)
      if (id !== null) {
        this.evidence('handle', id, fact, 0)
        s.items++
      }
    }
  }

  realName(subject: P, s: S, value: string, body?: string, status?: Status): void {
    const c = s.chat!
    const fact = this.say(s, this.self, body ?? `${this.nameIn(c, subject)}的大名叫${value}`)
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
  everyKind(s: S, kinds: MessageKind[]): void {
    const c = s.chat!
    for (const kind of kinds) {
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

/** label naming `x` from `y`'s side, given that `y` is `x`'s `label` */
function inverseLabel(label: string, x: P, y: P): string {
  const xf = x.gender === 'f'
  const xOlder = (x.persona?.birthYear ?? 1990) <= (y.persona?.birthYear ?? 1990)
  switch (relationType(label)) {
    case 'parent':
      return xf ? '女儿' : '儿子'
    case 'child':
      return xf ? '妈妈' : '爸爸'
    case 'spouse':
      return xf ? '老婆' : '老公'
    case 'sibling':
      return xOlder ? (xf ? '姐姐' : '哥哥') : xf ? '妹妹' : '弟弟'
    case 'relative':
      return `${label[0]}${xOlder ? (xf ? '姐' : '哥') : xf ? '妹' : '弟'}`
    case 'service_provider':
      return '客户'
    default:
      return label
  }
}

export interface BuildOptions {
  today: string
  now: Date
  seed?: number
}

const COLLEGE: School = { name: '长沙师范大学', city: '长沙' }
const SELF_COMPANY = '一家做软件的创业公司'
const SPOUSE_JOBS = ['在一家银行上班', '在医院当护士', '在中学教书', '在一家公司做销售', '在国企上班', '在一家设计公司上班', '自己做点小生意']
const SPECIAL_GENDER: Record<string, Gender> = { 'Nora Chen': 'f', 'Ivy Zhang': 'f', 'Uma Patel': 'f', 'Vivian Ho': 'f', 'Kevin Wu': 'm', 'Oscar Li': 'm', Emma: 'f', '8楼邻居刘阿姨': 'f', '🐱 橘子妈妈': 'f', '3号技师小吴': 'm' }
const SPECIAL_REAL_NAMES: Record<string, string> = { 'Ivy Zhang': '张艾薇', 'Kevin Wu': '吴凯', 'Oscar Li': '李奥', Emma: '冯恩美', '🐱 橘子妈妈': '陈佳琪', '8楼邻居刘阿姨': '刘桂芬', '3号技师小吴': '吴小龙', 'Vivian Ho': '何薇薇' }

/** A married couple shares a pet and a car; nobody in a cat household is allergic to cats. */
function shareHousehold(a: Persona, b: Persona): void {
  b.pet = a.pet
  const car = a.car ?? b.car
  for (const x of [a, b]) {
    x.car = car
    if (car && !x.license) x.license = Math.min(x.birthYear + 22, 2024)
    if (x.secondary === 'car') x.secondary = undefined
    if (x.skill === '开车' && car) x.skill = undefined
    if (x.pet?.kind === '猫' && x.allergy === '猫毛') x.allergy = undefined
  }
}

const hand = (key: string, category: Category, statement: string, first: string, o: Partial<ClaimInput> = {}): ClaimInput => ({ key, category, statement, first, third: `{name}${statement}`, ...o })

/** The full `seed@xiaoli.test` dataset. */
export function buildMainAccount(owner: string, ids: IdAllocator, o: BuildOptions): AccountDataset {
  const b = new Builder(owner, ids, o.today, o.now, '我是小丽', o.seed ?? SEED_RNG)
  const r = b.r
  const clk = b.clk
  const T = TAGGED_LABELS
  const refs: AccountDataset['refs'] = { persons: {}, imports: {}, chats: {}, claims: {} }
  const tagP = (tag: string, p: P) => (refs.persons[tag] = { id: p.id, label: p.label })

  // import ids needed before persons created by those imports
  const reviewMixedId = ids.next('imports')
  const deleteMeId = ids.next('imports')

  // ---- persons ----
  const self = b.person('我', { isSelf: true, createdDay: 520, gender: 'f' })
  const long = b.person(T.longProfile, { pinned: true, gender: 'f' })
  const sparse = b.person(T.sparseProfile, { gender: 'm' })
  const heavy = b.person(T.proposedHeavy, { pinned: true, gender: 'f' })
  const history = b.person(T.withHistory, { pinned: true, gender: 'm' })
  const lunarSoon = b.person(T.lunarBirthdaySoon, { pinned: true, gender: 'f' })
  const leap = b.person(T.leapMonth, { gender: 'f' })
  const longLabel = b.person(T.longLabel, { gender: 'f' })
  const alice = b.person(T.privateLatin, { gender: 'f' })
  const specials = SPECIAL_LABELS.filter((l) => l !== T.privateLatin).map((l) => b.person(l, { gender: SPECIAL_GENDER[l] }))
  const special = (label: string) => specials.find((p) => p.label === label)!
  const reserved = [...Object.values(T), ...SPECIAL_LABELS]
  const regularLabels = generateChineseLabels(createRng((o.seed ?? SEED_RNG) + 1), 181, reserved)
  const regular = regularLabels.map((l, i) => b.person(l, { pinned: i < 8 }))
  const deleteMe = b.person(T.deleteMe, { importId: deleteMeId, createdDay: 19, gender: 'f' })
  const reviewNew = b.person(T.reviewNew, { importId: reviewMixedId, createdDay: 3, gender: 'f' })
  // merged (hidden) persons: an earlier nickname entry of the same person
  b.person('知夏', { mergedIntoId: long.id, createdDay: 300 })
  b.person(regular[0].label.slice(1), { mergedIntoId: regular[0].id, createdDay: 250 })
  b.person('Kevin', { mergedIntoId: special('Kevin Wu').id, createdDay: 200 })

  for (const [tag, p] of [['long-profile', long], ['sparse-profile', sparse], ['proposed-heavy', heavy], ['with-history', history], ['lunar-birthday-soon', lunarSoon], ['leap-month', leap], ['long-label', longLabel], ['delete-me-person', deleteMe], ['review-new-person', reviewNew], ['private-alice', alice], ['self', self]] as const) tagP(tag, p)

  // ---- chat membership by name cohort: classmates are born ~1991, neighbours and parents skew older ----
  const shuffled = r.shuffle([...regular])
  const pool = { mid: shuffled.filter((p) => nameEra(p.label) === 'mid'), mid70: shuffled.filter((p) => nameEra(p.label) === 'mid70'), old: shuffled.filter((p) => nameEra(p.label) === 'old'), young: shuffled.filter((p) => nameEra(p.label) === 'young') }
  const inChat = new Set<P>()
  const takeN = (lists: P[][], n: number, taken: Set<P>, pred: (p: P) => boolean = () => true): P[] => {
    const out: P[] = []
    for (const list of lists)
      for (const p of list) {
        if (out.length >= n) return out
        if (!taken.has(p) && pred(p)) {
          out.push(p)
          taken.add(p)
        }
      }
    return out
  }
  const gbReg = takeN([pool.mid, pool.mid70], 60, inChat)
  const owOverlap = gbReg.slice(50, 60)
  const owOthers = [...takeN([pool.old], 12, inChat), ...takeN([pool.mid70, pool.mid], 8, inChat), ...takeN([pool.mid, pool.mid70], 8, inChat)]
  const owReg = [...owOverlap, ...owOthers]
  const bdReg = [...owOthers.filter((p) => nameEra(p.label) !== 'old').slice(0, 5), ...takeN([pool.mid, pool.mid70], 8, inChat)]

  const gbMembers = [self, long, leap, heavy, ...gbReg, ...['Ivy Zhang', 'Emma', '🐱 橘子妈妈'].map(special)]
  const owMembers = [self, long, sparse, lunarSoon, ...owReg, special('8楼邻居刘阿姨')]
  const bdMembers = [self, long, alice, longLabel, ...bdReg, ...['Kevin Wu', 'Oscar Li', 'Uma Patel'].map(special)]

  b.nicks.set(`大学同学群|${long.id}`, '阿夏')
  b.nicks.set(`小区业主群|${long.id}`, long.label)
  b.nicks.set(`周末羽毛球|${long.id}`, long.label)

  // ---- chats & imports ----
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
  b.everyKind(gb1, ['text', 'sticker_code', 'image', 'video', 'voice', 'transfer', 'red_packet', 'mini_program', 'channels', 'animated_sticker', 'video_call', 'quote', 'recall', 'system', 'file', 'link', 'location', 'contact_card', 'forward', 'unknown'])

  const doneSegs = b.segs.filter((s) => s.status === 'done')
  const privateDone = [pl1, pl2, hi1, hv1]
  const doneOf = (p: P) => p.chats.flatMap((c) => c.segs).filter((s) => s.status === 'done')

  // ---- personas ----
  const persona = (p: P, spec: Omit<PersonaSpec, 'id' | 'label' | 'gender' | 'birthYear'> & { gender?: Gender; birthYear: number }): Persona => {
    p.persona = makePersona(r, clk, { ...spec, id: p.id, label: p.label, gender: spec.gender ?? p.gender })
    p.gender = p.persona.gender
    return p.persona
  }
  const birthFor = (p: P): number => {
    const e = nameEra(p.label)
    return e === 'old' ? r.int(1952, 1964) : e === 'mid70' ? r.int(1970, 1984) : e === 'mid' ? r.int(1986, 2000) : r.int(2004, 2021)
  }
  const genderOk = (p: P, g: Gender) => nameGender(p.label) === g || nameGender(p.label) === null
  const freeOf = (pred: (p: P) => boolean): P | undefined => shuffled.find((p) => !p.persona && !inChat.has(p) && pred(p))
  const mustFree = (pred: (p: P) => boolean, what: string): P => {
    const p = freeOf(pred)
    if (!p) throw new Error(`seed: no free person for ${what}`)
    p.persona = {} as Persona // reserve until the real persona is built
    return p
  }

  persona(self, { birthYear: 1991, school: COLLEGE, major: '中文', city: '杭州', district: '城西', hometown: '长沙', married: false, pastJobs: [{ city: '长沙', company: '一家新媒体公司', role: '内容运营', from: { y: 2013, m: 7 }, to: { y: 2019, m: 3 } }], job: { company: SELF_COMPANY, role: '产品经理', city: '杭州', from: { y: 2019, m: 3 } }, jobChange: null, moveChange: null, since: { y: 2019, m: 3 }, prevHome: { city: '长沙', district: '岳麓', from: { y: 2013, m: 7 } } })

  // long-profile's household and circle, from people in no chat
  const MODERN_GIRL = new Set(['雨桐', '可欣', '诗涵', '若溪', '欣悦', '乐怡', '书瑶', '一诺', '梓涵', '语嫣', '嘉懿', '清妍'])
  const youngDaughter = (p: P, surname?: string) => genderOk(p, 'f') && (nameEra(p.label) === 'young' || MODERN_GIRL.has(givenName(p.label))) && (!surname || surnameOf(p.label) === surname)
  // the daughter first, then a husband who shares her surname (any adult cohort; his birth year is fixed below)
  const adultMan = (p: P) => ['mid', 'mid70'].includes(nameEra(p.label)) && nameGender(p.label) === 'm'
  const daughterWithFather = shuffled.find((q) => !q.persona && !inChat.has(q) && youngDaughter(q) && Boolean(freeOf((p) => adultMan(p) && surnameOf(p.label) === surnameOf(q.label))))
  const rC = mustFree((p) => (daughterWithFather ? p === daughterWithFather : youngDaughter(p)), 'long-profile daughter')
  const rA = mustFree((p) => adultMan(p) && (!daughterWithFather || surnameOf(p.label) === surnameOf(rC.label)), 'long-profile spouse')
  const rB = mustFree((p) => nameEra(p.label) === 'old' && nameGender(p.label) === 'f', 'long-profile mother')
  const rD = mustFree((p) => nameEra(p.label) === 'mid', 'long-profile colleague')
  const rE = gbReg[1]
  const longKids = [{ gender: 'f' as Gender, birthYear: 2021, personId: rC.id }]
  const longP = persona(long, { birthYear: 1991, school: COLLEGE, major: '广播电视编导', city: '杭州', district: '城西', hometown: '苏州', since: { y: 2025, m: 8 }, prevHome: { city: '上海', district: '徐汇', from: { y: 2016, m: 7 } }, pastJobs: [{ city: '长沙', company: '一家影视公司', role: '编导', from: { y: 2013, m: 7 }, to: { y: 2016, m: 7 } }, { city: '上海', company: '一家广告公司', role: '制片', from: { y: 2016, m: 7 }, to: { y: 2025, m: 9 } }], job: { company: '一家动画工作室', role: '制片', city: '杭州', from: { y: 2025, m: 9 } }, married: true, marriedYear: 2019, kids: longKids, jobChange: 'job', moveChange: true, pet: { kind: '猫', name: '年糕', since: 2020 } })
  longP.siblings = []
  const rAP = persona(rA, { gender: 'm', birthYear: 1989, major: '建筑学', field: 'engineering', city: '杭州', district: '城西', hometown: '上海', since: { y: 2025, m: 8 }, prevHome: { city: '上海', district: '徐汇', from: { y: 2016, m: 7 } }, pastJobs: [{ city: '上海', company: '一家建筑设计院', role: '建筑师', from: { y: 2014, m: 7 }, to: { y: 2025, m: 8 } }], job: { company: '一家建筑设计院', role: '建筑师', city: '杭州', from: { y: 2025, m: 8 } }, married: true, marriedYear: 2019, kids: longKids, jobChange: 'job', moveChange: true })
  rAP.spouse!.personId = long.id
  rAP.spouse!.how = '朋友介绍'
  longP.spouse = { year: 2019, personId: rA.id, how: '朋友介绍', job: jobPhrase(rAP) }
  rAP.spouse!.job = jobPhrase(longP)
  rAP.parents = { city: '上海', retired: true, personIds: [], alive: true }
  longP.car = '白色的电动车'
  shareHousehold(longP, rAP)
  const rBP = persona(rB, { gender: 'f', birthYear: 1964, major: '中文', field: 'teaching', city: '苏州', hometown: '苏州', married: false, kids: [{ gender: 'f', birthYear: 1991, personId: long.id }] })
  rBP.extras.grandkids = '外孙女'
  longP.parents = { city: '苏州', retired: true, personIds: [rB.id], alive: true }
  persona(rC, { gender: 'f', birthYear: 2021, city: '杭州', district: '城西', hometown: '杭州', parentsCity: '杭州' }).parents.personIds = [long.id, rA.id]
  persona(rD, { birthYear: 1996, major: '动画', field: 'design', city: '杭州', district: '滨江', pastJobs: [], job: { company: '一家动画工作室', role: '原画师', city: '杭州', from: { y: 2023, m: 3 } }, jobChange: null })

  // classmates (college group): born around 1991, same university
  const classYear = () => r.pick([1990, 1991, 1991, 1991, 1992])
  for (const p of [...gbReg, special('Ivy Zhang'), special('Emma'), special('🐱 橘子妈妈')]) {
    if (p === rE && p.persona) continue
    const inOw = owReg.includes(p)
    const inBd = bdReg.includes(p)
    persona(p, {
      birthYear: classYear(),
      school: COLLEGE,
      ...(inOw ? { city: '杭州', district: '城西' } : inBd ? { city: '杭州' } : {}),
      hobbies: inBd ? ['打羽毛球'] : undefined,
      ...(p.label === '🐱 橘子妈妈' ? { pet: { kind: '猫', name: '橘子' } } : {}),
    })
  }
  for (const p of owOthers) persona(p, { birthYear: birthFor(p), city: '杭州', district: '城西', hobbies: bdReg.includes(p) ? ['打羽毛球'] : undefined })
  for (const p of bdReg.filter((x) => !x.persona)) persona(p, { birthYear: Math.min(2000, birthFor(p)), city: '杭州', hobbies: ['打羽毛球'] })
  persona(special('8楼邻居刘阿姨'), { birthYear: 1958, city: '杭州', district: '城西', hometown: '绍兴' })
  persona(special('Kevin Wu'), { birthYear: 1989, major: '计算机', city: '杭州', hobbies: ['打羽毛球'] })
  persona(special('Oscar Li'), { birthYear: 1995, major: '市场营销', city: '杭州', hobbies: ['打羽毛球'], married: false })
  persona(special('Uma Patel'), { birthYear: 1993, city: '杭州', hometown: '新加坡', noDegree: true, field: 'teaching', pastJobs: [], job: { company: '一所国际学校', role: '英语老师', city: '杭州', from: { y: 2020, m: 8 } }, hobbies: ['打羽毛球'], jobChange: null })
  persona(special('Vivian Ho'), { birthYear: 1988, major: '金融', hometown: '香港' })
  persona(special('3号技师小吴'), { birthYear: 1998, city: '杭州', district: '城西', noDegree: true, field: 'trade', pastJobs: [], job: { company: '一家理发店', role: '理发师', city: '杭州', from: { y: 2018, m: 3 } }, jobChange: null, married: false })
  persona(alice, { birthYear: 1994, major: '英语', city: '杭州', district: '拱墅', pastJobs: [], job: { company: '一家做跨境电商的公司', role: '运营', city: '杭州', from: { y: 2019, m: 7 } }, hobbies: ['打羽毛球'], jobChange: null })
  persona(longLabel, { birthYear: 1991, school: COLLEGE, major: '美术', field: 'design', city: '杭州', district: '西湖区', pastJobs: [], job: { company: '一家独立设计工作室', role: '合伙人', city: '杭州', from: { y: 2019, m: 5 } }, hobbies: ['打羽毛球', '做陶艺'], pet: { kind: '猫', name: '汤圆' }, jobChange: null })
  persona(sparse, { birthYear: 1993, city: '杭州', district: '城西' })
  persona(lunarSoon, { birthYear: 1985, city: '杭州', district: '城西' })
  persona(leap, { birthYear: 1990, school: COLLEGE })
  const heavyP = persona(heavy, { birthYear: 1990, school: COLLEGE, major: '中文', field: 'tech', city: '杭州', district: '滨江', hometown: '苏州', pastJobs: [{ city: '杭州', company: SELF_COMPANY, role: '产品经理', from: { y: 2014, m: 7 }, to: { y: 2021, m: 3 } }], job: { company: '一家游戏公司', role: '产品经理', city: '杭州', from: { y: 2021, m: 3 } }, married: true, marriedYear: 2018, kids: [{ gender: 'm', birthYear: 2020 }], jobChange: null, moveChange: null })
  persona(deleteMe, { birthYear: 1996, city: '杭州' })
  persona(reviewNew, { birthYear: 1989, school: COLLEGE, major: '英语', field: 'teaching', city: '长沙', district: '岳麓', jobChange: null })
  persona(history, { birthYear: 1992, major: '市场营销', field: 'business', city: '上海', district: '闵行', hometown: '无锡', since: { y: 2026, m: 7 }, prevHome: { city: '苏州', district: '工业园区', from: { y: 2016, m: 7 } }, pastJobs: [{ city: '苏州', company: '一家物流公司', role: '调度主管', from: { y: 2016, m: 7 }, to: { y: 2025, m: 12 } }, { city: '苏州', company: '一家新能源车企', role: '销售主管', from: { y: 2025, m: 12 }, to: { y: 2026, m: 6 } }], job: { company: '一家新能源车企', role: '销售主管', city: '上海', from: { y: 2026, m: 6 } }, married: true, marriedYear: 2017, kids: [{ gender: 'm', birthYear: 2018 }] })

  // ---- families around chat members, drawn from people in no chat ----
  type RelPlan = { x: P; y: P; label: string; segs: S[]; status?: Status }
  const relPlan: RelPlan[] = []
  const anchors = r.shuffle([...gbReg, ...owOthers, ...bdReg.filter((p) => !owOthers.includes(p))].filter((p, i, arr) => arr.indexOf(p) === i && p.persona?.stage === 'adult' && p !== rE))
  let spouses = 0
  let siblings = 0
  for (const a of anchors) {
    const ap = a.persona!
    const famSegs = () => (groupBig.members.includes(a) && r.chance(0.12) ? [reviewMixed] : doneOf(a))
    if (ap.spouse && spouses < 14) {
      const g: Gender = a.gender === 'f' ? 'm' : 'f'
      const sp = freeOf((p) => ['mid', 'mid70'].includes(nameEra(p.label)) && genderOk(p, g))
      if (sp) {
        spouses++
        const spp = persona(sp, { gender: g, birthYear: ap.birthYear + r.int(-3, 3), city: ap.city, district: ap.district, since: ap.since, prevHome: ap.prevHome ?? null, married: true, marriedYear: ap.spouse.year, kids: ap.kids, moveChange: ap.moveChange ? true : null, jobChange: null })
        for (const j of spp.jobs) j.city = ap.prevHome && j.from.y * 12 + j.from.m < ap.since.y * 12 + ap.since.m ? ap.prevHome.city : ap.city
        spp.ownsHome = ap.ownsHome
        shareHousehold(ap, spp)
        spp.spouse = { year: ap.spouse.year, personId: a.id, how: ap.spouse.how, job: jobPhrase(ap) }
        ap.spouse = { ...ap.spouse, personId: sp.id, job: jobPhrase(spp) }
        relPlan.push({ x: a, y: sp, label: a.gender === 'f' ? '老公' : '老婆', segs: famSegs() })
      }
    }
    for (const k of ap.kids) {
      if (k.personId !== undefined) continue
      const fatherLabel = a.gender === 'm' ? a.label : ap.spouse?.personId !== undefined ? b.byId.get(ap.spouse.personId)?.label : undefined
      const kid = freeOf((p) => nameEra(p.label) === 'young' && genderOk(p, k.gender) && (!fatherLabel || surnameOf(p.label) === surnameOf(fatherLabel)))
      if (!kid) break
      const kp = persona(kid, { gender: k.gender, birthYear: k.birthYear, city: ap.city, district: ap.district, hometown: ap.city, parentsCity: ap.city, married: false })
      k.personId = kid.id
      kp.parents.personIds = [a.id, ...(ap.spouse?.personId !== undefined ? [ap.spouse.personId] : [])]
      kp.parents.alive = true
      relPlan.push({ x: a, y: kid, label: k.gender === 'f' ? '女儿' : '儿子', segs: famSegs() })
    }
    const sibs: P[] = []
    if (siblings < 5 && ap.birthYear >= 1980) {
      const sib = freeOf((p) => nameEra(p.label) === 'mid' && surnameOf(p.label) === surnameOf(a.label))
      if (sib) {
        siblings++
        const sg = nameGender(sib.label) ?? (r.chance(0.5) ? 'f' : 'm')
        const by = ap.birthYear + (r.chance(0.5) ? -1 : 1) * r.int(2, 6)
        const spp = persona(sib, { gender: sg, birthYear: by, hometown: ap.hometown, parentsCity: ap.parents.city })
        const older = by < ap.birthYear
        const term = older ? (sg === 'f' ? '姐姐' : '哥哥') : sg === 'f' ? '妹妹' : '弟弟'
        ap.siblings = [...ap.siblings.filter((s) => s.term !== term), { term, city: spp.city, personId: sib.id }]
        spp.siblings = [{ term: older ? (a.gender === 'f' ? '妹妹' : '弟弟') : a.gender === 'f' ? '姐姐' : '哥哥', city: ap.city, personId: a.id }]
        spp.parents = ap.parents
        sibs.push(sib)
        relPlan.push({ x: a, y: sib, label: term, segs: famSegs() })
      }
    }
    if (ap.parents.alive || r.chance(0.5)) {
      const father = freeOf((p) => nameEra(p.label) === 'old' && genderOk(p, 'm') && surnameOf(p.label) === surnameOf(a.label))
      const par = father ?? freeOf((p) => nameEra(p.label) === 'old' && genderOk(p, 'f'))
      if (par) {
        const pg: Gender = father ? 'm' : 'f'
        const pp = persona(par, { gender: pg, birthYear: Math.min(1966, ap.birthYear - r.int(25, 31)), city: ap.parents.city, hometown: ap.hometown, married: true, marriedYear: ap.birthYear - r.int(1, 3), kids: [{ gender: a.gender, birthYear: ap.birthYear, personId: a.id }, ...sibs.map((s) => ({ gender: s.gender, birthYear: s.persona!.birthYear, personId: s.id }))] })
        pp.extras.grandkids = ap.kids.length ? (a.gender === 'f' ? '外孙' : '孙子') + (ap.kids[0].gender === 'f' ? '女' : '') : undefined
        ap.parents = { ...ap.parents, alive: true, personIds: [...ap.parents.personIds, par.id] }
        for (const s of sibs) s.persona!.parents = ap.parents
        relPlan.push({ x: a, y: par, label: pg === 'f' ? '妈妈' : '爸爸', segs: famSegs() })
      }
    }
  }
  // long-profile's relations
  relPlan.push({ x: self, y: long, label: '大学同学', segs: [pl1] })
  relPlan.push({ x: long, y: rA, label: '老公', segs: [pl1] })
  relPlan.push({ x: long, y: rB, label: '妈妈', segs: [pl2] })
  relPlan.push({ x: long, y: rC, label: '女儿', segs: [pl2] })
  relPlan.push({ x: long, y: rD, label: '同事', segs: [gb2] })
  relPlan.push({ x: long, y: rE, label: '好朋友', segs: [gb1] })
  relPlan.push({ x: long, y: longLabel, label: '大学同学', segs: [bd1] })
  relPlan.push({ x: long, y: heavy, label: '表姐', segs: [reviewMixed], status: 'proposed' })

  // self's circle
  const selfRel = (y: P, label: string, segs: S[]) => relPlan.push({ x: self, y, label, segs, status: r.chance(0.04) ? 'rejected' : undefined })
  for (const p of r.sample(gbReg.filter((p) => p !== rE), 30).slice(0, 25)) selfRel(p, '大学同学', [gb1, gb2])
  for (const p of r.sample(gbReg.filter((p) => ![...relPlan].some((x) => x.x === self && x.y === p)), 5)) selfRel(p, '好朋友', [gb1, gb2])
  for (const p of r.sample(owOthers, 10)) selfRel(p, '邻居', [ow1])
  for (const p of r.sample(bdReg.filter((p) => !owOthers.includes(p) && !gbReg.includes(p)), 8)) selfRel(p, '球友', [bd1])
  selfRel(heavy, '前同事', [hv1])
  selfRel(longLabel, '大学同学', [bd1])
  selfRel(alice, '球友', [failedWin])
  selfRel(special('Vivian Ho'), '老朋友', privateDone)
  selfRel(special('3号技师小吴'), '理发师', [ow1])
  const majorRole: [string, string][] = [['计算机', '前端工程师'], ['软件工程', '后端工程师'], ['计算机', '测试工程师'], ['视觉传达', 'UI 设计师']]
  for (let i = 0; i < 4; i++) {
    const p = freeOf((x) => nameEra(x.label) === 'mid')
    if (!p) break
    const [major, role] = majorRole[i]
    persona(p, { birthYear: r.int(1990, 1998), major, city: '杭州', pastJobs: [], job: { company: SELF_COMPANY, role, city: '杭州', from: { y: r.int(2019, 2024), m: r.int(1, 12) } }, jobChange: null })
    selfRel(p, '同事', privateDone)
  }
  for (let i = 0; i < 3; i++) {
    const p = freeOf((x) => nameEra(x.label) === 'mid')
    if (!p) break
    const [major, role] = majorRole[i]
    const from: YM = { y: r.int(2016, 2019), m: r.int(1, 12) }
    const to: YM = { y: r.int(2021, 2023), m: r.int(1, 12) }
    const past: Job[] = [{ city: '杭州', company: SELF_COMPANY, role, from, to }]
    persona(p, { birthYear: r.int(1988, 1994), major, city: '杭州', pastJobs: past, job: { company: '一家游戏公司', role, city: '杭州', from: to }, jobChange: null })
    selfRel(p, '前同事', privateDone)
  }
  const cousinF = freeOf((x) => nameEra(x.label) === 'mid' && genderOk(x, 'f'))
  if (cousinF) {
    persona(cousinF, { gender: 'f', birthYear: r.int(1985, 1989), hometown: '长沙' })
    selfRel(cousinF, '表姐', privateDone)
  }
  const cousinM = freeOf((x) => nameEra(x.label) === 'mid' && genderOk(x, 'm'))
  if (cousinM) {
    persona(cousinM, { gender: 'm', birthYear: r.int(1995, 1999), hometown: '长沙' })
    selfRel(cousinM, '堂弟', privateDone)
  }
  const builder = freeOf((x) => ['mid70', 'mid'].includes(nameEra(x.label)) && genderOk(x, 'm'))
  if (builder) {
    persona(builder, { gender: 'm', birthYear: r.int(1972, 1980), city: '杭州', noDegree: true, field: 'trade', pastJobs: [], job: { company: '一家装修公司', role: '装修队长', city: '杭州', from: { y: 2012, m: 3 } }, jobChange: null })
    selfRel(builder, '装修师傅', [ow1])
  }
  // everyone else in no chat: old → neighbours, young → a classmate's younger cousin, others → old friends
  for (const p of shuffled) {
    if (p.persona) continue
    const era = nameEra(p.label)
    if (era === 'old') {
      persona(p, { birthYear: birthFor(p), city: '杭州', district: '城西' })
      selfRel(p, '邻居', [ow1])
    } else if (era === 'young') {
      const a = r.pick(gbReg.filter((x) => x.persona?.stage === 'adult' && x !== rE))
      persona(p, { birthYear: r.int(2004, 2007), hometown: a.persona!.hometown })
      relPlan.push({ x: a, y: p, label: `${surnameOf(p.label) === surnameOf(a.label) ? '堂' : '表'}${p.gender === 'f' ? '妹' : '弟'}`, segs: doneOf(a) })
    } else {
      persona(p, { birthYear: birthFor(p), hometown: r.chance(0.5) ? '长沙' : undefined })
      selfRel(p, r.chance(0.5) ? '老朋友' : '好朋友', privateDone)
    }
  }
  for (const p of b.persons) if (p.persona?.spouse && !p.persona.spouse.job) p.persona.spouse.job = p.persona.stage === 'retired' ? '也已经退休了' : r.pick(SPOUSE_JOBS)
  void heavyP

  for (const plan of relPlan) b.relation(plan.x, plan.y, plan.label, r.pick(plan.segs), plan.status)

  // ---- facts ----
  for (const p of b.persons) {
    if (!p.persona || p.isSelf) continue
    const { facts, chains } = factsOf(p.persona, clk)
    const lonely = doneOf(p).length === 0
    const usable = facts.filter((f) => !(lonely && f.mentionIds?.length))
    p.facts = [0, 1, 2].flatMap((tier) => r.shuffle(usable.filter((f) => f.tier === tier)))
    p.chains = chains
  }
  const segsFor = (p: P): S[] => {
    const own = doneOf(p)
    if (own.length) return own
    const via = new Set<S>()
    for (const id of p.rel.keys()) {
      const q = b.byId.get(id)
      if (!q) continue
      for (const s of q.isSelf ? privateDone : doneOf(q)) via.add(s)
    }
    return via.size ? [...via] : doneSegs
  }
  const fitting = (segs: S[], w?: Window) => segs.filter((s) => b.fits(s, w))
  const nextFact = (p: P, segs: S[] | null, pred: (f: Fact) => boolean = () => true): { fact: Fact; seg: S | null } | null => {
    for (const f of p.facts) {
      if (p.used.has(f.key) || p.used.has(`s:${f.statement}`) || !pred(f)) continue
      if (!segs) return { fact: f, seg: null }
      const fit = fitting(segs, f.window)
      if (fit.length) return { fact: f, seg: r.pick(fit) }
    }
    return null
  }
  const emitChain = (p: P, ch: Chain, segs: S[]): boolean => {
    if (p.used.has(ch.old.key) || p.used.has(ch.cur.key)) return false
    const pairs = fitting(segs, ch.old.window).flatMap((os) => fitting(segs, ch.cur.window).filter((cs) => cs.createdDay <= os.createdDay).map((cs) => [os, cs] as const))
    if (!pairs.length) return false
    const [os, cs] = r.pick(pairs)
    const oldRow = b.claim(p, ch.old, { seg: os, status: 'confirmed' })
    const newRow = b.claim(p, ch.cur, { seg: cs, status: 'confirmed' })
    b.supersede(oldRow, newRow, 'superseded')
    return true
  }
  const pickFit = (p: P, segs: S[], f: ClaimInput): S => {
    const fit = fitting(segs, f.window)
    if (!fit.length) throw new Error(`seed: no import fits "${f.statement}" for ${p.label}`)
    return r.pick(fit)
  }
  const confirmed = (p: P, segs: S[], pred?: (f: Fact) => boolean) => {
    const n = nextFact(p, segs, pred)
    if (!n) throw new Error(`seed: ${p.label} ran out of facts`)
    return b.claim(p, n.fact, { seg: n.seg, status: 'confirmed' })
  }

  // ---- long-profile: 60 claims, one coherent life ----
  const longDone = [gb1, gb2, ow1, bd1, pl1, pl2]
  const L = (f: ClaimInput, segs: S[] = longDone, status: Status = 'confirmed', extra: { confidence?: number; manual?: boolean } = {}) => b.claim(long, f, { seg: extra.manual ? null : pickFit(long, segs, f), status, ...extra })
  const searchable = L(hand('P.teaset', 'preference', '收藏了一整套景德镇青花茶具', '我收藏了一整套景德镇青花茶具，下次来家里喝茶'), [pl2], 'confirmed', { confidence: 0.93 })
  refs.claims['claim-searchable'] = { id: searchable.id!, personId: long.id, statement: searchable.statement }
  const oldJob = L(hand('W.oldjob', 'work', '在上海的一家广告公司做制片', '我现在在上海的一家广告公司做制片', { third: '{name}现在在上海的一家广告公司做制片', validFrom: '2016-07', window: clk.between({ y: 2016, m: 7 }, { y: 2025, m: 9 }) }), [pl1])
  const shared = L(hand('W.job', 'work', '在杭州的一家动画工作室做制片', '我换工作了，现在在杭州的一家动画工作室做制片', { third: '{name}现在在杭州的一家动画工作室做制片', validFrom: '2025-09', window: clk.since({ y: 2025, m: 9 }) }), [pl1], 'confirmed', { confidence: 0.9 })
  b.supersede(oldJob, shared, 'superseded')
  const sharedEv = b.evRefs.find((e) => e.targetType === 'claim' && e.targetId === shared.id)
  if (sharedEv) sharedEv.extra = Math.min(sharedEv.extra, 1)
  const sharedFact = b.say(delSeg, b.self, `${long.label}现在在杭州的一家动画工作室做制片，你可以找她聊聊`)
  b.evidence('claim', shared.id!, sharedFact, 0)
  refs.claims['delete-me-shared'] = { id: shared.id!, personId: long.id, statement: shared.statement }
  const oldHome = L(hand('L.oldhome', 'location', '住在上海徐汇', '我现在住上海徐汇那边', { third: '{name}现在住在上海徐汇', validFrom: '2016-07', window: clk.between({ y: 2016, m: 7 }, { y: 2025, m: 8 }) }), [pl1])
  const newHome = L(hand('L.home', 'location', '住在杭州城西', '我们搬到杭州了，就住城西', { third: '{name}现在住在杭州城西', validFrom: '2025-08', window: clk.since({ y: 2025, m: 8 }) }), [pl1, pl2, ow1])
  b.supersede(oldHome, newHome, 'superseded')
  L(hand('W.tenure', 'work', '做制片快十年了', '我做制片快十年了', { window: clk.thisYear() }))
  L(hand('W.past0', 'work', '2013年到2016年在长沙的一家影视公司做编导', '我毕业后在长沙一家影视公司做了三年编导', { validFrom: '2013', validTo: '2016' }))
  L(hand('W.project', 'work', '最近在负责一部动画短片的排期和预算', '最近在盯一部动画短片，排期和预算都归我管', { window: [200, 0] }))
  L(hand('W.commute', 'work', '每天坐地铁去滨江上班', '我每天坐地铁去滨江上班，单程四十分钟', { window: clk.since({ y: 2025, m: 9 }) }))
  L(hand('W.team', 'work', '带着一个五人的制片小组', '我现在带着一个五人的制片小组', { window: clk.since({ y: 2025, m: 9 }) }))
  L(hand('W.cert', 'work', '在准备 PMP 项目管理考试', '我在准备 PMP 考试，下班还得刷题', { window: [240, 0] }))
  L(hand('W.ads', 'work', '以前在广告公司拍过很多汽车广告', '我以前在广告公司拍过好多汽车广告'))
  L(hand('L.hometown', 'location', '老家在苏州', '我老家是苏州的', { q: '你老家哪儿的？' }), [pl1, pl2])
  L(hand('L.rent', 'location', '在杭州租房住', '我们在杭州是租的房子', { window: clk.since({ y: 2025, m: 8 }) }))
  L(hand('L.visit', 'location', '每个月回一趟苏州看妈妈', '我每个月回一趟苏州看我妈'))
  L(hand('W.travel', 'location', '还是经常去上海出差', '老客户都在上海，我还是经常过去出差', { window: clk.since({ y: 2025, m: 9 }) }))
  L(hand('L.plan', 'location', '打算明年在杭州买房', '我们打算明年在杭州买房，最近在看滨江的楼盘'), [reviewMixed], 'proposed', { confidence: 0.91 })
  L(hand('E.degree', 'education', '长沙师范大学广播电视编导专业毕业', '我是长沙师范大学广播电视编导专业毕业的', { validFrom: '2013' }))
  L(hand('E.high', 'education', '高中在苏州读的', '我高中是在苏州读的'))
  L(hand('E.monitor', 'education', '大学时当了四年班长', '我大学那会儿当了四年班长'), [gb1, gb2])
  L(hand('E.course', 'education', '周末在上影视制片管理的网课', '最近周末在上一个影视制片管理的网课', { window: [200, 0] }))
  L(hand('E.club', 'education', '大学时在话剧社待过', '我大学的时候在话剧社待了三年'), [gb1, gb2])
  L(hand('F.spouse', 'family', `老公在杭州的一家建筑设计院做建筑师`, '我老公在杭州的一家建筑设计院做建筑师', { third: '{name}的老公在杭州的一家建筑设计院做建筑师', mentionIds: [rA.id], window: clk.since({ y: 2025, m: 8 }) }))
  L(hand('F.kidAge', 'family', '女儿今年5岁', '我女儿今年5岁了，皮得很', { third: '{name}的女儿今年5岁了', mentionIds: [rC.id], window: clk.thisYear() }))
  L(hand('F.kidGrade', 'family', '女儿在上幼儿园中班', '我女儿在上幼儿园中班', { third: '{name}的女儿在上幼儿园中班', mentionIds: [rC.id], window: clk.schoolYear().window }))
  L(hand('F.only', 'family', '是家里的独生女', '我是独生女'))
  L(hand('F.mom', 'family', '妈妈退休前是中学语文老师', '我妈退休前是中学语文老师', { third: '{name}的妈妈退休前是中学语文老师', mentionIds: [rB.id] }))
  L(hand('F.momCity', 'family', '妈妈一个人住在苏州老家', '我妈一个人住在苏州老家', { third: '{name}的妈妈一个人住在苏州老家', mentionIds: [rB.id] }))
  L(hand('F.inlaw', 'family', '婆婆从上海过来帮忙带孩子', '婆婆从上海过来帮我们带孩子', { third: '{name}的婆婆从上海过来帮忙带孩子', window: clk.since({ y: 2025, m: 9 }) }))
  L(hand('F.met', 'family', '和老公是在上海经朋友介绍认识的', '我跟我老公是在上海经朋友介绍认识的', { mentionIds: [rA.id] }))
  L(hand('F.second', 'family', '在考虑要不要二胎', '我们在考虑要不要二胎，还没想好'), [reviewMixed], 'proposed', { confidence: 0.62 })
  L(hand('P.coffee', 'preference', '每天早上喝一杯美式咖啡', '我每天早上都要来一杯美式'))
  L(hand('P.hike', 'preference', '喜欢爬山', '周末有空就去爬山'))
  L(hand('P.coriander', 'preference', '不吃香菜', '我不吃香菜的哈', { q: '平时有什么忌口吗？' }), [pl1, pl2])
  L(hand('P.drama', 'preference', '喜欢看话剧', '我超爱看话剧，一个月去一次剧场'))
  L(hand('P.badminton', 'preference', '每周打两次羽毛球', '我现在每周打两次羽毛球'), [bd1])
  L(hand('P.puer', 'preference', '下午喜欢泡一壶普洱', '下午我喜欢泡一壶普洱'), [pl1, pl2])
  L(hand('P.spicy', 'preference', '在长沙读书后变得很能吃辣', '在长沙读了四年书，现在无辣不欢'))
  L(hand('P.bnb', 'preference', '旅行喜欢住民宿', '我出去玩喜欢住民宿'))
  L(hand('P.podcast', 'preference', '喜欢听播客', ''), [], 'confirmed', { manual: true })
  L(hand('LE.enroll', 'life_event', '2009年考上长沙师范大学', '我是2009年考上长沙师范大学的', { validFrom: '2009' }), [gb1, gb2, pl1, pl2])
  L(hand('LE.grad', 'life_event', '2013年大学毕业', '我是2013年大学毕业的', { validFrom: '2013' }))
  L(hand('LE.marry', 'life_event', '2019年结婚', '我们是2019年结的婚', { validFrom: '2019', mentionIds: [rA.id] }))
  L(hand('LE.kid', 'life_event', '2021年女儿出生', '我女儿是2021年出生的', { validFrom: '2021', mentionIds: [rC.id] }))
  L(hand('LE.shanghai', 'life_event', '2016年搬到上海', '我是2016年去的上海', { validFrom: '2016' }))
  L(hand('LE.move', 'life_event', '2025年从上海搬到杭州', '我们是2025年8月从上海搬到杭州的', { validFrom: '2025-08', window: clk.after({ y: 2025, m: 8 }) }))
  L(hand('LE.job', 'life_event', '2025年跳槽到动画工作室', '我是2025年9月跳槽到动画工作室的', { validFrom: '2025-09', window: clk.after({ y: 2025, m: 9 }) }))
  L(hand('LE.grandma', 'life_event', '外婆2023年去世', '外婆是2023年冬天走的', { validFrom: '2023-11' }), [pl1, pl2])
  L(hand('LE.iceland', 'life_event', '2024年去冰岛旅行', '2024年我们去冰岛玩了一趟', { validFrom: '2024', window: clk.after({ y: 2024, m: 12 }) }))
  L(hand('LE.marathon', 'life_event', '2022年跑完了第一个半程马拉松', '2022年我跑完了人生第一个半马', { validFrom: '2022' }))
  L(hand('LE.license', 'life_event', '2018年在上海考了驾照', '我2018年在上海考的驾照', { validFrom: '2018' }))
  L(hand('LE.hainan', 'life_event', '2026年春节带女儿去了海南', '今年春节我们带女儿去海南过的', { validFrom: '2026-02', window: clk.after({ y: 2026, m: 2 }), mentionIds: [rC.id] }), [pl1, pl2])
  L(hand('O.pet', 'other', '养了一只叫年糕的猫', '我家猫叫年糕，可闹了'))
  L(hand('O.diving', 'other', '最近在学潜水', '最近在学潜水', { window: [300, 0] }))
  L(hand('O.japanese', 'other', '会说一点日语', '我会说一点日语'))
  L(hand('O.car', 'other', '开一辆白色的电动车', '我开的是一辆白色的电动车', { window: clk.since({ y: 2025, m: 8 }) }))
  L(hand('O.myopia', 'other', '近视五百度', '我近视五百度，不戴眼镜啥都看不清'))
  L(hand('O.donor', 'other', '每年都去献血', '我每年都去献一次血'))
  L(hand('O.english', 'other', '英文名叫 Linda', ''), [], 'confirmed', { manual: true })
  L({ ...REJECTED_CLAIMS[0], key: 'R.0' }, [gb2], 'rejected')
  if (b.t.claims.filter((c) => c.personId === long.id).length !== 60) throw new Error(`seed: long-profile has ${b.t.claims.filter((c) => c.personId === long.id).length} claims, expected 60`)

  // aliases: display handles in 4 chats + 4 mentioned + 4 address terms + 3 real names = 15
  b.aliasPair(long, gb1, '知夏', '班长')
  b.aliasPair(long, gb2, '小林', '林班长')
  b.aliasPair(long, ow1, '夏夏', '林姐')
  b.aliasPair(long, bd1, 'Linda', '夏姐')
  b.realName(long, pl1, '林知夏', '你身份证上的名字是林知夏吧？我帮你一起订票')
  b.realName(long, gb1, 'Linda Lin', '阿夏的英文名是 Linda Lin，她以前外企的同事都这么叫她')
  b.realName(long, ow1, '林晓霞', '林知夏原来叫林晓霞，上大学前改的名')
  b.event([long, self], { place: '千岛湖', phrase: '去千岛湖露营' }, pl1, { y: 2025, m: 10 })
  b.event([long, rA, rC], EVENT_KINDS.family[0], pl1, { y: 2026, m: 2 })
  b.event([long, longLabel, alice], EVENT_KINDS.badminton[0], bd1, { y: 2026, m: 4, d: 12 })
  b.event([long, rD], { place: '郊外', phrase: '去郊外爬山' }, gb2, { y: 2026, m: 5 })
  b.event([long, self, rE], { place: '市图书馆', phrase: '去市图书馆听讲座' }, gb1, { y: 2025, m: 7, d: 20 })
  b.event([long, heavy, reviewNew], { place: '陶艺工作室', phrase: '去陶艺工作室做陶艺' }, reviewMixed, { y: 2026, m: 9, d: 6 }, 'proposed')
  if (b.t.events.length !== 6) throw new Error(`seed: long-profile events ${b.t.events.length}`)
  const soonAnniv = addDays(o.today, 20)
  b.date(long, { kind: 'birthday', calendar: 'lunar', month: 3, day: 12, year: 1991 }, pl1)
  b.date(long, { kind: 'anniversary', calendar: 'solar', month: soonAnniv.m, day: soonAnniv.d, year: 2019 }, pl2)
  b.date(long, { kind: 'memorial', calendar: 'solar', month: 11, day: 2, year: 2023, label: '外婆的忌日' }, pl1)
  b.date(long, { kind: 'other', calendar: 'solar', month: 8, day: 20, year: 2025, label: '搬到杭州的日子' }, gb2)
  b.date(long, { kind: 'other', calendar: 'solar', month: 4, day: 18, label: '外公生日' }, reviewMixed, 'proposed')
  b.addressTerm(history, hi1, '老曾')

  // ---- sparse-profile: exactly one claim ----
  confirmed(sparse, [ow1], (f) => f.key === 'W.job')

  // ---- proposed-heavy: 10 proposed (plausible news in the class group) + 8 confirmed ----
  const cats: Category[] = ['work', 'location', 'education', 'family', 'preference', 'life_event', 'other']
  for (let i = 0; i < 10; i++) {
    const n = nextFact(heavy, [reviewMixed], (f) => f.category === cats[i % cats.length]) ?? nextFact(heavy, [reviewMixed])
    if (!n) throw new Error('seed: proposed-heavy ran out of facts')
    b.claim(heavy, n.fact, { seg: n.seg, status: 'proposed', confidence: i % 2 ? 0.66 : 0.9 })
  }
  for (let i = 0; i < 8; i++) confirmed(heavy, [hv1, gb1, gb2])

  // ---- with-history: a job change, a transfer to Shanghai, an MBA finished; 2 outdated habits; 1 edited ----
  const H = (f: ClaimInput, status: Status = 'confirmed') => b.claim(history, f, { seg: pickFit(history, [hi1], f), status })
  const w1 = H(hand('W.j1', 'work', '在苏州的一家物流公司做调度主管', '我现在在苏州的一家物流公司做调度主管', { third: '{name}在苏州的一家物流公司做调度主管', validFrom: '2016-07', window: clk.before({ y: 2025, m: 12 }) }))
  const w2 = H(hand('W.j2', 'work', '在苏州的一家新能源车企做销售主管', '我换工作了，去了苏州一家新能源车企做销售主管', { third: '{name}去了苏州一家新能源车企做销售主管', validFrom: '2025-12', window: clk.between({ y: 2025, m: 12 }, { y: 2026, m: 6 }) }))
  const w3 = H(hand('W.job', 'work', '在上海的一家新能源车企做销售主管', '公司把我调去上海总部了，还是做销售主管', { third: '{name}被调去上海总部了，还是做销售主管', validFrom: '2026-06', window: clk.since({ y: 2026, m: 6 }) }))
  b.supersede(w1, w2, 'superseded')
  b.supersede(w2, w3, 'superseded')
  const h1 = H(hand('L.old', 'location', '住在苏州工业园区', '我现在住苏州工业园区那边', { third: '{name}住在苏州工业园区', validFrom: '2016-07', window: clk.before({ y: 2026, m: 7 }) }))
  const h2 = H(hand('L.home', 'location', '住在上海闵行', '我们搬到上海了，住闵行', { third: '{name}搬到上海闵行了', validFrom: '2026-07', window: clk.since({ y: 2026, m: 7 }) }))
  b.supersede(h1, h2, 'superseded')
  const e1 = H(hand('E.mba0', 'education', '在读在职 MBA', '我在读在职 MBA，每个周末去上海上课', { validFrom: '2024-09', window: clk.before({ y: 2026, m: 6 }) }))
  const e2 = H(hand('E.mba', 'education', '在职 MBA 毕业了', '在职 MBA 终于读完了，上周拿到了学位证', { validFrom: '2026-06', window: clk.since({ y: 2026, m: 6 }) }))
  b.supersede(e1, e2, 'superseded')
  b.outdated(H(hand('W.expo', 'work', '最近在负责车展筹备', '最近在忙车展筹备，天天加班', { window: clk.between({ y: 2026, m: 1 }, { y: 2026, m: 5 }) })), 100)
  b.outdated(H(hand('P.lake', 'preference', '周末常去金鸡湖边跑步', '我周末一般去金鸡湖边跑步', { window: clk.before({ y: 2026, m: 7 }) })), 60)
  const editedOld = H(hand('F.kid0', 'family', '有一个上小学的儿子', '我儿子在上小学', { window: clk.schoolYear().window }))
  const editedNew = H(hand('F.kid', 'family', '儿子在读小学二年级', '我儿子在读小学二年级', { window: clk.schoolYear().window }))
  b.supersede(editedOld, editedNew, 'edited')
  refs.claims['history-edited'] = { id: editedOld.id!, personId: history.id, statement: editedOld.statement }
  H(hand('L.hometown', 'location', '老家在无锡', '我老家是无锡的'))
  H(hand('F.wife', 'family', '老婆和儿子暂时还留在苏州', '我老婆和儿子暂时还留在苏州，等学期结束再搬', { window: clk.since({ y: 2026, m: 7 }) }))
  H(hand('LE.marry', 'life_event', '2017年结婚', '我们是2017年结的婚', { validFrom: '2017' }))
  H(hand('P.fishing', 'preference', '喜欢钓鱼', '周末我一般去水库钓鱼'))
  H(hand('P.coriander', 'preference', '不吃香菜', '我不吃香菜的哈'))
  H(hand('E.degree', 'education', '南京财经大学市场营销专业毕业', '我是南京财经大学市场营销专业毕业的', { validFrom: '2014' }))
  b.date(history, { kind: 'birthday', calendar: 'solar', month: 2, day: 29, year: 1992 }, hi1)

  // ---- lunar-birthday-soon, leap-month, long-label ----
  for (let i = 0; i < 9; i++) confirmed(lunarSoon, [ow1])
  for (let i = 0; i < 3; i++) {
    const n = nextFact(lunarSoon, [inProgress])
    if (!n) throw new Error('seed: lunar-birthday-soon ran out of facts')
    b.claim(lunarSoon, n.fact, { seg: n.seg, status: 'proposed' })
  }
  let k = 12
  let lunar = Solar.fromYmd(addDays(o.today, k).y, addDays(o.today, k).m, addDays(o.today, k).d).getLunar()
  while (lunar.getMonth() < 0 || lunar.getDay() === 30) {
    k++
    const d = addDays(o.today, k)
    lunar = Solar.fromYmd(d.y, d.m, d.d).getLunar()
  }
  b.date(lunarSoon, { kind: 'birthday', calendar: 'lunar', month: lunar.getMonth(), day: lunar.getDay(), year: 1985 }, ow1)
  for (let i = 0; i < 10; i++) confirmed(leap, [gb1, gb2])
  const leapYear = leap.persona!.birthYear
  if (LunarYear.fromYear(leapYear).getLeapMonth() === 0) throw new Error('seed: leap-month person must be born in a lunar year with a leap month')
  b.date(leap, { kind: 'birthday', calendar: 'lunar', month: LunarYear.fromYear(leapYear).getLeapMonth(), day: 18, year: leapYear, isLeap: true }, gb2)
  const LL = (f: ClaimInput) => b.claim(longLabel, f, { seg: bd1, status: 'confirmed' })
  LL(hand('W.job', 'work', '在杭州一家独立设计工作室做合伙人', '我在杭州跟朋友合开了一家独立设计工作室'))
  LL(hand('W.side', 'work', '周末在陶艺教室代课', '我周末在朋友的陶艺教室代课，教小朋友拉坯'))
  LL(hand('E.degree', 'education', '长沙师范大学美术专业毕业', '我是长沙师范大学美术专业毕业的', { validFrom: '2013' }))
  LL(hand('P.badminton', 'preference', '喜欢打羽毛球', '我每周都要打羽毛球'))
  LL(hand('O.pet', 'other', '养了一只叫汤圆的猫', '我家猫叫汤圆，特别黏人'))

  // ---- delete-me: 3 proposed + 2 confirmed, only its own messages ----
  for (let i = 0; i < 5; i++) {
    const n = nextFact(deleteMe, [delSeg])
    if (!n) throw new Error('seed: delete-me ran out of facts')
    b.claim(deleteMe, n.fact, { seg: n.seg, status: i < 3 ? 'proposed' : 'confirmed' })
  }

  // ---- review-mixed extras: new person, aliases, dates ----
  for (let i = 0; i < 6; i++) {
    const n = nextFact(reviewNew, [reviewMixed], (f) => f.category === cats[i]) ?? nextFact(reviewNew, [reviewMixed])
    if (!n) throw new Error('seed: review-new ran out of facts')
    b.claim(reviewNew, n.fact, { seg: n.seg, status: 'proposed', confidence: i < 3 ? 0.88 : 0.58 })
  }
  b.aliasPair(reviewNew, reviewMixed, '遥遥', '贺老师', 'proposed')
  b.relation(reviewNew, leap, '表妹', reviewMixed, 'proposed')
  // a person first seen in this chat: the day is known, the birth year is not
  b.date(reviewNew, { kind: 'birthday', calendar: 'solar', month: 12, day: 3 }, reviewMixed, 'proposed')

  // ---- everyone else: fill up to exactly 5000 claims from their personas ----
  const TARGET = 5000
  const CHANGES = 8
  const filler = [...regular, ...specials, alice]
  const reviewFor = (p: P): S => {
    if (p.chats.includes(fwChat)) return failedWin
    const x = r.next()
    return x < 0.8 ? reviewMixed : x < 0.9 ? failedWin : inProgress
  }
  const capacity = (p: P) => p.facts.length + p.chains.length + (p.persona?.stage === 'child' ? 0 : 2)
  const weights = filler.map((p) => capacity(p) * (0.45 + r.next() * 0.8))
  const remaining = TARGET - CHANGES - b.t.claims.length
  const wsum = weights.reduce((a, w) => a + w, 0)
  const budget = weights.map((w, i) => Math.max(1, Math.min(capacity(filler[i]), Math.floor((w / wsum) * remaining))))
  const rejectedOf = (p: P) => {
    const pe = p.persona
    const fits = (i: number) => (pe?.stage === 'adult' || ![0, 7, 10].includes(i)) && (i !== 11 || pe?.pet?.kind === '猫') && (i !== 2 || pe?.stage !== 'student')
    return REJECTED_CLAIMS.findIndex((c, i) => fits(i) && !p.used.has(`R.${i}`) && !p.used.has(`s:${c.statement}`))
  }
  const changeCandidates: { p: P; row: ClaimRow }[] = []
  filler.forEach((p, idx) => {
    const segs = segsFor(p)
    const k2 = budget[idx]
    let made = 0
    p.chains.forEach((ch, i) => {
      if (k2 - made >= 2 && emitChain(p, ch, segs)) made += 2
    })
    let stuck = 0
    while (made < k2 && stuck < 6) {
      const x = r.next()
      const child = p.persona?.stage === 'child'
      let row: ClaimRow | null = null
      if (x < 0.02) {
        const n = nextFact(p, null)
        if (n) row = b.claim(p, n.fact, { seg: null, status: 'confirmed', manual: true })
      } else if (x < 0.052 && !child) {
        const i = rejectedOf(p)
        const fit = fitting(segs)
        if (i >= 0 && fit.length) row = b.claim(p, { ...REJECTED_CLAIMS[i], key: `R.${i}` }, { seg: r.pick(fit), status: 'rejected' })
      } else if (x < 0.25) {
        const s = reviewFor(p)
        const n = nextFact(p, [s])
        if (n) row = b.claim(p, n.fact, { seg: s, status: s.status === 'reviewing' && r.chance(0.35) ? 'confirmed' : 'proposed' })
      } else {
        const sensitive = !child && r.chance(0.05) ? SENSITIVE_CLAIMS.find((c) => !p.used.has(`s:${c.statement}`)) : undefined
        if (sensitive) row = b.claim(p, sensitive, { seg: r.pick(segs), status: 'confirmed', sensitive: true })
        else {
          const n = nextFact(p, segs)
          if (n) {
            row = b.claim(p, n.fact, { seg: n.seg, status: 'confirmed' })
            if (groupBig.members.includes(p) && (n.fact.key === 'W.job' || n.fact.key === 'L.home') && p.persona?.stage === 'adult') changeCandidates.push({ p, row })
          }
        }
      }
      if (row) {
        made++
        stuck = 0
      } else stuck++
    }
  })
  // top up persons that still have facts until the total is exact
  for (let guard = 0; b.t.claims.length < TARGET - CHANGES; guard++) {
    let progressed = false
    for (const p of filler) {
      if (b.t.claims.length >= TARGET - CHANGES) break
      const n = nextFact(p, segsFor(p))
      if (!n) continue
      b.claim(p, n.fact, { seg: n.seg, status: 'confirmed' })
      progressed = true
    }
    if (!progressed) throw new Error(`seed: personas cannot supply ${TARGET} claims (have ${b.t.claims.length})`)
  }
  // "变化": proposed claims in review-mixed that would replace a current job or home
  const changes = r.sample(changeCandidates.filter((c) => c.row.status === 'confirmed'), CHANGES)
  changes.forEach(({ p, row: oldRow }, i) => {
    const fact = changeFactFor(p.persona!, oldRow.category as 'work' | 'location', clk, r)
    const replacement = b.claim(p, fact, { seg: reviewMixed, status: 'proposed', confidence: i % 2 ? 0.72 : 0.94 })
    replacement.supersedesClaimId = oldRow.id
    if (i === 0) refs.claims['review-change'] = { id: replacement.id!, personId: p.id, statement: replacement.statement }
  })
  if (b.t.claims.length !== TARGET) throw new Error(`seed: ${b.t.claims.length} claims, expected ${TARGET}`)
  const sensitive = b.t.claims.find((c) => c.sensitive)
  if (sensitive) refs.claims.sensitive = { id: sensitive.id!, personId: sensitive.personId, statement: sensitive.statement }

  // ---- aliases and real names ----
  const aliasFor = (p: P) => {
    const given = givenName(p.label)
    return { mentioned: given.length >= 2 ? `${given.slice(-1)}${given.slice(-1)}` : given ? `小${given}` : p.label, term: addressTermFor(p.persona!, surnameOf(p.label)) }
  }
  const aliased = new Set<P>()
  if (changes[0] && gbReg.includes(changes[0].p)) {
    const a = aliasFor(changes[0].p)
    b.aliasPair(changes[0].p, reviewMixed, a.mentioned, a.term)
    aliased.add(changes[0].p)
  }
  for (const p of r.sample(gbReg.filter((x) => !aliased.has(x) && x.persona?.stage === 'adult'), 39)) {
    const a = aliasFor(p)
    b.aliasPair(p, r.pick([gb1, gb2, reviewMixed]), a.mentioned, a.term)
  }
  for (const p of r.sample(owOthers, 20)) b.aliasPair(p, ow1, givenName(p.label) || p.label, addressTermFor(p.persona!, surnameOf(p.label)))
  for (const [label, value] of Object.entries(SPECIAL_REAL_NAMES)) {
    const p = special(label)
    const s = r.pick(fitting(segsFor(p)))
    b.realName(p, s, value)
  }

  // ---- events: outings among people who share a chat ----
  // nobody goes on the same outing twice (badminton sessions excepted)
  const seenEvent = new Set<string>()
  const summaryOf = new Map(b.t.events.map((e) => [e.id, e.summary]))
  for (const ep of b.t.eventParticipants) seenEvent.add(`${ep.personId}|${summaryOf.get(ep.eventId)}`)
  const ctxOf = (c: C): keyof typeof EVENT_KINDS => (c === groupBig ? 'college' : c === owners ? 'owners' : c === badminton ? 'badminton' : 'private')
  for (let made = 0, guard = 0; made < 110 && guard < 5000; guard++) {
    const s = r.chance(0.1) ? reviewMixed : r.pick(doneSegs)
    const c = s.chat!
    const members = c.members.filter((m) => !m.isSelf && m.persona?.stage !== 'child')
    const ps = c.kind === 'private' ? members.slice(0, 1) : r.sample(members, r.int(1, 3))
    if (c.kind === 'private' || r.chance(0.4)) ps.push(self)
    if (ps.length < 2) continue
    const evDay = r.int(s.toDay, s.fromDay) + r.int(2, 30)
    const d = addDays(o.today, -evDay)
    const ctx = ctxOf(c)
    const kind = r.pick(EVENT_KINDS[ctx])
    if (ctx !== 'badminton' && ps.some((p) => !p.isSelf && seenEvent.has(`${p.id}|一起${kind.phrase}`))) continue
    if (b.event(ps, kind, s, r.chance(0.5) ? { y: d.y, m: d.m, d: d.d } : { y: d.y, m: d.m })) {
      made++
      for (const p of ps) seenEvent.add(`${p.id}|一起${kind.phrase}`)
    }
  }

  // ---- important dates (birth years and wedding years come from personas) ----
  const soonOffsets = [0, 1, 3, 6, 9, 14, 19, 23, 28]
  const married = filler.filter((p) => p.persona?.spouse)
  const annivDone = new Set<number>()
  const annivFor = (p: P) => {
    annivDone.add(p.id)
    if (p.persona!.spouse!.personId !== undefined) annivDone.add(p.persona!.spouse!.personId)
  }
  const datePeople = r.sample(filler, 95)
  datePeople.forEach((p, i) => {
    const pe = p.persona!
    const s = r.pick(fitting(segsFor(p)))
    if (i === 4) {
      const m = married.find((x) => !annivDone.has(x.id)) ?? p
      const d = addDays(o.today, soonOffsets[i])
      if (m.persona?.spouse) {
        annivFor(m)
        b.date(m, { kind: 'anniversary', calendar: 'solar', month: d.m, day: d.d, year: m.persona.spouse.year }, r.pick(fitting(segsFor(m))))
        return
      }
    }
    if (i < soonOffsets.length) {
      const d = addDays(o.today, soonOffsets[i])
      b.date(p, { kind: 'birthday', calendar: 'solar', month: d.m, day: d.d, year: pe.birthYear }, s)
    } else if (i < soonOffsets.length + 15) {
      b.date(p, { kind: 'birthday', calendar: 'lunar', month: r.int(1, 12), day: r.int(1, 29), year: pe.birthYear }, s)
    } else if (i < soonOffsets.length + 25 && pe.spouse && !annivDone.has(p.id)) {
      annivFor(p)
      b.date(p, { kind: 'anniversary', calendar: 'solar', month: r.int(1, 12), day: r.int(1, 28), year: pe.spouse.year }, s)
    } else {
      b.date(p, { kind: 'birthday', calendar: 'solar', month: r.int(1, 12), day: r.int(1, 28), year: r.chance(0.7) ? pe.birthYear : undefined }, s)
    }
  })

  // ---- conversational filler across segments ----
  const fillerPlan: [S, number][] = [[gb1, 70], [gb2, 55], [reviewMixed, 35], [ow1, 55], [reviewEmpty, 25], [bd1, 45], [pl1, 55], [pl2, 45], [hi1, 35], [hv1, 35], [inProgress, 220], [failedWin, 150]]
  for (const [s, n] of fillerPlan) b.filler(s, n)
  b.filler(delSeg, 40 - delSeg.drafts.length)

  b.finalize({ ownerId: owner, selfDisplayNames: ['我是小丽'], extractModel: null, highConfidenceThreshold: 0.8, onboardedAt: b.iso(520), updatedAt: b.iso(520) }, 10)

  return { tables: b.t, r2: b.r2, refs, counts: countTables(b.t) }
}

/** `seed2@xiaoli.test`: 10 persons whose labels overlap seed's, 1 chat, 1 import (isolation checks). */
export function buildIsolationAccount(owner: string, ids: IdAllocator, o: BuildOptions): AccountDataset {
  const b = new Builder(owner, ids, o.today, o.now, '隔离测试', (o.seed ?? SEED_RNG) + 2)
  const r = b.r
  const refs: AccountDataset['refs'] = { persons: {}, imports: {}, chats: {}, claims: {} }
  const self = b.person('我', { isSelf: true, createdDay: 100, gender: 'f' })
  const overlap = generateChineseLabels(createRng((o.seed ?? SEED_RNG) + 1), 181, [...Object.values(TAGGED_LABELS), ...SPECIAL_LABELS]).filter((l) => ['mid', 'mid70'].includes(nameEra(l))).slice(0, 9)
  const people = [b.person(TAGGED_LABELS.longProfile, { gender: 'f' }), ...overlap.map((l) => b.person(l))]
  const importId = ids.next('imports')
  const chat = b.chat('同学群', 'group', [self, ...people], importId, 90)
  const seg = b.seg({ id: importId, chat, status: 'done', fromDay: 90, toDay: 30, createdDay: 29 })
  self.persona = makePersona(r, b.clk, { id: self.id, label: self.label, gender: 'f', birthYear: 1990, school: COLLEGE })
  for (const p of people) p.persona = makePersona(r, b.clk, { id: p.id, label: p.label, gender: p.gender, birthYear: r.int(1989, 1991), school: COLLEGE })
  b.relation(self, people[0], '老朋友', seg)
  for (const p of people) {
    const { facts } = factsOf(p.persona!, b.clk)
    let n = 0
    for (const f of [0, 1, 2].flatMap((tier) => facts.filter((x) => x.tier === tier))) {
      if (n >= 3 || !b.fits(seg, f.window) || f.mentionIds?.length) continue
      b.claim(p, f, { seg, status: 'confirmed' })
      n++
    }
    if (n < 3) throw new Error(`seed2: ${p.label} has too few facts`)
  }
  b.filler(seg, 40)
  b.finalize({ ownerId: owner, selfDisplayNames: ['隔离测试'], extractModel: null, highConfidenceThreshold: 0.8, onboardedAt: b.iso(100), updatedAt: b.iso(100) }, 0)
  refs.persons['overlap-long-profile'] = { id: people[0].id, label: people[0].label }
  refs.chats.group = { id: chat.id, title: chat.title }
  refs.imports.done = { id: seg.id, title: chat.title }
  return { tables: b.t, r2: b.r2, refs, counts: countTables(b.t) }
}

export function countTables(t: SeedTables): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const k of INSERT_ORDER) counts[k] = t[k].length
  counts.visiblePersons = t.persons.filter((p) => !p.isSelf && p.mergedIntoId == null).length
  return counts
}
