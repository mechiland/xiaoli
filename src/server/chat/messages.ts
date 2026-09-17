// GET /api/chats/:id and GET /api/chats/:id/messages (SPEC §9.10, ARCHITECTURE §1.11). Owner: chat.
import { asc, count, desc, eq, gt, gte, inArray, lt, lte, max, ne, type SQL } from 'drizzle-orm'
import type { AttachmentDTO, ChatDetailResponse, ChatMessagesQuery, ChatMessagesResponse, MessageDTO, PersonRefDTO } from '@/contracts'
import { attachments, chats, getOwnedOr404, handles, imports, messages, owned, persons, type Db } from '@/server/db'

type MessageRow = typeof messages.$inferSelect

/** D1 caps bound parameters per statement (~100); keep IN lists well below. */
const IN_CHUNK = 80
export const DEFAULT_PAGE = 100
export const DEFAULT_AROUND = 50

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}
const uniq = <T,>(xs: T[]): T[] => [...new Set(xs)]

/**
 * person id → the visible person (merged persons resolve to their merge target, at most 5 hops).
 * Self is included; callers decide whether to show it.
 */
async function resolvePersons(db: Db, ownerId: string, ids: number[]): Promise<Map<number, PersonRefDTO & { isSelf: boolean }>> {
  const rows = new Map<number, typeof persons.$inferSelect>()
  let pending = uniq(ids)
  for (let hop = 0; hop < 6 && pending.length > 0; hop++) {
    const next: number[] = []
    for (const part of chunk(pending, IN_CHUNK)) {
      for (const p of await db.select().from(persons).where(owned(persons, ownerId, inArray(persons.id, part)))) {
        rows.set(p.id, p)
        if (p.mergedIntoId != null && !rows.has(p.mergedIntoId)) next.push(p.mergedIntoId)
      }
    }
    pending = uniq(next)
  }
  const out = new Map<number, PersonRefDTO & { isSelf: boolean }>()
  for (const id of uniq(ids)) {
    let p = rows.get(id)
    for (let hop = 0; p && p.mergedIntoId != null && hop < 5; hop++) p = rows.get(p.mergedIntoId)
    if (p && p.mergedIntoId == null) out.set(id, { id: p.id, label: p.label, isSelf: p.isSelf })
  }
  return out
}

export async function getChatDetail(db: Db, ownerId: string, chatId: number): Promise<ChatDetailResponse> {
  const chat = await getOwnedOr404(db, chats, ownerId, chatId)
  const [stats, bySender, importRows] = await db.batch([
    db
      .select({ n: count(), last: max(messages.sentAt) })
      .from(messages)
      .where(owned(messages, ownerId, eq(messages.chatId, chatId))),
    db
      .select({ personId: handles.personId, n: count() })
      .from(messages)
      .innerJoin(handles, eq(handles.id, messages.senderHandleId))
      .where(owned(messages, ownerId, eq(messages.chatId, chatId)))
      .groupBy(handles.personId),
    db
      .select({ id: imports.id, dateFrom: imports.dateFrom, dateTo: imports.dateTo, createdAt: imports.createdAt, newMessageCount: imports.newMessageCount })
      .from(imports)
      .where(owned(imports, ownerId, eq(imports.chatId, chatId), ne(imports.status, 'mapping')))
      .orderBy(asc(imports.dateFrom), asc(imports.id)),
  ])

  const people = await resolvePersons(
    db,
    ownerId,
    bySender.map((r) => r.personId).filter((x): x is number => x != null),
  )
  const counts = new Map<number, { ref: PersonRefDTO; isSelf: boolean; messageCount: number }>()
  for (const r of bySender) {
    const p = r.personId != null ? people.get(r.personId) : undefined
    if (!p) continue
    const cur = counts.get(p.id) ?? { ref: { id: p.id, label: p.label }, isSelf: p.isSelf, messageCount: 0 }
    cur.messageCount += r.n
    counts.set(p.id, cur)
  }
  // Participants: the other people in the chat, most active first (self is implied; DECISIONS chat C3).
  const participants = [...counts.values()]
    .filter((p) => !p.isSelf)
    .sort((a, b) => b.messageCount - a.messageCount || a.ref.id - b.ref.id)
    .map((p) => ({ ...p.ref, messageCount: p.messageCount }))

  return {
    chat: {
      id: chat.id,
      title: chat.title,
      kind: chat.kind,
      note: chat.note,
      messageCount: stats[0]?.n ?? 0,
      lastMessageAt: stats[0]?.last ?? null,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    },
    participants,
    imports: importRows,
  }
}

function attachmentDTO(a: typeof attachments.$inferSelect): AttachmentDTO {
  return {
    id: a.id,
    messageId: a.messageId,
    kind: a.kind,
    fileName: a.fileName,
    selected: a.selected,
    uploaded: a.r2Key != null,
    byteSize: a.byteSize,
    mime: a.mime,
    url: a.r2Key != null ? `/api/attachments/${a.id}` : null,
  }
}

/** Rows (any order) → DTOs in seq order, with sender person/label and attachments. */
export async function hydrateMessages(db: Db, ownerId: string, rows: MessageRow[]): Promise<MessageDTO[]> {
  const sorted = [...rows].sort((a, b) => a.seq - b.seq)
  const handleIds = uniq(sorted.map((m) => m.senderHandleId).filter((x): x is number => x != null))
  const handlePerson = new Map<number, number | null>()
  for (const part of chunk(handleIds, IN_CHUNK)) {
    for (const h of await db.select({ id: handles.id, personId: handles.personId }).from(handles).where(owned(handles, ownerId, inArray(handles.id, part)))) {
      handlePerson.set(h.id, h.personId)
    }
  }
  const people = await resolvePersons(
    db,
    ownerId,
    [...handlePerson.values()].filter((x): x is number => x != null),
  )
  const atts = new Map<number, AttachmentDTO[]>()
  for (const part of chunk(sorted.map((m) => m.id), IN_CHUNK)) {
    const found = await db.select().from(attachments).where(owned(attachments, ownerId, inArray(attachments.messageId, part))).orderBy(asc(attachments.id))
    for (const a of found) atts.set(a.messageId, [...(atts.get(a.messageId) ?? []), attachmentDTO(a)])
  }
  return sorted.map((m) => {
    const personId = m.senderHandleId != null ? handlePerson.get(m.senderHandleId) : null
    const person = personId != null ? people.get(personId) : undefined
    return {
      id: m.id,
      chatId: m.chatId,
      seq: m.seq,
      sentAt: m.sentAt,
      kind: m.kind,
      body: m.body,
      meta: m.meta ?? null,
      senderHandleId: m.senderHandleId,
      senderName: m.senderName,
      senderPersonId: person?.id ?? null,
      senderLabel: person?.label ?? null,
      attachments: atts.get(m.id) ?? [],
    }
  })
}

/**
 * Windowed reads (never the whole chat):
 * - `around=<messageId>&before=50&after=50` — the message plus neighbours; a message that is not in this chat falls back
 *   to the start of the chat with `anchorId: null` (a stale evidence link still opens the chat).
 * - `cursor=<seq>&dir=older|newer&limit=100` — the page strictly before / after that seq.
 * - no cursor: `dir=newer` → the first page of the chat, otherwise the last page.
 * - `personId` keeps only messages sent by that person (incl. persons merged into it).
 */
export async function listChatMessages(db: Db, ownerId: string, chatId: number, q: ChatMessagesQuery): Promise<ChatMessagesResponse> {
  await getOwnedOr404(db, chats, ownerId, chatId)

  let personCond: SQL | undefined
  if (q.personId != null) {
    const merged = await db.select({ id: persons.id }).from(persons).where(owned(persons, ownerId, eq(persons.mergedIntoId, q.personId)))
    const personIds = [q.personId, ...merged.map((p) => p.id)]
    const hs = await db.select({ id: handles.id }).from(handles).where(owned(handles, ownerId, inArray(handles.personId, personIds)))
    if (hs.length === 0) return { messages: [], hasOlder: false, hasNewer: false, anchorId: null }
    personCond = inArray(
      messages.senderHandleId,
      hs.map((h) => h.id),
    )
  }
  // every read below goes through this owner scope
  const ownerIdScope = (...conds: (SQL | undefined)[]) => owned(messages, ownerId, eq(messages.chatId, chatId), personCond, ...conds)
  const limit = q.limit ?? DEFAULT_PAGE

  if (q.around != null) {
    const anchor = await db.select().from(messages).where(ownerIdScope(eq(messages.id, q.around))).get()
    if (anchor) {
      const before = q.before ?? DEFAULT_AROUND
      const after = q.after ?? DEFAULT_AROUND
      const [older, newer] = await db.batch([
        db.select().from(messages).where(ownerIdScope(lt(messages.seq, anchor.seq))).orderBy(desc(messages.seq)).limit(before + 1),
        db.select().from(messages).where(ownerIdScope(gt(messages.seq, anchor.seq))).orderBy(asc(messages.seq)).limit(after + 1),
      ])
      const rows = [...older.slice(0, before), anchor, ...newer.slice(0, after)]
      return {
        messages: await hydrateMessages(db, ownerId, rows),
        hasOlder: older.length > before,
        hasNewer: newer.length > after,
        anchorId: anchor.id,
      }
    }
    const first = await db.select().from(messages).where(ownerIdScope()).orderBy(asc(messages.seq)).limit(limit + 1)
    return { messages: await hydrateMessages(db, ownerId, first.slice(0, limit)), hasOlder: false, hasNewer: first.length > limit, anchorId: null }
  }

  if (q.cursor != null) {
    const cursor = q.cursor
    if (q.dir === 'newer') {
      const [page, behind] = await db.batch([
        db.select().from(messages).where(ownerIdScope(gt(messages.seq, cursor))).orderBy(asc(messages.seq)).limit(limit + 1),
        db.select({ id: messages.id }).from(messages).where(ownerIdScope(lte(messages.seq, cursor))).limit(1),
      ])
      return { messages: await hydrateMessages(db, ownerId, page.slice(0, limit)), hasOlder: behind.length > 0, hasNewer: page.length > limit, anchorId: null }
    }
    const [page, ahead] = await db.batch([
      db.select().from(messages).where(ownerIdScope(lt(messages.seq, cursor))).orderBy(desc(messages.seq)).limit(limit + 1),
      db.select({ id: messages.id }).from(messages).where(ownerIdScope(gte(messages.seq, cursor))).limit(1),
    ])
    return { messages: await hydrateMessages(db, ownerId, page.slice(0, limit)), hasOlder: page.length > limit, hasNewer: ahead.length > 0, anchorId: null }
  }

  if (q.dir === 'newer') {
    const page = await db.select().from(messages).where(ownerIdScope()).orderBy(asc(messages.seq)).limit(limit + 1)
    return { messages: await hydrateMessages(db, ownerId, page.slice(0, limit)), hasOlder: false, hasNewer: page.length > limit, anchorId: null }
  }
  const page = await db.select().from(messages).where(ownerIdScope()).orderBy(desc(messages.seq)).limit(limit + 1)
  return { messages: await hydrateMessages(db, ownerId, page.slice(0, limit)), hasOlder: page.length > limit, hasNewer: false, anchorId: null }
}

