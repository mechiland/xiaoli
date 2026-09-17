// Read side of the interaction layer (SPEC §7 交互层, §9.5, §9.9).
import { count, desc, eq, inArray, ne } from 'drizzle-orm'
import type { ImportInteractionResponse, InteractionResponse, LoopDTO } from '@/contracts'
import { todayInTz } from '@/lib/time'
import { chats, conversationSegments, evidence, getOwnedOr404, handles, imports, loops, messages, owned, persons, segmentParticipants, type Db } from '@/server/db'
import { chunk } from './db'
import { groupsOf, loopDTO, loadSegmentExtras, segmentColumns, toConversations, type LoopRow, type SegmentRow } from './dto'
import { deriveRhythm } from './rhythm'
import type { RhythmConversation } from './types'

/** Newest N segments considered for one person / chat. Well past any real account; keeps the page bounded. */
const SEGMENT_CAP = 2000
const DEFAULT_TIMELINE = 5

async function loadPersonSegments(db: Db, ownerId: string, personId: number): Promise<SegmentRow[]> {
  const rows = await db
    .select(segmentColumns)
    .from(conversationSegments)
    .innerJoin(segmentParticipants, eq(segmentParticipants.segmentId, conversationSegments.id))
    .innerJoin(chats, eq(chats.id, conversationSegments.chatId))
    .where(owned(conversationSegments, ownerId, eq(segmentParticipants.personId, personId)))
    .orderBy(desc(conversationSegments.startedAt), desc(conversationSegments.startSeq))
    .limit(SEGMENT_CAP)
    .all()
  return rows
}

async function loadChatSegments(db: Db, ownerId: string, chatIds: number[]): Promise<SegmentRow[]> {
  if (chatIds.length === 0) return []
  const rows = await db
    .select(segmentColumns)
    .from(conversationSegments)
    .innerJoin(chats, eq(chats.id, conversationSegments.chatId))
    .where(owned(conversationSegments, ownerId, inArray(conversationSegments.chatId, chatIds)))
    .orderBy(desc(conversationSegments.startedAt), desc(conversationSegments.startSeq))
    .limit(SEGMENT_CAP)
    .all()
  return rows
}

/**
 * Who spoke first in each conversation — the sender of the message at its first segment's `startSeq`.
 * Private chats only (SPEC §7 交互层: group reply attribution is ambiguous and the export has no seconds).
 */
async function firstSpeakers(db: Db, ownerId: string, keys: { chatId: number; startSeq: number }[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>()
  if (keys.length === 0) return out
  const chatIds = [...new Set(keys.map((k) => k.chatId))]
  for (const part of chunk(keys, 40)) {
    const rows = await db
      .select({ chatId: messages.chatId, seq: messages.seq, personId: handles.personId })
      .from(messages)
      .leftJoin(handles, eq(handles.id, messages.senderHandleId))
      .where(owned(messages, ownerId, inArray(messages.chatId, chatIds), inArray(messages.seq, [...new Set(part.map((k) => k.startSeq))])))
      .all()
    for (const r of rows) out.set(`${r.chatId}:${r.seq}`, r.personId ?? null)
  }
  return out
}

async function selfPersonId(db: Db, ownerId: string): Promise<number | null> {
  const row = await db.select({ id: persons.id }).from(persons).where(owned(persons, ownerId, eq(persons.isSelf, true))).get()
  return row?.id ?? null
}

async function loadLoops(db: Db, ownerId: string, personId: number, today: string): Promise<{ open: LoopDTO[]; closed: LoopDTO[] }> {
  const [rows, counts] = await Promise.all([
    db
      .select()
      .from(loops)
      .where(owned(loops, ownerId, eq(loops.personId, personId), ne(loops.status, 'rejected')))
      .orderBy(loops.openedAt, loops.id)
      .all(),
    db
      .select({ targetId: evidence.targetId, n: count() })
      .from(evidence)
      .innerJoin(loops, eq(loops.id, evidence.targetId))
      .where(owned(evidence, ownerId, eq(evidence.targetType, 'loop'), eq(loops.ownerId, ownerId), eq(loops.personId, personId)))
      .groupBy(evidence.targetId)
      .all(),
  ])
  const byId = new Map(counts.map((c) => [c.targetId, c.n]))
  const open: LoopDTO[] = []
  const closed: LoopDTO[] = []
  for (const r of rows) {
    const dto = loopDTO(r as LoopRow, byId.get(r.id) ?? 0, today)
    if (dto.state === 'open') open.push(dto)
    else closed.push(dto)
  }
  // open + expired oldest first (expired rows are never reordered, SPEC §9.5); closed newest first for 历史
  closed.reverse()
  return { open, closed }
}

/**
 * The 「来往」 section of a person page (SPEC §9.5): a rhythm sentence, the unfinished items, and the timeline.
 * Nothing here is stored: conversations are regrouped on every read and loop state is derived from its close event.
 */
export async function getPersonInteraction(
  db: Db,
  ownerId: string,
  personId: number,
  opts: { timeline?: number | 'all' } = {},
): Promise<InteractionResponse> {
  await getOwnedOr404(db, persons, ownerId, personId)
  const today = todayInTz()

  const [rows, { open, closed }, selfId] = await Promise.all([
    loadPersonSegments(db, ownerId, personId),
    loadLoops(db, ownerId, personId, today),
    selfPersonId(db, ownerId),
  ])

  const groups = groupsOf(rows)
  const privateStarts = groups
    .filter((g) => g.segments[0].chatKind === 'private')
    .map((g) => ({ chatId: g.chatId, startSeq: g.segments[0].startSeq }))
  const speakers = await firstSpeakers(db, ownerId, privateStarts)

  const rhythmInput: RhythmConversation[] = groups.map((g) => {
    const kind = g.segments[0].chatKind
    let initiator: 'me' | 'them' | null = null
    if (kind === 'private') {
      const who = speakers.get(`${g.chatId}:${g.segments[0].startSeq}`)
      if (who != null) initiator = who === selfId ? 'me' : who === personId ? 'them' : null
    }
    return { startedAt: g.startedAt, endedAt: g.endedAt, chatKind: kind, initiator }
  })
  const rhythm = deriveRhythm(rhythmInput, today)

  // the timeline shows whole conversations, so slice the groups first and only decorate the segments we render
  const visible = [...groups].reverse().filter((g) => g.segments.some((s) => !s.hidden))
  const take = opts.timeline === 'all' ? visible.length : Math.max(0, opts.timeline ?? DEFAULT_TIMELINE)
  const slice = visible.slice(0, take)
  const extras = await loadSegmentExtras(db, ownerId, slice.flatMap((g) => g.segments))
  const conversations = toConversations(slice.flatMap((g) => g.segments), extras)

  return { rhythm, loops: open, closed, conversations, hasMore: visible.length > slice.length }
}

/**
 * The 「这次聊了什么」 block of an import result page (SPEC §9.9): the conversations this import's segments fall in,
 * newest first. Hidden segments are included so the user can undo hiding one.
 */
export async function getImportInteraction(db: Db, ownerId: string, importId: number): Promise<ImportInteractionResponse> {
  const imp = await getOwnedOr404(db, imports, ownerId, importId)

  const mine = await db
    .select({ id: conversationSegments.id, chatId: conversationSegments.chatId })
    .from(conversationSegments)
    .where(owned(conversationSegments, ownerId, eq(conversationSegments.importId, importId)))
    .all()
  if (mine.length === 0) return { conversations: [] }

  const chatIds = [...new Set([...mine.map((s) => s.chatId), ...(imp.chatId != null ? [imp.chatId] : [])])]
  const rows = await loadChatSegments(db, ownerId, chatIds)
  const ofImport = new Set(mine.map((s) => s.id))

  const kept = groupsOf(rows)
    .filter((g) => g.segments.some((s) => ofImport.has(s.id)))
    .flatMap((g) => g.segments)
  const extras = await loadSegmentExtras(db, ownerId, kept)
  return { conversations: toConversations(kept, extras, { includeHidden: true }) }
}
