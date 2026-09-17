// Pure transcript layout: day groups → runs of consecutive messages from one sender (SPEC §9.10). Owner: chat.
import type { MessageDTO } from '@/contracts'
import { minutesBetween } from '@/lib/time'

/** A run breaks after this many minutes of silence even when the sender stays the same. DECISIONS chat C4. */
export const RUN_GAP_MINUTES = 30

export interface Run {
  key: string
  senderKey: string
  messages: MessageDTO[]
}
export interface DayGroup {
  day: string // 'YYYY-MM-DD'
  runs: Run[]
}

/** System lines ("x 加入了群聊") stand alone: they never join or continue a sender's run. DECISIONS chat C9. */
export function senderKey(m: Pick<MessageDTO, 'id' | 'kind' | 'senderPersonId' | 'senderName'>): string {
  if (m.kind === 'system') return `s:${m.id}`
  return m.senderPersonId != null ? `p:${m.senderPersonId}` : `n:${m.senderName}`
}

export function groupTranscript(messages: MessageDTO[], gapMinutes = RUN_GAP_MINUTES): DayGroup[] {
  const days: DayGroup[] = []
  let day: DayGroup | null = null
  let run: Run | null = null
  let prev: MessageDTO | null = null
  for (const m of messages) {
    const d = m.sentAt.slice(0, 10)
    if (!day || day.day !== d) {
      day = { day: d, runs: [] }
      days.push(day)
      run = null
    }
    const sk = senderKey(m)
    if (!run || !prev || run.senderKey !== sk || minutesBetween(prev.sentAt, m.sentAt) > gapMinutes) {
      run = { key: `r${m.id}`, senderKey: sk, messages: [] }
      day.runs.push(run)
    }
    run.messages.push(m)
    prev = m
  }
  return days
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

/** '2026-04-12' → '2026年4月12日 星期日' */
export function formatDay(day: string): string {
  const [y, mo, d] = day.split('-').map(Number)
  if (!y || !mo || !d) return day
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
  return `${y}年${mo}月${d}日 ${WEEKDAYS[wd]}`
}
