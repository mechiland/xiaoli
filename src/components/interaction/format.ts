// Pure display helpers for the 来往 section (no React, unit-tested). SPEC §9.5.
import { MIN_RHYTHM_CONVERSATIONS, type ConversationDTO, type LoopDTO, type RhythmDTO } from '@/contracts'
import { dueDay } from '@/lib/loop-state'

const DAY = /^(\d{4})-(\d{2})-(\d{2})/

function parts(day: string): [number, number, number] | null {
  const m = DAY.exec(day)
  return m ? [+m[1], +m[2], +m[3]] : null
}

/** '9月13日'; with the year when it is not the year of `today`. */
export function formatDay(day: string, today: string): string {
  const p = parts(day)
  const t = parts(today)
  if (!p) return day
  return t && t[0] === p[0] ? `${p[1]}月${p[2]}日` : `${p[0]}年${p[1]}月${p[2]}日`
}

/** '今天' | '昨天' | '3 天前' */
export function agoLabel(days: number): string {
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  return `${days} 天前`
}

/** '今天' | '明天' | '后天' | '还有 12 天' — the same wording the home page's 即将到来 uses. */
export function daysLabel(days: number): string {
  if (days <= 0) return '今天'
  if (days === 1) return '明天'
  if (days === 2) return '后天'
  return `还有 ${days} 天`
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
export function weekday(day: string): string {
  const p = parts(day)
  return p ? WEEKDAYS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()] : ''
}

/**
 * The 节奏 block: one prose sentence, never a chart or a stat card, and a description rather than a nag (SPEC §9.5).
 *
 * Under MIN_RHYTHM_CONVERSATIONS conversations only the last contact and the total are said — three chats are not a
 * rhythm, so no average gap is claimed. "Who spoke first" only appears when private chats made it attributable.
 * Returns null when there is nothing to say at all, so the block disappears instead of printing a zero.
 */
export function rhythmSentence(r: RhythmDTO, today: string): string | null {
  if (r.conversationCount === 0 || r.lastAt === null) return null
  const clauses: string[] = []

  const thisYear = r.conversationCountThisYear
  if (thisYear > 0 && thisYear < r.conversationCount) clauses.push(`今年聊过 ${thisYear} 次，一共 ${r.conversationCount} 次`)
  else if (thisYear > 0) clauses.push(`今年聊过 ${thisYear} 次`)
  else clauses.push(`一共聊过 ${r.conversationCount} 次`)

  const day = formatDay(r.lastAt.slice(0, 10), today)
  clauses[0] += `，最近一次 ${day}`
  if (r.daysSinceLast !== null && r.daysSinceLast > 0) clauses[0] += `（${agoLabel(r.daysSinceLast)}）`

  if (r.medianGapDays !== null && r.medianGapDays > 0) {
    const gap = Number.isInteger(r.medianGapDays) ? String(r.medianGapDays) : r.medianGapDays.toFixed(1)
    clauses.push(`大约每 ${gap} 天一次`)
  }

  const me = r.initiatedByMe
  const them = r.initiatedByThem
  // the same sample rule as the average gap: under MIN_RHYTHM_CONVERSATIONS only the last contact and the total
  if (me !== null && them !== null && me + them >= 3 && r.conversationCount >= MIN_RHYTHM_CONVERSATIONS) {
    const total = me + them
    if (me / total >= 0.6) clauses.push('多数是你先开口')
    else if (them / total >= 0.6) clauses.push('多数是对方先开口')
    else clauses.push('你们先开口的次数差不多')
  }

  return `${clauses.join('；')}。`
}

/** "9月13日 · 『同学群』 · 42 条 · 搬家、孩子择校" — the chat name only for groups (SPEC §9.5). */
export interface ConversationLine {
  day: string
  chatTitle: string | null
  count: string
  topics: string | null
}

export function conversationLine(c: ConversationDTO, today: string): ConversationLine {
  return {
    day: formatDay(c.startedAt.slice(0, 10), today),
    chatTitle: c.chatKind === 'group' ? c.chatTitle : null,
    count: `${c.messageCount} 条`,
    topics: c.topics.length > 0 ? c.topics.join('、') : null,
  }
}

/** Sentence-final period, as claims get one (SPEC §9.5 renders each item as a sentence). */
export function sentence(text: string): string {
  const t = text.trim()
  if (!t) return t
  return /[。．.!！?？…、，,;；:：]$/.test(t) ? t : `${t}。`
}

/** The small "开启日期" note at the end of an unfinished item. */
export function openedLabel(loop: LoopDTO, today: string): string {
  return `${formatDay(loop.openedAt.slice(0, 10), today)}起`
}

/** "已过去 N 天" for an expired item: since its due date, or since it was opened (SPEC §7 交互层 14 天 / 90 天). */
export function pastLabel(loop: LoopDTO, today: string): string {
  const from = loop.dueAt ? dueDay(loop.dueAt) : loop.openedAt.slice(0, 10)
  const days = Math.max(0, dayDiff(from, today))
  return `已过去 ${days} 天`
}

function dayDiff(a: string, b: string): number {
  const pa = parts(a)
  const pb = parts(b)
  if (!pa || !pb) return 0
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86_400_000)
}

/** 约定 rows carry their date; everything else is described by its own sentence. */
export function planDueLabel(loop: LoopDTO, today: string): string | null {
  if (loop.kind !== 'plan' || !loop.dueAt) return null
  const solar = dueDay(loop.dueAt)
  const days = dayDiff(today, solar)
  const day = formatDay(solar, today)
  return days >= 0 ? `${day} · ${daysLabel(days)}` : day
}

/** Superscript marks after a full-width period need pulling back; same rule as the person page's claims. */
const FULLWIDTH_END = /[。，、；：？！）】」』]$/
export const MARK_TIGHT = '-ml-[0.8em] [&>button]:min-w-0 [&>button]:px-[2px]'
export function markClassFor(text: string): string | undefined {
  return FULLWIDTH_END.test(text.trim()) ? MARK_TIGHT : undefined
}
