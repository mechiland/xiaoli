// Pure helpers for the import result page (no React, no server imports) — unit-tested in format.test.ts.
import type {
  Category,
  ClaimDTO,
  HandleKind,
  ImportantDateDTO,
  ImportReviewResponse,
  PartialDate,
  Progress,
  ReviewItem,
  Status,
  TargetType,
} from '@/contracts'

export type Review = ImportReviewResponse
export type ReviewSection = Review['sections'][number]
export type GroupName = 'newClaims' | 'changes' | 'aliasesAndRelations' | 'dates' | 'events'

export const GROUPS: GroupName[] = ['newClaims', 'changes', 'aliasesAndRelations', 'dates', 'events']

export const GROUP_TITLE: Record<GroupName, string> = {
  newClaims: '新信息',
  changes: '变化',
  aliasesAndRelations: '别名与关系',
  dates: '日期',
  events: '事件',
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
  }
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
