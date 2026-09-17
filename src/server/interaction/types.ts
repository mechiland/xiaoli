// Types of the interaction layer (SPEC §7 交互层). Pure.
import type { ChatKind, LoopCloseReason, LoopState, MsgTime, SegmentDTO } from '@/contracts'

/** Minimal shape `groupSegments` needs; the DTO satisfies it. */
export interface GroupableSegment {
  chatId: number
  startSeq: number
  endSeq: number
  startedAt: MsgTime
  endedAt: MsgTime
  messageCount: number
}

export interface SegmentGroup<T extends GroupableSegment> {
  chatId: number
  startedAt: MsgTime
  endedAt: MsgTime
  messageCount: number
  segments: T[]
}

/** One conversation's contribution to the rhythm; `initiator` is null in groups (SPEC §7 交互层). */
export interface RhythmConversation {
  startedAt: MsgTime
  endedAt: MsgTime
  chatKind: ChatKind
  initiator: 'me' | 'them' | null
}

export interface LoopLike {
  dueAt: string | null
  openedAt: MsgTime
  closedMessageId: number | null
  closedReason: LoopCloseReason | null
  /** MsgTime when a message closed it, ISO when the user did; `daysOpen` stops there */
  closedAt?: string | null
}

export interface LoopDerived {
  state: LoopState
  expired: boolean
  daysOpen: number
}

export type SegmentPatch = { summary?: string; hidden?: boolean }

export type { SegmentDTO }
