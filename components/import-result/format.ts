// Pure helpers for the import result page (no React, no server imports) — unit-tested in format.test.ts.
import type {
  Category,
  ClaimDTO,
  HandleKind,
  ImportantDateDTO,
  ImportReviewResponse,
  LoopDTO,
  LoopKind,
  PartialDate,
  ProfileResponse,
  Progress,
  ReviewItem,
  Status,
  TargetType,
} from '@/contracts'
import { DEFAULT_TZ, formatIsoDate } from '@/lib/time'

export type Review = ImportReviewResponse
export type ReviewSection = Review['sections'][number]
export type GroupName = 'newClaims' | 'changes' | 'aliasesAndRelations' | 'dates' | 'events' | 'loops'

// SPEC §9.9 order: 新人物, 新信息, 变化, 别名与关系, 日期, (事件, IR4), 未结事项 last — it is the only group about
// what happens next rather than who the person is.
export const GROUPS: GroupName[] = ['newClaims', 'changes', 'aliasesAndRelations', 'dates', 'events', 'loops']

export const GROUP_TITLE: Record<GroupName, string> = {
  newClaims: '新信息',
  changes: '变化',
  aliasesAndRelations: '别名与关系',
  dates: '日期',
  events: '事件',
  loops: '未结事项',
}

export const CATEGORY_LABEL: Record<Category, string> = {
  work: '工作',
  location: '所在地',
  education: '教育',
  family: '家庭',
  preference: '偏好与习惯',
  life_event: '经历',
  other: '其他',
}

export const HANDLE_KIND_LABEL: Record<HandleKind, string> = {
  display_private: '私聊显示名',
  display_group: '群内显示名',
  mentioned: '被@的名字',
  real_name: '真名',
  address_term: '称呼',
}

const RELATION_TYPE_LABEL: Record<string, string> = {
  parent: '父母',
  child: '孩子',
  spouse: '伴侣',
  sibling: '兄弟姐妹',
  relative: '亲戚',
  friend: '朋友',
  colleague: '同事',
  classmate: '同学',
  service_provider: '服务者',
  client: '客户',
  other: '相识的人',
}

const DATE_KIND_LABEL: Record<string, string> = {
  birthday: '生日',
  anniversary: '纪念日',
  memorial: '逝世纪念日',
  other: '日子',
}

export const STATUS_LABEL: Record<Status, string> = {
  proposed: '',
  confirmed: '已确认',
  rejected: '已划掉',
  superseded: '已被取代',
}

export const itemKey = (type: TargetType, id: number) => `${type}:${id}`
export const reviewItemKey = (it: ReviewItem) => itemKey(it.type, it.item.id)

// ---- text -------------------------------------------------------------------------------------------------------

/** For MsgTime values ('YYYY-MM-DD HH:MM', wall time of the export) only — IsoString values go through formatIsoDate. */
function ymd(msgTime: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(msgTime)
  return m ? [+m[1], +m[2], +m[3]] : null
}

/** '2026-09-03 08:03','2026-09-11 23:26' → '2026年9月3日 – 9月11日' (year repeated only when it changes). */
export function formatDateRange(from: string | null, to: string | null): string {
  const a = from ? ymd(from) : null
  const b = to ? ymd(to) : null
  if (!a && !b) return ''
  if (!a || !b) {
    const d = (a ?? b)!
    return `${d[0]}年${d[1]}月${d[2]}日`
  }
  const left = `${a[0]}年${a[1]}月${a[2]}日`
  if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) return left
  const right = a[0] === b[0] ? `${b[1]}月${b[2]}日` : `${b[0]}年${b[1]}月${b[2]}日`
  return `${left} – ${right}`
}

/** '2026' → '2026年', '2026-09' → '2026年9月', '2026-09-03' → '2026年9月3日' */
export function formatPartialDate(d: PartialDate | null | undefined): string {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  let out = `${+y}年`
  if (m) out += `${+m}月`
  if (day) out += `${+day}日`
  return out
}

const LUNAR_MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']
const LUNAR_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

export function lunarDayName(day: number): string {
  if (day === 10) return '初十'
  if (day === 20) return '二十'
  if (day === 30) return '三十'
  const prefix = day < 10 ? '初' : day < 20 ? '十' : '廿'
  return prefix + LUNAR_DIGITS[(day % 10) - 1]
}

export function dateKindLabel(d: Pick<ImportantDateDTO, 'kind' | 'label'>): string {
  return d.label?.trim() || DATE_KIND_LABEL[d.kind] || d.kind
}

/** "12月3日", "1990年12月3日", "农历腊月初八", "农历闰四月十五" */
export function formatImportantDate(d: Pick<ImportantDateDTO, 'calendar' | 'isLeapMonth' | 'year' | 'month' | 'day'>): string {
  if (!d.month) return d.year ? `${d.year}年` : '日子不详'
  const year = d.year ? `${d.year}年` : ''
  if (d.calendar === 'lunar') {
    const month = `${d.isLeapMonth ? '闰' : ''}${LUNAR_MONTHS[d.month - 1] ?? d.month}月`
    return `农历${year}${month}${d.day ? lunarDayName(d.day) : ''}`
  }
  return `${year}${d.month}月${d.day ? `${d.day}日` : ''}`
}

export function nextOccurrenceNote(d: Pick<ImportantDateDTO, 'next' | 'calendar'>): string {
  if (!d.next) return ''
  if (d.next.days === 0) return '就是今天'
  const [, m, day] = d.next.solar.split('-').map(Number)
  return d.calendar === 'lunar' ? `今年是${m}月${day}日 · 还有 ${d.next.days} 天` : `还有 ${d.next.days} 天`
}

export function relationWord(r: { type: string; label: string | null }): string {
  return r.label?.trim() || RELATION_TYPE_LABEL[r.type] || r.type
}

/** The user's own person reads as 我 on this page, as it does on the person page (person P7): "我是林知夏的爸爸". */
export function personLabel(p: { id: number; label: string }, selfId: number | null | undefined): string {
  return selfId != null && p.id === selfId ? '我' : p.label
}

/** Plain text of a relation row: "from是to的word", self endpoints as 我 (the row renders the same parts with links). */
export function relationText(r: { from: { id: number; label: string }; to: { id: number; label: string }; type: string; label: string | null }, selfId: number | null | undefined): string {
  return `${personLabel(r.from, selfId)}是${personLabel(r.to, selfId)}的${relationWord(r)}`
}

/** People named under an empty result: at most `max`, self as 我, plus how many more ("等 12 人"). */
export function peopleLine(persons: { id: number; label: string }[], selfId: number | null | undefined, max = 8): { shown: { id: number; label: string }[]; more: number } {
  return { shown: persons.slice(0, max).map((p) => ({ id: p.id, label: personLabel(p, selfId) })), more: Math.max(0, persons.length - max) }
}

const squash = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase()

/** A handle that only repeats the person's own label ("又名「王小明」" in 王小明's section) adds nothing new. */
export function isLabelEcho(value: string, label: string): boolean {
  const v = squash(value)
  return v !== '' && v === squash(label)
}

/**
 * One line that tells two people with the same label apart (其实是…… picker rows and confirm step):
 * "『装修群』等 2 个聊天 · 3 个别名 · 5 条信息 · 2026年9月3日建立"; a hand-made empty person reads
 * "没有聊天记录 · 还没有信息 · 2026年9月3日建立".
 */
export function personContext(p: ProfileResponse, tz: string = DEFAULT_TZ): string {
  return personContextParts(p, tz).join(' · ')
}

/** The pieces of `personContext`, so the dialog can keep each piece (the date above all) on one line. */
export function personContextParts(p: ProfileResponse, tz: string = DEFAULT_TZ): string[] {
  const parts: string[] = []
  const chats = p.infobox.chats
  if (chats.length === 0) parts.push('没有聊天记录')
  else parts.push(chats.length === 1 ? `『${chats[0].chat.title}』` : `『${chats[0].chat.title}』等 ${chats.length} 个聊天`)
  const aliases = new Set<string>()
  for (const g of p.aliases) for (const h of g.items) if (h.status !== 'rejected' && h.status !== 'superseded' && !isLabelEcho(h.value, p.person.label)) aliases.add(squash(h.value))
  if (aliases.size > 0) parts.push(`${aliases.size} 个别名`)
  const claims = p.sections.reduce((n, s) => n + s.claims.filter((c) => c.status === 'confirmed' || c.status === 'proposed').length, 0)
  parts.push(claims > 0 ? `${claims} 条信息` : chats.length === 0 && aliases.size === 0 ? '还没有信息' : '')
  // createdAt is an IsoString (UTC): the calendar day is taken in APP_TZ, like every other date the user sees
  const created = p.person.createdAt ? formatIsoDate(p.person.createdAt, tz) : ''
  if (created) parts.push(`${created}建立`)
  return parts.filter(Boolean)
}

/** A context piece that may break inside: only the chat names ("『…』等 2 个聊天"); counts and the date never do. */
export const isWrappablePiece = (piece: string) => piece.startsWith('『')

/**
 * The picker-row version (PersonPicker gives the label and its reason one line): no dates, no chat list, so the label
 * itself is not squeezed into "林…". "4 个聊天 · 11 个别名 · 57 条信息"; a person made by hand "没有聊天记录 · 2026年9月3日建立".
 */
export function personContextShort(p: ProfileResponse, tz: string = DEFAULT_TZ): string {
  const chats = p.infobox.chats
  const title = chats[0]?.chat.title ?? ''
  const parts = [chats.length === 0 ? '没有聊天记录' : chats.length === 1 ? `『${title.length > 8 ? `${title.slice(0, 8)}…` : title}』` : `${chats.length} 个聊天`]
  const full = personContextParts(p, tz)
  for (const part of full) if (/个别名$|条信息$/.test(part)) parts.push(part)
  if (parts.length === 1 && chats.length === 0) parts.push(full[full.length - 1])
  return parts.join(' · ')
}

export function editableText(it: ReviewItem): string {
  switch (it.type) {
    case 'claim':
      return it.item.statement
    case 'handle':
      return it.item.value
    case 'relation':
      return relationWord(it.item)
    case 'event':
      return it.item.summary
    case 'date':
      return formatImportantDate(it.item)
    // the raw text as the extraction wrote it ("把清单发过去"), not the rendered sentence: the direction is not
    // part of the text and must not end up inside it when the user saves
    case 'loop':
      return it.item.text
  }
}

// ---- 未结事项 (SPEC §9.9, §7 交互层) -------------------------------------------------------------------------------

// The loop wording lives in `@/lib/loop-text` so the person page words the same loop identically
// (core-request import-result#4).
export { LOOP_KIND_LABEL, loopSentence, loopStateLabel } from '@/lib/loop-text'

/** "2026年9月13日起" — when the thing opened, in small type at the end of the row (SPEC §9.9). */
export function loopOpenedLabel(openedAt: string): string {
  const d = ymd(openedAt)
  return d ? `${d[0]}年${d[1]}月${d[2]}日起` : ''
}

/** A 约定 also carries the day it is for; everything else is described by its own sentence. */
export function loopDueLabel(loop: Pick<LoopDTO, 'kind' | 'dueAt'>): string | null {
  return loop.kind === 'plan' && loop.dueAt ? `约在${formatPartialDate(loop.dueAt)}` : null
}

/**
 * Which "nothing here" copy a finished import with no sections gets. Jobs are windows over the messages that were new
 * at mapping, so `progress.total === 0` means nothing was read (a re-export whose messages were all stored already).
 * `newMessageCount` alone is not enough: deleting the earlier import hands its messages to this one and recounts it.
 * No windows but a message count > 0 is exactly that recount: the messages were read by the earlier import, which is
 * gone now ('read-before'). The SPEC §9.9 copy is only for an extraction that ran and found nothing.
 */
export function emptyResultKind(imp: { newMessageCount: number } | undefined, progress: Progress | undefined): 'nothing-new' | 'read-before' | 'no-output' {
  if (progress?.total === 0) return (imp?.newMessageCount ?? 0) > 0 ? 'read-before' : 'nothing-new'
  if (imp?.newMessageCount === 0 && !progress?.total) return 'nothing-new'
  return 'no-output'
}

/** Header: a finished import whose messages were reassigned from a deleted import ("36 条消息", not "新增 36 条消息"). */
export function messagesReadBefore(imp: { newMessageCount: number; status: string } | undefined, progress: Progress | undefined): boolean {
  return !!imp && imp.status !== 'extracting' && imp.status !== 'mapping' && emptyResultKind(imp, progress) === 'read-before'
}

// ---- progress ---------------------------------------------------------------------------------------------------

/** "正在读取 3 / 8 段对话": the window being read now (processed + 1, capped), bar = processed share. */
export function readingProgress(p: Progress): { current: number; total: number; ratio: number } {
  const processed = p.done + p.failed
  const total = p.total
  return { current: Math.max(1, Math.min(processed + 1, total)), total, ratio: total > 0 ? Math.min(1, processed / total) : 0 }
}

// ---- review data ------------------------------------------------------------------------------------------------

export function sectionItems(s: ReviewSection): ReviewItem[] {
  return GROUPS.flatMap((g) => s[g])
}

export function proposedItems(s: ReviewSection): ReviewItem[] {
  return sectionItems(s).filter((it) => it.item.status === 'proposed')
}

/** Client-side view of the flags, so they follow optimistic cache updates. */
export function deriveReview(r: Review): { allHandled: boolean; highConfidence: { type: 'claim'; id: number }[]; persons: { id: number; label: string }[] } {
  const status = new Map<string, Status>()
  for (const s of r.sections) for (const it of sectionItems(s)) status.set(reviewItemKey(it), it.item.status)
  const highConfidence = r.highConfidence.filter((h) => status.get(itemKey('claim', h.id)) === 'proposed')
  const allHandled = r.sections.length > 0 && [...status.values()].every((st) => st !== 'proposed')
  return { allHandled, highConfidence, persons: r.sections.map((s) => ({ id: s.person.id, label: s.person.label })) }
}

/** Claims grouped by category in the order they arrive (server sorts work → other). */
export function byCategory(items: ReviewItem[]): { category: Category; items: ReviewItem[] }[] {
  const out: { category: Category; items: ReviewItem[] }[] = []
  for (const it of items) {
    const cat = it.type === 'claim' ? it.item.category : 'other'
    const last = out[out.length - 1]
    if (last && last.category === cat) last.items.push(it)
    else out.push({ category: cat, items: [it] })
  }
  return out
}

type AnyItem = ReviewItem['item']

/** Replace an item (and any `replaces` claim among `superseded`) everywhere it appears. Returns a new object. */
export function applyItemUpdate(r: Review, type: TargetType, item: AnyItem, superseded: ClaimDTO[] = []): Review {
  const sup = new Map(superseded.map((c) => [c.id, c]))
  const fix = (it: ReviewItem): ReviewItem => {
    let next = it
    if (it.type === type && it.item.id === item.id) next = { ...it, item } as ReviewItem
    if (next.type === 'claim') {
      if (type === 'claim' && next.replaces && next.replaces.id === item.id) next = { ...next, replaces: item as ClaimDTO }
      if (next.replaces && sup.has(next.replaces.id)) next = { ...next, replaces: sup.get(next.replaces.id)! }
      if (sup.has(next.item.id)) next = { ...next, item: sup.get(next.item.id)! }
    }
    return next
  }
  return {
    ...r,
    sections: r.sections.map((s) => ({
      ...s,
      newClaims: s.newClaims.map(fix),
      changes: s.changes.map(fix),
      aliasesAndRelations: s.aliasesAndRelations.map(fix),
      dates: s.dates.map(fix),
      events: s.events.map(fix),
      loops: s.loops.map(fix),
    })),
  }
}

/** Optimistic status change for a set of keys (bulk). Accepting a change marks its old claim superseded. */
export function applyStatus(r: Review, keys: Set<string>, status: Status): Review {
  const fix = (it: ReviewItem): ReviewItem => {
    if (!keys.has(reviewItemKey(it)) || it.item.status !== 'proposed') return it
    const item = { ...it.item, status }
    if (it.type === 'claim' && it.replaces && status === 'confirmed' && (it.replaces.status === 'confirmed' || it.replaces.status === 'proposed')) {
      return { ...it, item: item as ClaimDTO, replaces: { ...it.replaces, status: 'superseded', statusReason: 'superseded' } }
    }
    return { ...it, item } as ReviewItem
  }
  return {
    ...r,
    sections: r.sections.map((s) => ({
      ...s,
      newClaims: s.newClaims.map(fix),
      changes: s.changes.map(fix),
      aliasesAndRelations: s.aliasesAndRelations.map(fix),
      dates: s.dates.map(fix),
      events: s.events.map(fix),
      loops: s.loops.map(fix),
    })),
  }
}

export function renamePerson(r: Review, personId: number, label: string): Review {
  const ref = (p: { id: number; label: string }) => (p.id === personId ? { ...p, label } : p)
  const fix = (it: ReviewItem): ReviewItem => {
    if (it.type === 'relation') return { ...it, item: { ...it.item, from: ref(it.item.from), to: ref(it.item.to) } }
    if (it.type === 'event') return { ...it, item: { ...it.item, participants: it.item.participants.map(ref) } }
    return it
  }
  return {
    ...r,
    sections: r.sections.map((s) => ({
      ...s,
      person: s.person.id === personId ? { ...s.person, label } : s.person,
      aliasesAndRelations: s.aliasesAndRelations.map(fix),
      events: s.events.map(fix),
    })),
  }
}

/** Page-scoped footnote numbers in render order: `${key}` for an item, `old:${claimId}` for the left side of a change. */
export function markIndexes(r: Review): Map<string, number> {
  const out = new Map<string, number>()
  let n = 0
  for (const s of r.sections) {
    for (const g of GROUPS) {
      const list = g === 'newClaims' ? byCategory(s.newClaims).flatMap((c) => c.items) : s[g]
      for (const it of list) {
        if (g === 'changes' && it.type === 'claim' && it.replaces) out.set(`old:${s.person.id}:${it.replaces.id}`, ++n)
        out.set(`${s.person.id}:${reviewItemKey(it)}`, ++n)
      }
    }
  }
  return out
}
