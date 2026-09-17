// Row → DTO for the interaction layer. `state`, `expired` and every conversation are derived here, never stored.
import { desc, eq, inArray } from 'drizzle-orm'
import type { ConversationDTO, LoopDTO, PersonRefDTO, SegmentDTO } from '@/contracts'
import { chats, conversationSegments, messages, owned, persons, segmentParticipants, type Db } from '@/server/db'
import { chunk } from './db'
import { groupSegments } from './group'
import { loopState } from './loop-state'
import type { SegmentGroup } from './types'

/** A segment row joined with its chat; everything a SegmentDTO needs except participants and firstMessageId. */
export interface SegmentRow {
  id: number
  chatId: number
  chatTitle: string
  chatKind: 'private' | 'group'
  startSeq: number
  endSeq: number
  startedAt: string
  endedAt: string
  messageCount: number
  summary: string
  topics: string
  hidden: boolean
  importId: number | null
  sourceKind: 'ai' | 'manual'
  createdAt: string
}

export const segmentColumns = {
  id: conversationSegments.id,
  chatId: conversationSegments.chatId,
  chatTitle: chats.title,
  chatKind: chats.kind,
  startSeq: conversationSegments.startSeq,
  endSeq: conversationSegments.endSeq,
  startedAt: conversationSegments.startedAt,
  endedAt: conversationSegments.endedAt,
  messageCount: conversationSegments.messageCount,
  summary: conversationSegments.summary,
  topics: conversationSegments.topics,
  hidden: conversationSegments.hidden,
  importId: conversationSegments.importId,
  sourceKind: conversationSegments.sourceKind,
  createdAt: conversationSegments.createdAt,
}

export function parseTopics(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export interface SegmentExtras {
  participants: Map<number, PersonRefDTO[]>
  firstMessageId: Map<number, number>
}

/** Participants and the id of each segment's first message ("在聊天中查看"), in as few round trips as D1 allows. */
export async function loadSegmentExtras(db: Db, ownerId: string, rows: SegmentRow[]): Promise<SegmentExtras> {
  const participants = new Map<number, PersonRefDTO[]>()
  const firstMessageId = new Map<number, number>()
  if (rows.length === 0) return { participants, firstMessageId }

  for (const part of chunk(rows.map((r) => r.id))) {
    const links = await db
      .select({ segmentId: segmentParticipants.segmentId, id: persons.id, label: persons.label })
      .from(segmentParticipants)
      .innerJoin(persons, eq(persons.id, segmentParticipants.personId))
      .where(owned(segmentParticipants, ownerId, inArray(segmentParticipants.segmentId, part)))
      .orderBy(desc(segmentParticipants.messageCount), persons.id)
      .all()
    for (const l of links) {
      const list = participants.get(l.segmentId)
      if (list) list.push({ id: l.id, label: l.label })
      else participants.set(l.segmentId, [{ id: l.id, label: l.label }])
    }
  }

  const chatIds = [...new Set(rows.map((r) => r.chatId))]
  const bySeq = new Map<string, number>()
  for (const part of chunk(rows, 40)) {
    const found = await db
      .select({ id: messages.id, chatId: messages.chatId, seq: messages.seq })
      .from(messages)
      .where(owned(messages, ownerId, inArray(messages.chatId, chatIds), inArray(messages.seq, [...new Set(part.map((r) => r.startSeq))])))
      .all()
    for (const m of found) bySeq.set(`${m.chatId}:${m.seq}`, m.id)
  }
  for (const r of rows) {
    const id = bySeq.get(`${r.chatId}:${r.startSeq}`)
    if (id !== undefined) firstMessageId.set(r.id, id)
  }
  return { participants, firstMessageId }
}

export function segmentDTO(r: SegmentRow, extras: SegmentExtras): SegmentDTO {
  return {
    id: r.id,
    chatId: r.chatId,
    chatTitle: r.chatTitle,
    startSeq: r.startSeq,
    endSeq: r.endSeq,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    messageCount: r.messageCount,
    summary: r.summary,
    topics: parseTopics(r.topics),
    hidden: r.hidden,
    firstMessageId: extras.firstMessageId.get(r.id) ?? null,
    participants: extras.participants.get(r.id) ?? [],
    importId: r.importId,
    sourceKind: r.sourceKind,
    createdAt: r.createdAt,
  }
}

/**
 * Groups rows into conversations, newest first. `hidden` segments keep shaping the grouping and the message count
 * (hiding a summary does not rewrite what happened) but are left out of the rendered list unless `includeHidden`;
 * a conversation whose every segment is hidden disappears.
 */
export function toConversations(rows: SegmentRow[], extras: SegmentExtras, opts: { includeHidden?: boolean } = {}): ConversationDTO[] {
  const groups = groupSegments(rows)
  const out: ConversationDTO[] = []
  for (const g of [...groups].reverse()) {
    const shown = opts.includeHidden ? g.segments : g.segments.filter((s) => !s.hidden)
    if (shown.length === 0) continue
    const segments = shown.map((s) => segmentDTO(s, extras))
    const topics: string[] = []
    for (const s of segments) for (const t of s.topics) if (!topics.includes(t)) topics.push(t)
    out.push({
      chatId: g.chatId,
      chatTitle: g.segments[0].chatTitle,
      chatKind: g.segments[0].chatKind,
      startedAt: g.startedAt,
      endedAt: g.endedAt,
      messageCount: g.messageCount,
      segments,
      topics,
      firstMessageId: segments[0].firstMessageId,
    })
  }
  return out
}

/** The conversation groups a caller needs before the DTOs (rhythm, "which conversation is this import in"). */
export function groupsOf(rows: SegmentRow[]): SegmentGroup<SegmentRow>[] {
  return groupSegments(rows)
}

export type LoopRow = {
  id: number
  personId: number
  direction: 'mine' | 'theirs' | 'mutual'
  kind: 'promise' | 'question' | 'plan'
  text: string
  dueAt: string | null
  openedAt: string
  openedMessageId: number | null
  closedAt: string | null
  closedMessageId: number | null
  closedReason: 'done' | 'dropped' | null
  status: 'proposed' | 'confirmed' | 'rejected' | 'superseded'
  importId: number | null
  sourceKind: 'ai' | 'manual'
  createdAt: string
}

export function loopDTO(r: LoopRow, evidenceCount: number, today: string): LoopDTO {
  const derived = loopState(r, today)
  return {
    id: r.id,
    personId: r.personId,
    direction: r.direction,
    kind: r.kind,
    text: r.text,
    dueAt: r.dueAt,
    openedAt: r.openedAt,
    openedMessageId: r.openedMessageId,
    closedAt: r.closedAt,
    closedMessageId: r.closedMessageId,
    closedReason: r.closedReason,
    state: derived.state,
    expired: derived.expired,
    daysOpen: derived.daysOpen,
    status: r.status,
    importId: r.importId,
    sourceKind: r.sourceKind,
    evidenceCount,
    createdAt: r.createdAt,
  }
}
