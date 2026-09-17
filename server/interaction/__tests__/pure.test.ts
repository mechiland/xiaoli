import { describe, expect, it } from 'vitest'
import { LOOP_EXPIRY_DAYS_NO_DUE, LOOP_EXPIRY_DAYS_WITH_DUE, MIN_RHYTHM_CONVERSATIONS, SESSION_GAP_HOURS } from '@/contracts'
import { groupSegments } from '../group'
import { daysPastDue, loopState, partialDateEnd } from '../loop-state'
import { deriveRhythm } from '../rhythm'
import type { GroupableSegment, LoopLike, RhythmConversation } from '../types'

let nextSeq = 0
function seg(chatId: number, startedAt: string, endedAt: string, messageCount = 10): GroupableSegment & { tag: string } {
  const startSeq = (nextSeq += 1) * 1024
  return { chatId, startSeq, endSeq: startSeq + 512, startedAt, endedAt, messageCount, tag: `${chatId}@${startedAt}` }
}

describe('groupSegments', () => {
  it('splits on a gap longer than SESSION_GAP_HOURS and keeps chats apart', () => {
    expect(SESSION_GAP_HOURS).toBe(3)
    const a = seg(1, '2026-09-13 19:00', '2026-09-13 20:00')
    const b = seg(1, '2026-09-13 22:00', '2026-09-13 22:40') // 2 h after a
    const c = seg(1, '2026-09-14 09:00', '2026-09-14 09:30') // 10 h after b
    const other = seg(2, '2026-09-13 19:30', '2026-09-13 19:40')
    const groups = groupSegments([a, b, c, other])
    expect(groups.map((g) => g.segments.map((s) => s.tag))).toEqual([
      [a.tag, b.tag],
      [other.tag],
      [c.tag],
    ])
    expect(groups[0].messageCount).toBe(20)
    expect(groups[0].startedAt).toBe('2026-09-13 19:00')
    expect(groups[0].endedAt).toBe('2026-09-13 22:40')
  })

  it('exactly SESSION_GAP_HOURS apart is still one conversation, one minute more is not', () => {
    const a = seg(1, '2026-09-13 19:00', '2026-09-13 20:00')
    const on = seg(1, '2026-09-13 23:00', '2026-09-13 23:10')
    expect(groupSegments([a, on])).toHaveLength(1)
    const off = seg(1, '2026-09-13 23:01', '2026-09-13 23:10')
    expect(groupSegments([a, off])).toHaveLength(2)
  })

  it('boundary drift: a later import filling the gap merges two conversations into one', () => {
    const early = seg(1, '2026-09-13 19:00', '2026-09-13 20:00')
    const late = seg(1, '2026-09-13 23:30', '2026-09-14 00:10')
    expect(groupSegments([early, late])).toHaveLength(2)

    // the next import brings the messages in between; the same two segments now sit in one conversation
    const filler = seg(1, '2026-09-13 21:00', '2026-09-13 22:00')
    const merged = groupSegments([early, late, filler])
    expect(merged).toHaveLength(1)
    expect(merged[0].segments.map((s) => s.tag)).toEqual([early.tag, filler.tag, late.tag])
    expect(merged[0].endedAt).toBe('2026-09-14 00:10')
  })

  it('reverse-order import: input order never changes the answer', () => {
    const xs = [
      seg(1, '2026-03-02 09:00', '2026-03-02 09:30'),
      seg(1, '2026-03-02 11:00', '2026-03-02 11:20'),
      seg(1, '2026-09-13 19:00', '2026-09-13 20:00'),
      seg(2, '2026-06-01 08:00', '2026-06-01 08:30'),
    ]
    const forward = groupSegments(xs)
    const backward = groupSegments([...xs].reverse())
    expect(backward.map((g) => g.segments.map((s) => s.tag))).toEqual(forward.map((g) => g.segments.map((s) => s.tag)))
  })

  it('tolerates overlapping spans (re-extraction of a wider window)', () => {
    const wide = seg(1, '2026-09-13 19:00', '2026-09-13 22:00')
    const inner = seg(1, '2026-09-13 20:00', '2026-09-13 21:00')
    const groups = groupSegments([wide, inner])
    expect(groups).toHaveLength(1)
    expect(groups[0].endedAt).toBe('2026-09-13 22:00')
  })

  it('returns nothing for no segments', () => {
    expect(groupSegments([])).toEqual([])
  })
})

const TODAY = '2026-09-16'
function conv(startedAt: string, opts: Partial<RhythmConversation> = {}): RhythmConversation {
  return { startedAt, endedAt: opts.endedAt ?? startedAt, chatKind: opts.chatKind ?? 'private', initiator: opts.initiator ?? null }
}

describe('deriveRhythm', () => {
  it('is empty with no conversations', () => {
    expect(deriveRhythm([], TODAY)).toEqual({
      conversationCount: 0,
      conversationCountThisYear: 0,
      lastAt: null,
      daysSinceLast: null,
      medianGapDays: null,
      initiatedByMe: null,
      initiatedByThem: null,
      privateOnly: false,
    })
  })

  it('under MIN_RHYTHM_CONVERSATIONS reports only the last contact and the totals', () => {
    expect(MIN_RHYTHM_CONVERSATIONS).toBe(5)
    const xs = [conv('2026-09-01 10:00'), conv('2026-09-05 10:00'), conv('2026-09-09 10:00'), conv('2026-09-13 10:00')]
    const r = deriveRhythm(xs, TODAY)
    expect(r.conversationCount).toBe(4)
    expect(r.medianGapDays).toBeNull()
    expect(r.lastAt).toBe('2026-09-13 10:00')
    expect(r.daysSinceLast).toBe(3)
  })

  it('at MIN_RHYTHM_CONVERSATIONS reports the median gap', () => {
    const xs = ['2026-08-16', '2026-08-26', '2026-09-01', '2026-09-09', '2026-09-13'].map((d) => conv(`${d} 10:00`))
    const r = deriveRhythm(xs, TODAY)
    expect(r.conversationCount).toBe(5)
    // gaps 10, 6, 8, 4 → median 7
    expect(r.medianGapDays).toBe(7)
  })

  it('counts this year separately and never reports a negative days-since', () => {
    const xs = [conv('2025-12-30 10:00'), conv('2026-01-02 10:00'), conv('2026-09-16 09:00')]
    const r = deriveRhythm(xs, TODAY)
    expect(r.conversationCount).toBe(3)
    expect(r.conversationCountThisYear).toBe(2)
    expect(r.daysSinceLast).toBe(0)
  })

  it('who spoke first is private-chat only; group-only contact yields null', () => {
    const groupOnly = [
      conv('2026-08-01 10:00', { chatKind: 'group', initiator: 'me' }),
      conv('2026-08-10 10:00', { chatKind: 'group', initiator: 'them' }),
    ]
    const r = deriveRhythm(groupOnly, TODAY)
    expect(r.initiatedByMe).toBeNull()
    expect(r.initiatedByThem).toBeNull()
    expect(r.privateOnly).toBe(false)
    expect(r.conversationCount).toBe(2)
  })

  it('counts initiators over private conversations only', () => {
    const xs = [
      conv('2026-08-01 10:00', { initiator: 'me' }),
      conv('2026-08-05 10:00', { initiator: 'me' }),
      conv('2026-08-09 10:00', { initiator: 'them' }),
      conv('2026-08-12 10:00', { chatKind: 'group', initiator: 'me' }),
      conv('2026-08-20 10:00', { initiator: null }),
    ]
    const r = deriveRhythm(xs, TODAY)
    expect(r.initiatedByMe).toBe(2)
    expect(r.initiatedByThem).toBe(1)
    expect(r.privateOnly).toBe(false)
  })
})

function loop(x: Partial<LoopLike> = {}): LoopLike {
  return { dueAt: null, openedAt: '2026-09-01 10:00', closedMessageId: null, closedReason: null, ...x }
}

describe('loopState', () => {
  it('has no state column: open until a close event exists', () => {
    expect(loopState(loop(), TODAY).state).toBe('open')
    expect(loopState(loop({ closedMessageId: 40, closedReason: 'done' }), TODAY).state).toBe('done')
    expect(loopState(loop({ closedMessageId: 40, closedReason: 'dropped' }), TODAY).state).toBe('dropped')
    // closed by hand: no message, only a reason (SPEC §7 交互层)
    expect(loopState(loop({ closedReason: 'done' }), TODAY).state).toBe('done')
    // the closing message was deleted with its import → open again
    expect(loopState(loop({ closedMessageId: null, closedReason: null }), TODAY).state).toBe('open')
  })

  // the threshold day itself is not yet expired ("过期 14 天后"); `server/review/loops.ts` reads it the same way
  it('expires the day after LOOP_EXPIRY_DAYS_WITH_DUE days past a due date', () => {
    expect(LOOP_EXPIRY_DAYS_WITH_DUE).toBe(14)
    const due = loop({ dueAt: '2026-09-02', openedAt: '2026-08-20 10:00' })
    expect(loopState(due, '2026-09-15').expired).toBe(false) // 13 days
    expect(loopState(due, '2026-09-16').expired).toBe(false) // exactly 14: still not expired
    expect(loopState(due, '2026-09-17').expired).toBe(true) // 15
    expect(loopState(due, '2026-09-01').expired).toBe(false) // not even due yet
  })

  it('expires the day after LOOP_EXPIRY_DAYS_NO_DUE days from opening when there is no due date', () => {
    expect(LOOP_EXPIRY_DAYS_NO_DUE).toBe(90)
    const open = loop({ openedAt: '2026-06-18 09:00' })
    expect(loopState(open, '2026-09-15').expired).toBe(false) // 89 days
    expect(loopState(open, '2026-09-16').expired).toBe(false) // exactly 90
    expect(loopState(open, '2026-09-17').expired).toBe(true) // 91
  })

  it('stops counting daysOpen at the close, like review does', () => {
    const closed = loop({ openedAt: '2026-09-01 10:00', closedMessageId: 9, closedReason: 'done', closedAt: '2026-09-05 12:00' })
    expect(loopState(closed, TODAY).daysOpen).toBe(4)
    expect(loopState(loop({ openedAt: '2026-09-01 10:00' }), TODAY).daysOpen).toBe(15)
  })

  it('a closed item is never expired', () => {
    const old = loop({ openedAt: '2025-01-01 10:00', closedMessageId: 9, closedReason: 'done' })
    expect(loopState(old, TODAY).expired).toBe(false)
  })

  it('a partial due date runs to the last day it could still happen', () => {
    expect(partialDateEnd('2026-02')).toBe('2026-02-28')
    expect(partialDateEnd('2024-02')).toBe('2024-02-29')
    expect(partialDateEnd('2026')).toBe('2026-12-31')
    expect(partialDateEnd('2026-09-20')).toBe('2026-09-20')
    const monthly = loop({ dueAt: '2026-08', openedAt: '2026-07-01 10:00' })
    expect(loopState(monthly, '2026-09-14').expired).toBe(false) // exactly 14 days after 08-31
    expect(loopState(monthly, '2026-09-15').expired).toBe(true)
  })

  it('daysOpen and 已过去 N 天 never go negative', () => {
    expect(loopState(loop({ openedAt: '2026-09-20 10:00' }), TODAY).daysOpen).toBe(0)
    expect(daysPastDue(loop({ dueAt: '2026-09-30' }), TODAY)).toBe(0)
    expect(daysPastDue(loop({ dueAt: '2026-09-02' }), TODAY)).toBe(14)
    expect(daysPastDue(loop({ openedAt: '2026-09-01 10:00' }), TODAY)).toBe(15)
  })
})
