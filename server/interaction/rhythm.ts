// Rhythm derivation (SPEC §7 交互层, §9.5). Pure — nothing here is ever stored.
import { MIN_RHYTHM_CONVERSATIONS, type RhythmDTO } from '@/contracts'
import { daysBetween } from '@/lib/time'
import type { RhythmConversation } from './types'

const EMPTY: RhythmDTO = {
  conversationCount: 0,
  conversationCountThisYear: 0,
  lastAt: null,
  daysSinceLast: null,
  medianGapDays: null,
  initiatedByMe: null,
  initiatedByThem: null,
  privateOnly: false,
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * `today` is a 'YYYY-MM-DD' day in APP_TZ.
 *
 * A description, not a nag: under MIN_RHYTHM_CONVERSATIONS conversations only the last contact and the totals are
 * reported (`medianGapDays` stays null — three chats are not a rhythm). "Who spoke first" is counted over private
 * conversations only; group reply attribution is ambiguous and the export has no seconds (SPEC §6).
 */
export function deriveRhythm(conversations: RhythmConversation[], today: string): RhythmDTO {
  if (conversations.length === 0) return { ...EMPTY }
  const sorted = [...conversations].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const year = today.slice(0, 4)

  const lastAt = sorted.reduce((m, c) => (c.endedAt > m ? c.endedAt : m), sorted[0].endedAt)

  let medianGapDays: number | null = null
  if (sorted.length >= MIN_RHYTHM_CONVERSATIONS) {
    const gaps: number[] = []
    for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1].startedAt.slice(0, 10), sorted[i].startedAt.slice(0, 10)))
    medianGapDays = Math.round(median(gaps) * 10) / 10
  }

  const attributable = sorted.filter((c) => c.chatKind === 'private' && c.initiator !== null)
  const hasAttribution = attributable.length > 0

  return {
    conversationCount: sorted.length,
    conversationCountThisYear: sorted.filter((c) => c.startedAt.slice(0, 4) === year).length,
    lastAt,
    daysSinceLast: Math.max(0, daysBetween(lastAt.slice(0, 10), today)),
    medianGapDays,
    initiatedByMe: hasAttribution ? attributable.filter((c) => c.initiator === 'me').length : null,
    initiatedByThem: hasAttribution ? attributable.filter((c) => c.initiator === 'them').length : null,
    privateOnly: sorted.every((c) => c.chatKind === 'private'),
  }
}
