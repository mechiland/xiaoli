// GET /api/imports/:id/review — this import's items grouped by person (SPEC §9.9, ARCHITECTURE §2.4).
import { count, eq, inArray, max } from 'drizzle-orm'
import type { Category, ChatDTO, ClaimDTO, ImportDTO, ImportReviewResponse, Progress, ReviewItem } from '@/contracts'
import { chats, claims, events, extractionJobs, getUserSettings, handles, importantDates, imports, messages, owned, persons, relations, type Db } from '@/server/db'
import { errors } from '@/server/errors'
import { claimDTOs, dateDTOs, eventDTOs, handleDTOs, loadRows, relationDTOs, type ClaimRow } from './dto'
import { chunk, IN_CHUNK, uniq } from './util'

const CATEGORY_ORDER: Category[] = ['work', 'location', 'education', 'family', 'preference', 'life_event', 'other']

type Section = ImportReviewResponse['sections'][number]

export function importDTO(row: typeof imports.$inferSelect): ImportDTO {
  return {
    id: row.id,
    chatId: row.chatId,
    fileName: row.fileName,
    fileSha256: row.fileSha256,
    exportedAt: row.exportedAt,
    status: row.status,
    messageCount: row.messageCount,
    newMessageCount: row.newMessageCount,
    dateFrom: row.dateFrom,
    dateTo: row.dateTo,
    stats: row.stats,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function chatDTO(db: Db, ownerId: string, chatId: number | null): Promise<ChatDTO | null> {
  if (chatId == null) return null
  const c = await db.select().from(chats).where(owned(chats, ownerId, eq(chats.id, chatId))).get()
  if (!c) return null
  const [agg] = await db
    .select({ n: count(), last: max(messages.sentAt) })
    .from(messages)
    .where(owned(messages, ownerId, eq(messages.chatId, chatId)))
  return { id: c.id, title: c.title, kind: c.kind, note: c.note, messageCount: agg?.n ?? 0, lastMessageAt: agg?.last ?? null, createdAt: c.createdAt, updatedAt: c.updatedAt }
}

export async function importProgress(db: Db, ownerId: string, importId: number): Promise<Progress> {
  const rows = await db
    .select({ status: extractionJobs.status, n: count() })
    .from(extractionJobs)
    .where(owned(extractionJobs, ownerId, eq(extractionJobs.importId, importId)))
    .groupBy(extractionJobs.status)
  const p: Progress = { total: 0, done: 0, failed: 0, pending: 0, running: 0 }
  for (const r of rows) {
    p[r.status] = r.n
    p.total += r.n
  }
  return p
}

export async function getImportReview(db: Db, ownerId: string, importId: number): Promise<ImportReviewResponse> {
  const imp = await db.select().from(imports).where(owned(imports, ownerId, eq(imports.id, importId))).get()
  if (!imp) throw errors.notFound()
  const [chat, progress, settings] = await Promise.all([chatDTO(db, ownerId, imp.chatId), importProgress(db, ownerId, importId), getUserSettings(db, ownerId)])

  // AI items of this import. The original of a person-page "改写" stays out (its edited successor carries the import id).
  const claimRows = await db.select().from(claims).where(owned(claims, ownerId, eq(claims.importId, importId), eq(claims.sourceKind, 'ai')))
  const claimList = claimRows.filter((c) => c.statusReason !== 'edited')
  const handleRows = await db.select().from(handles).where(owned(handles, ownerId, eq(handles.importId, importId), eq(handles.sourceKind, 'ai')))
  const relationRows = await db.select().from(relations).where(owned(relations, ownerId, eq(relations.importId, importId), eq(relations.sourceKind, 'ai')))
  const eventRows = await db.select().from(events).where(owned(events, ownerId, eq(events.importId, importId), eq(events.sourceKind, 'ai')))
  const dateRows = await db.select().from(importantDates).where(owned(importantDates, ownerId, eq(importantDates.importId, importId), eq(importantDates.sourceKind, 'ai')))

  const [claimDtos, handleDtos, relationDtos, eventDtos, dateDtos] = await Promise.all([
    claimDTOs(db, ownerId, claimList),
    handleDTOs(db, ownerId, handleRows),
    relationDTOs(db, ownerId, relationRows),
    eventDTOs(db, ownerId, eventRows),
    dateDTOs(db, ownerId, dateRows),
  ])

  // replaced claims ("变化")
  const replacedRows = (await loadRows(db, ownerId, 'claim', claimList.map((c) => c.supersedesClaimId).filter((x): x is number => x != null))) as ClaimRow[]
  const replacedDtos = new Map((await claimDTOs(db, ownerId, replacedRows)).map((c) => [c.id, c]))
  const replacedRowById = new Map(replacedRows.map((r) => [r.id, r]))

  // persons referenced
  const personIds = uniq([
    ...claimDtos.map((c) => c.personId),
    ...handleDtos.map((h) => h.personId).filter((x): x is number => x != null),
    ...relationDtos.flatMap((r) => [r.fromPersonId, r.toPersonId]),
    ...eventDtos.flatMap((e) => e.participants.map((p) => p.id)),
    ...dateDtos.map((d) => d.personId),
  ])
  const personRows = new Map<number, { id: number; label: string; labelSort: string; isSelf: boolean; importId: number | null }>()
  for (const part of chunk(personIds, IN_CHUNK)) {
    const rows = await db
      .select({ id: persons.id, label: persons.label, labelSort: persons.labelSort, isSelf: persons.isSelf, importId: persons.importId })
      .from(persons)
      .where(owned(persons, ownerId, inArray(persons.id, part)))
    for (const r of rows) personRows.set(r.id, r)
  }

  const sections = new Map<number, Section>()
  const section = (personId: number): Section => {
    let s = sections.get(personId)
    if (!s) {
      const p = personRows.get(personId)
      s = { person: { id: personId, label: p?.label ?? '', isNew: p?.importId === importId }, newCount: 0, newClaims: [], changes: [], aliasesAndRelations: [], dates: [], events: [] }
      sections.set(personId, s)
    }
    return s
  }
  const isSelf = (id: number) => personRows.get(id)?.isSelf === true

  for (const c of claimDtos) {
    const replacedRow = c.supersedesClaimId != null ? replacedRowById.get(c.supersedesClaimId) : undefined
    const isOwnEdit = replacedRow?.statusReason === 'edited' && replacedRow.supersededByClaimId === c.id
    const replaces = !isOwnEdit && c.supersedesClaimId != null ? (replacedDtos.get(c.supersedesClaimId) ?? null) : null
    const item: ReviewItem = { type: 'claim', item: c, replaces }
    if (replaces) section(c.personId).changes.push(item)
    else section(c.personId).newClaims.push(item)
  }
  for (const h of handleDtos) if (h.personId != null) section(h.personId).aliasesAndRelations.push({ type: 'handle', item: h })
  for (const d of dateDtos) section(d.personId).dates.push({ type: 'date', item: d })

  // Relations/events touch several persons: prefer a person new in this import, then one that already has a section.
  const pick = (ids: number[]): number => {
    const others = uniq(ids).filter((id) => !isSelf(id))
    const pool = others.length ? others : uniq(ids)
    return pool.find((id) => personRows.get(id)?.importId === importId) ?? pool.find((id) => sections.has(id)) ?? pool[0]
  }
  for (const r of relationDtos) section(pick([r.fromPersonId, r.toPersonId])).aliasesAndRelations.push({ type: 'relation', item: r })
  for (const e of eventDtos) {
    if (e.participants.length === 0) continue
    section(pick(e.participants.map((p) => p.id))).events.push({ type: 'event', item: e })
  }

  const byCategory = (a: ReviewItem, b: ReviewItem) => {
    const ca = (a.item as ClaimDTO).category
    const cb = (b.item as ClaimDTO).category
    return CATEGORY_ORDER.indexOf(ca) - CATEGORY_ORDER.indexOf(cb) || a.item.id - b.item.id
  }
  const handlesFirst = (a: ReviewItem, b: ReviewItem) => (a.type === b.type ? a.item.id - b.item.id : a.type === 'handle' ? -1 : 1)
  for (const s of sections.values()) {
    s.newClaims.sort(byCategory)
    s.changes.sort(byCategory)
    s.aliasesAndRelations.sort(handlesFirst)
    s.dates.sort((a, b) => a.item.id - b.item.id)
    s.events.sort((a, b) => a.item.id - b.item.id)
    s.newCount = s.newClaims.length + s.changes.length + s.aliasesAndRelations.length + s.dates.length + s.events.length
  }
  const ordered = [...sections.values()].sort(
    (a, b) =>
      Number(b.person.isNew) - Number(a.person.isNew) ||
      b.newCount - a.newCount ||
      (personRows.get(a.person.id)?.labelSort ?? '').localeCompare(personRows.get(b.person.id)?.labelSort ?? '') ||
      a.person.id - b.person.id,
  )

  const highConfidence = claimDtos
    .filter((c) => c.status === 'proposed' && !c.sensitive && c.confidence != null && c.confidence >= settings.highConfidenceThreshold)
    .map((c) => ({ type: 'claim' as const, id: c.id }))
  // Only items the page shows: a handle without a person has no section, so it must not keep allHandled false.
  const all = [...claimDtos, ...handleDtos.filter((h) => h.personId != null), ...relationDtos, ...eventDtos.filter((e) => e.participants.length > 0), ...dateDtos]

  return {
    import: importDTO(imp),
    chat,
    progress,
    sections: ordered,
    highConfidence,
    highConfidenceCount: highConfidence.length,
    allHandled: all.every((x) => x.status !== 'proposed'),
    empty: all.length === 0,
  }
}
