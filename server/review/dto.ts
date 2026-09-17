// Row → DTO loaders shared by review actions, evidence and import review (internal).
import { and, count, eq, inArray } from 'drizzle-orm'
import type {
  ClaimDTO,
  EventDTO,
  HandleDTO,
  ImportantDateDTO,
  LoopDTO,
  PersonDTO,
  PersonRefDTO,
  RelationDTO,
  TargetType,
} from '@/contracts'
import { nextOccurrence } from '@/lib/lunar'
import { todayInTz } from '@/lib/time'
import {
  chats,
  claimMentions,
  claims,
  conversationSegments,
  eventParticipants,
  events,
  evidence,
  handles,
  importantDates,
  loops,
  owned,
  persons,
  relations,
  segmentParticipants,
  type Db,
} from '@/server/db'
import { errors } from '@/server/errors'
import { deriveLoop, type LoopRow } from './loops'
import { chunk, IN_CHUNK, uniq } from './util'

export type ClaimRow = typeof claims.$inferSelect
export type HandleRow = typeof handles.$inferSelect
export type RelationRow = typeof relations.$inferSelect
export type EventRow = typeof events.$inferSelect
export type DateRow = typeof importantDates.$inferSelect
export type PersonRow = typeof persons.$inferSelect
export type { LoopRow }
export type ItemRow = ClaimRow | HandleRow | RelationRow | EventRow | DateRow | LoopRow
export type ItemDTO = ClaimDTO | HandleDTO | RelationDTO | EventDTO | ImportantDateDTO | LoopDTO

/**
 * One table per `TargetType`. `segment` is in here only so that indexing by a `TargetType` typechecks and so that
 * `GET /api/evidence/segment/:id` can load the row — a segment is never reviewed (see `REVIEWABLE`).
 */
export const TABLES = {
  claim: claims,
  handle: handles,
  relation: relations,
  event: events,
  date: importantDates,
  loop: loops,
  segment: conversationSegments,
} as const

/**
 * The tables review actually reviews: they all carry `status` + `import_id`, which `setStatus` and
 * `syncImportStatus` need. `conversation_segments` has neither, because a 段落摘要 describes what was said that day
 * rather than asserting anything about a person, so there is nothing to confirm (SPEC §9.9).
 */
export const REVIEWABLE = {
  claim: claims,
  handle: handles,
  relation: relations,
  event: events,
  date: importantDates,
  loop: loops,
} as const

export type ReviewableType = keyof typeof REVIEWABLE

/** `applyReview` / `bulkReview` guard: segments are a log, not an assertion (SPEC §9.9). */
export function assertReviewable(type: TargetType): asserts type is ReviewableType {
  if (type === 'segment') throw errors.validation('段落摘要不需要确认，可以直接改写或隐藏')
}

export function personDTO(p: PersonRow): PersonDTO {
  return {
    id: p.id,
    label: p.label,
    isSelf: p.isSelf,
    mergedIntoId: p.mergedIntoId,
    pinned: p.pinned,
    avatarUrl: null,
    lastMessageAt: p.lastMessageAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
}

/** Rows of one item table by ids, owner-scoped. */
export async function loadRows(db: Db, ownerId: string, type: TargetType, ids: number[]): Promise<ItemRow[]> {
  const out: ItemRow[] = []
  const t = TABLES[type] as typeof claims
  for (const part of chunk(uniq(ids), IN_CHUNK)) {
    const rows = await db.select().from(t).where(owned(t, ownerId, inArray(t.id, part)))
    out.push(...(rows as unknown as ItemRow[]))
  }
  return out
}

export async function loadRow(db: Db, ownerId: string, type: TargetType, id: number): Promise<ItemRow | null> {
  const [row] = await loadRows(db, ownerId, type, [id])
  return row ?? null
}

export async function evidenceCounts(db: Db, ownerId: string, type: TargetType, ids: number[]): Promise<Map<number, number>> {
  const m = new Map<number, number>()
  for (const part of chunk(uniq(ids), IN_CHUNK)) {
    const rows = await db
      .select({ targetId: evidence.targetId, n: count() })
      .from(evidence)
      .where(owned(evidence, ownerId, eq(evidence.targetType, type), inArray(evidence.targetId, part)))
      .groupBy(evidence.targetId)
    for (const r of rows) m.set(r.targetId, r.n)
  }
  return m
}

export async function personRefs(db: Db, ownerId: string, ids: number[]): Promise<Map<number, PersonRefDTO>> {
  const m = new Map<number, PersonRefDTO>()
  for (const part of chunk(uniq(ids), IN_CHUNK)) {
    const rows = await db
      .select({ id: persons.id, label: persons.label })
      .from(persons)
      .where(owned(persons, ownerId, inArray(persons.id, part)))
    for (const r of rows) m.set(r.id, r)
  }
  return m
}

export async function claimDTOs(db: Db, ownerId: string, rows: ClaimRow[]): Promise<ClaimDTO[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const counts = await evidenceCounts(db, ownerId, 'claim', ids)
  const mentions = new Map<number, PersonRefDTO[]>()
  for (const part of chunk(ids, IN_CHUNK)) {
    const ms = await db
      .select({ claimId: claimMentions.claimId, id: persons.id, label: persons.label })
      .from(claimMentions)
      .innerJoin(persons, eq(persons.id, claimMentions.personId))
      .where(owned(claimMentions, ownerId, inArray(claimMentions.claimId, part)))
    for (const x of ms) {
      const list = mentions.get(x.claimId) ?? []
      list.push({ id: x.id, label: x.label })
      mentions.set(x.claimId, list)
    }
  }
  return rows.map((r) => ({
    id: r.id,
    personId: r.personId,
    statement: r.statement,
    category: r.category,
    validFrom: r.validFrom,
    validTo: r.validTo,
    learnedAt: r.learnedAt,
    confidence: r.confidence,
    sensitive: r.sensitive,
    status: r.status,
    supersedesClaimId: r.supersedesClaimId,
    supersededByClaimId: r.supersededByClaimId,
    importId: r.importId,
    sourceKind: r.sourceKind,
    mentions: mentions.get(r.id) ?? [],
    evidenceCount: counts.get(r.id) ?? 0,
    createdAt: r.createdAt,
    statusChangedAt: r.statusChangedAt,
    statusReason: r.statusReason,
  }))
}

export async function handleDTOs(db: Db, ownerId: string, rows: HandleRow[]): Promise<HandleDTO[]> {
  if (rows.length === 0) return []
  const counts = await evidenceCounts(db, ownerId, 'handle', rows.map((r) => r.id))
  const chatIds = uniq(rows.map((r) => r.chatId).filter((x): x is number => x != null))
  const titles = new Map<number, string>()
  for (const part of chunk(chatIds, IN_CHUNK)) {
    const cs = await db.select({ id: chats.id, title: chats.title }).from(chats).where(owned(chats, ownerId, inArray(chats.id, part)))
    for (const c of cs) titles.set(c.id, c.title)
  }
  return rows.map((r) => ({
    id: r.id,
    personId: r.personId,
    kind: r.kind,
    value: r.value,
    chatId: r.chatId,
    chatTitle: r.chatId == null ? null : (titles.get(r.chatId) ?? null),
    status: r.status,
    importId: r.importId,
    sourceKind: r.sourceKind,
    evidenceCount: counts.get(r.id) ?? 0,
    createdAt: r.createdAt,
  }))
}

export async function relationDTOs(db: Db, ownerId: string, rows: RelationRow[]): Promise<RelationDTO[]> {
  if (rows.length === 0) return []
  const counts = await evidenceCounts(db, ownerId, 'relation', rows.map((r) => r.id))
  const refs = await personRefs(db, ownerId, rows.flatMap((r) => [r.fromPersonId, r.toPersonId]))
  const ref = (id: number): PersonRefDTO => refs.get(id) ?? { id, label: '' }
  return rows.map((r) => ({
    id: r.id,
    fromPersonId: r.fromPersonId,
    toPersonId: r.toPersonId,
    from: ref(r.fromPersonId),
    to: ref(r.toPersonId),
    type: r.type,
    label: r.label,
    status: r.status,
    importId: r.importId,
    sourceKind: r.sourceKind,
    evidenceCount: counts.get(r.id) ?? 0,
    createdAt: r.createdAt,
  }))
}

export async function eventParticipantsOf(db: Db, ownerId: string, eventIds: number[]): Promise<Map<number, PersonRefDTO[]>> {
  const m = new Map<number, PersonRefDTO[]>()
  for (const part of chunk(uniq(eventIds), IN_CHUNK)) {
    const ps = await db
      .select({ eventId: eventParticipants.eventId, id: persons.id, label: persons.label })
      .from(eventParticipants)
      .innerJoin(persons, eq(persons.id, eventParticipants.personId))
      .where(owned(eventParticipants, ownerId, inArray(eventParticipants.eventId, part)))
    for (const x of ps) {
      const list = m.get(x.eventId) ?? []
      list.push({ id: x.id, label: x.label })
      m.set(x.eventId, list)
    }
  }
  return m
}

export async function eventDTOs(db: Db, ownerId: string, rows: EventRow[]): Promise<EventDTO[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const counts = await evidenceCounts(db, ownerId, 'event', ids)
  const parts = await eventParticipantsOf(db, ownerId, ids)
  return rows.map((r) => ({
    id: r.id,
    summary: r.summary,
    happenedAt: r.happenedAt,
    place: r.place,
    status: r.status,
    importId: r.importId,
    sourceKind: r.sourceKind,
    participants: parts.get(r.id) ?? [],
    evidenceCount: counts.get(r.id) ?? 0,
    createdAt: r.createdAt,
  }))
}

export function nextOf(r: Pick<DateRow, 'calendar' | 'month' | 'day' | 'isLeapMonth'>, today = todayInTz()): ImportantDateDTO['next'] {
  if (r.month == null || r.day == null) return null
  try {
    const n = nextOccurrence({ calendar: r.calendar, month: r.month, day: r.day, isLeapMonth: r.isLeapMonth }, today)
    return { solar: n.solar, lunarLabel: n.lunarLabel ?? null, days: n.days }
  } catch {
    return null
  }
}

export async function dateDTOs(db: Db, ownerId: string, rows: DateRow[]): Promise<ImportantDateDTO[]> {
  if (rows.length === 0) return []
  const counts = await evidenceCounts(db, ownerId, 'date', rows.map((r) => r.id))
  const today = todayInTz()
  return rows.map((r) => ({
    id: r.id,
    personId: r.personId,
    kind: r.kind,
    day: r.day,
    month: r.month,
    year: r.year,
    calendar: r.calendar,
    isLeapMonth: r.isLeapMonth,
    label: r.label,
    status: r.status,
    importId: r.importId,
    sourceKind: r.sourceKind,
    next: nextOf(r, today),
    evidenceCount: counts.get(r.id) ?? 0,
    createdAt: r.createdAt,
  }))
}

export async function loopDTOs(db: Db, ownerId: string, rows: LoopRow[]): Promise<LoopDTO[]> {
  if (rows.length === 0) return []
  const counts = await evidenceCounts(db, ownerId, 'loop', rows.map((r) => r.id))
  const today = todayInTz()
  return rows.map((r) => ({
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
    ...deriveLoop(r, today),
    status: r.status,
    importId: r.importId,
    sourceKind: r.sourceKind,
    evidenceCount: counts.get(r.id) ?? 0,
    createdAt: r.createdAt,
  }))
}

export async function itemDTOs(db: Db, ownerId: string, type: TargetType, rows: ItemRow[]): Promise<ItemDTO[]> {
  switch (type) {
    case 'claim':
      return claimDTOs(db, ownerId, rows as ClaimRow[])
    case 'handle':
      return handleDTOs(db, ownerId, rows as HandleRow[])
    case 'relation':
      return relationDTOs(db, ownerId, rows as RelationRow[])
    case 'event':
      return eventDTOs(db, ownerId, rows as EventRow[])
    case 'date':
      return dateDTOs(db, ownerId, rows as DateRow[])
    case 'loop':
      return loopDTOs(db, ownerId, rows as LoopRow[])
    case 'segment':
      throw errors.validation('段落摘要不需要确认，可以直接改写或隐藏')
  }
}

export async function itemDTO(db: Db, ownerId: string, type: TargetType, row: ItemRow): Promise<ItemDTO> {
  const [dto] = await itemDTOs(db, ownerId, type, [row])
  return dto
}

/** Person ids an item belongs to (for query invalidation hints and section placement). */
export async function personIdsOf(db: Db, ownerId: string, type: TargetType, row: ItemRow): Promise<number[]> {
  if (type === 'claim' || type === 'date' || type === 'loop') return [(row as ClaimRow).personId]
  if (type === 'handle') return (row as HandleRow).personId ? [(row as HandleRow).personId!] : []
  if (type === 'relation') return [(row as RelationRow).fromPersonId, (row as RelationRow).toPersonId]
  if (type === 'segment') {
    const ps = await db
      .select({ personId: segmentParticipants.personId })
      .from(segmentParticipants)
      .where(owned(segmentParticipants, ownerId, eq(segmentParticipants.segmentId, row.id)))
    return ps.map((p) => p.personId)
  }
  const ps = await db
    .select({ personId: eventParticipants.personId })
    .from(eventParticipants)
    .where(owned(eventParticipants, ownerId, and(eq(eventParticipants.eventId, row.id))))
  return ps.map((p) => p.personId)
}
