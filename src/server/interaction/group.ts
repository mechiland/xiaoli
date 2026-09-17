// Conversation aggregation (SPEC §7 交互层). Pure.
import { SESSION_GAP_HOURS } from '@/contracts'
import { minutesBetween } from '@/lib/time'
import type { GroupableSegment, SegmentGroup } from './types'

/**
 * Segments of one chat less than SESSION_GAP_HOURS apart form a conversation. Same boundary rule as
 * `planWindows` (SPEC §8.5), from the same constant — conversations are never stored, precisely because this
 * boundary moves when a later import fills in the messages between two segments.
 *
 * Input order does not matter (imports arrive out of order). Groups come back oldest first, and so do the segments
 * inside each group; callers that show a timeline reverse it.
 */
export function groupSegments<T extends GroupableSegment>(segments: T[]): SegmentGroup<T>[] {
  const byChat = new Map<number, T[]>()
  for (const s of segments) {
    const list = byChat.get(s.chatId)
    if (list) list.push(s)
    else byChat.set(s.chatId, [s])
  }

  const groups: SegmentGroup<T>[] = []
  for (const [chatId, list] of byChat) {
    list.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.startSeq - b.startSeq || a.endSeq - b.endSeq)
    let current: SegmentGroup<T> | null = null
    for (const s of list) {
      // a later import can fill the gap between two segments, so the same two segments merge on the next read
      const joins = current !== null && minutesBetween(current.endedAt, s.startedAt) <= SESSION_GAP_HOURS * 60
      if (current && joins) {
        current.segments.push(s)
        current.messageCount += s.messageCount
        if (s.endedAt > current.endedAt) current.endedAt = s.endedAt
      } else {
        current = { chatId, startedAt: s.startedAt, endedAt: s.endedAt, messageCount: s.messageCount, segments: [s] }
        groups.push(current)
      }
    }
  }
  groups.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.chatId - b.chatId)
  return groups
}
