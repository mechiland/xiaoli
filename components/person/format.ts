// Pure display helpers for the person page (no React, unit-tested).
import type { Category, HandleKind, ImportantDateDTO, PersonRefDTO, RelationDTO } from '@/contracts'

export const CATEGORY_LABEL: Record<Category, string> = {
  work: '工作',
  location: '所在地',
  education: '教育',
  family: '家庭',
  preference: '偏好与习惯',
  life_event: '经历',
  other: '其他',
}
export const CATEGORY_ORDER: Category[] = ['work', 'location', 'education', 'family', 'preference', 'life_event', 'other']

/** How page copy names the page's person: the user's own page speaks in the first person (我), every other page says TA. */
export function pronoun(isSelf: boolean): '我' | 'TA' {
  return isSelf ? '我' : 'TA'
}

/** Pronoun at the start of a sentence: "TA 是…" keeps the Latin/CJK space, "我是…" has none. */
export function withPronoun(isSelf: boolean, rest: string): string {
  return isSelf ? `我${rest}` : `TA ${rest}`
}

/** Pronoun between Chinese characters: "关于我的" / "关于 TA 的". */
export function inlinePronoun(isSelf: boolean): string {
  return isSelf ? '我' : ' TA '
}

/** Placeholder for the section "补充" input. */
export function categoryHint(category: Category, isSelf: boolean): string {
  const hints: Record<Category, string> = {
    work: '比如：在杭州一家设计公司做合伙人',
    location: '比如：现在住在杭州西湖区',
    education: '比如：在汉中读的高中',
    family: '比如：有一个上小学的女儿',
    preference: '比如：不吃香菜',
    life_event: '比如：2019 年去新疆骑行过一个月',
    other: `写一句关于${inlinePronoun(isSelf)}的事`,
  }
  return hints[category]
}

/** Alias groups shown on the page (SPEC §9.5). `mentioned` (the name in "@显示名") is a group display name. */
export const ALIAS_GROUPS: { label: string; kinds: HandleKind[] }[] = [
  { label: '私聊备注名', kinds: ['display_private'] },
  { label: '群内显示名', kinds: ['display_group', 'mentioned'] },
  { label: '真名', kinds: ['real_name'] },
  { label: '称呼', kinds: ['address_term'] },
]

export const RELATION_TYPE_LABEL: Record<string, string> = {
  parent: '父母',
  child: '子女',
  spouse: '配偶',
  sibling: '兄弟姐妹',
  relative: '亲戚',
  friend: '朋友',
  colleague: '同事',
  classmate: '同学',
  service_provider: '服务方',
  client: '客户',
  other: '其他',
}
const INVERSE_TYPE: Record<string, string> = { parent: 'child', child: 'parent', service_provider: 'client', client: 'service_provider' }

export interface RelationPhrase {
  /** the other person */
  other: PersonRefDTO
  /** what the other person is to this person: every row reads "<term> · <other>" */
  term: string
  /** direction note when the stored label names this person ("TA 是对方的大学同学"), else null */
  note: string | null
}

/**
 * A relation reads `from` 是 `to` 的 `type`, `label` names `from` as seen from `to` (ARCHITECTURE §2.5).
 * On `to`'s page: "<label> · <from>" (妈妈 · 王芳). On `from`'s page the label describes this person, not the other,
 * so the term comes from the type (inverted where the type has an inverse: 父母 ↔ 子女, 服务方 ↔ 客户; `other` →
 * 其他关系) and the label moves into a direction note: "子女 · 林知夏  TA 是对方的妈妈".
 */
export function relationPhrase(
  r: Pick<RelationDTO, 'fromPersonId' | 'from' | 'to' | 'type' | 'label'>,
  personId: number,
  selfId?: number | null,
  /** the page is the user's own person page: the note speaks as 我 ("我是对方的大学同学") */
  pageIsSelf: boolean = selfId != null && personId === selfId,
): RelationPhrase {
  const label = r.label?.trim() || null
  const typeLabel = RELATION_TYPE_LABEL[r.type] ?? r.type
  if (r.fromPersonId !== personId) return { other: r.from, term: label ?? typeLabel, note: null }
  const inv = INVERSE_TYPE[r.type]
  const term = inv ? RELATION_TYPE_LABEL[inv] : r.type === 'other' ? '其他关系' : typeLabel
  const otherIsSelf = !pageIsSelf && selfId != null && r.to.id === selfId
  const note = label && label !== term ? withPronoun(pageIsSelf, `是${otherIsSelf ? '我' : '对方'}的${label}`) : null
  return { other: r.to, term, note }
}

// full-width punctuation whose ink sits in the left half of its em box (centred ！？ are left alone)
const FULLWIDTH_END = /[。，；：、」』）》]$/
/** Pulls a footnote mark up against a full-width punctuation mark (the glyph's empty right half) — "高中。¹". */
export const MARK_TIGHT = '-ml-[0.8em] [&>button]:min-w-0 [&>button]:px-[2px]'
export function markClassFor(text: string): string | undefined {
  return FULLWIDTH_END.test(text.trim()) ? MARK_TIGHT : undefined
}

/** '2024' → '2024年', '2024-05' → '2024年5月', '2024-05-03' → '2024年5月3日' */
export function formatPartialDate(d: string | null | undefined): string {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  if (!m) return `${+y}年`
  if (!day) return `${+y}年${+m}月`
  return `${+y}年${+m}月${+day}日`
}

/** 'YYYY-MM-DD' → '9月25日' (with the year when it differs from `thisYear`). */
export function formatSolarDay(solar: string, thisYear?: number): string {
  const [y, m, d] = solar.split('-').map(Number)
  return thisYear !== undefined && y !== thisYear ? `${y}年${m}月${d}日` : `${m}月${d}日`
}

export function daysText(days: number): string {
  if (days === 0) return '就是今天'
  if (days === 1) return '明天'
  return `还有 ${days} 天`
}

const DATE_KIND_LABEL: Record<string, string> = { birthday: '生日', anniversary: '纪念日', memorial: '纪念日', other: '重要日期' }

/** Name of a date row: its label, else the kind in Chinese. */
export function dateName(d: Pick<ImportantDateDTO, 'kind' | 'label'>): string {
  return d.label?.trim() || DATE_KIND_LABEL[d.kind] || d.kind
}

const CN_MONTH = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']
const CN_DAY_TENS = ['初', '十', '廿', '三']
const CN_DIGIT = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
function lunarDayName(day: number): string {
  if (day === 10) return '初十'
  if (day === 20) return '二十'
  if (day === 30) return '三十'
  return CN_DAY_TENS[Math.floor(day / 10)] + CN_DIGIT[day % 10]
}

/** The date as written: '农历八月十五' / '农历闰六月初一' / '3月1日' / '1990年3月1日'. */
export function dateAsWritten(d: Pick<ImportantDateDTO, 'calendar' | 'month' | 'day' | 'year' | 'isLeapMonth' | 'next'>): string {
  if (d.month == null || d.day == null) return d.year ? `${d.year}年` : ''
  if (d.calendar === 'lunar') {
    if (d.next?.lunarLabel) return d.next.lunarLabel
    return `农历${d.isLeapMonth ? '闰' : ''}${CN_MONTH[d.month - 1]}月${lunarDayName(d.day)}`
  }
  return d.year ? `${d.year}年${d.month}月${d.day}日` : `${d.month}月${d.day}日`
}

/** 'YYYY-MM-DD HH:MM' → '2026年9月1日' */
export function formatMsgDay(t: string | null): string {
  if (!t) return ''
  const [y, m, d] = t.slice(0, 10).split('-').map(Number)
  return `${y}年${m}月${d}日`
}

/** ISO → 'YYYY年M月D日' in Asia/Shanghai */
export function formatIsoDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return `${get('year')}年${get('month')}月${get('day')}日`
}

export type StatementPart = { text: string } | { text: string; person: PersonRefDTO }

/** Splits a statement so the first occurrence of each mentioned person's label becomes a link part (longest labels first). */
export function linkMentions(statement: string, mentions: PersonRefDTO[], selfId?: number | null): StatementPart[] {
  const hits: { start: number; end: number; person: PersonRefDTO }[] = []
  const sorted = mentions.filter((m) => m.label && m.id !== selfId).sort((a, b) => b.label.length - a.label.length)
  for (const m of sorted) {
    let from = 0
    while (from <= statement.length) {
      const i = statement.indexOf(m.label, from)
      if (i < 0) break
      const end = i + m.label.length
      if (!hits.some((h) => i < h.end && end > h.start)) {
        hits.push({ start: i, end, person: m })
        break
      }
      from = i + 1
    }
  }
  hits.sort((a, b) => a.start - b.start)
  const parts: StatementPart[] = []
  let at = 0
  for (const h of hits) {
    if (h.start > at) parts.push({ text: statement.slice(at, h.start) })
    parts.push({ text: statement.slice(h.start, h.end), person: h.person })
    at = h.end
  }
  if (at < statement.length) parts.push({ text: statement.slice(at) })
  return parts
}

/** Ensures a sentence ends with terminal punctuation before the footnote mark ("在汉中读高中。¹"). */
export function sentence(text: string): string {
  const t = text.trim()
  return /[。！？.!?…」』”）)]$/.test(t) ? t : `${t}。`
}

/** Anchor in a location hash: '#claim-12' → { type: 'claim', id: 12 }. */
export function parseAnchor(hash: string): { type: 'claim' | 'relation' | 'date' | 'event' | 'handle'; id: number } | null {
  const m = /^#?(claim|relation|date|event|handle)-(\d+)$/.exec(hash)
  return m ? { type: m[1] as 'claim', id: Number(m[2]) } : null
}
