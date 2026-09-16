// D1-backed ExtractStore (in-app). Every query is owner-scoped (ARCHITECTURE §3).
//
// Persistence runs as ordered db.batch() chunks. Each item's statements stay in one batch (a D1 batch is a transaction),
// so an item and its evidence rows are written together: a new row's id is read back inside the same batch with a
// subquery on the owner's rows, so no round trip is needed between the row and its evidence.
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { sortKey } from '@/lib/pinyin'
import { nowIso } from '@/lib/time'
import { chats, claims, conversationSegments, evidence, handles, imports, loops as loopsTable, messages, owned, persons, segmentParticipants, withOwner, type Db } from '@/server/db'
import { inverseRelation } from './memory-store'
import type { ExtractStore, KnownPerson, LoadedWindow, ResolvedItems, WindowRef } from './types'
import { normName } from './validate'

export const KNOWN_CLAIMS_PER_PERSON = 40
export const KNOWN_HANDLES_PER_PERSON = 12
/** SPEC §8.8 input side: the open loops a person carries into a window, newest first. */
export const KNOWN_OPEN_LOOPS_PER_PERSON = 12
const SIMILAR_CLAIMS_LIMIT = 200
/** dedup candidates for loops: this import's still-open loops of the person (SPEC §8.8, one call per window) */
const DEDUP_LOOPS_LIMIT = 80
const IN_CHUNK = 90
const BATCH_STATEMENTS = 90

const normCol = (s: string) => s.normalize('NFKC').toLowerCase().trim()
const idsJson = (ids: number[]) => JSON.stringify([...new Set(ids)])
const uniq = <T>(xs: T[]) => [...new Set(xs)]

async function chunked<T, R>(ids: T[], fn: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(...(await fn(ids.slice(i, i + IN_CHUNK))))
  return out
}

// drizzle's D1 batch() does not accept raw `db.run(sql)` items, so raw statements are compiled here and batched on the
// D1 binding directly (a D1 batch runs as one transaction, in order).
const dialect = new SQLiteSyncDialect()
interface Stmt {
  sql: string
  params: unknown[]
}
const q = (chunk: SQL): Stmt => dialect.sqlToQuery(chunk)

function changesOf(res: unknown): number {
  const meta = (res as { meta?: { changes?: number } } | undefined)?.meta
  return typeof meta?.changes === 'number' ? meta.changes : 0
}

export function d1Store(db: Db, ownerId: string): ExtractStore {
  const chatCache = new Map<number, { id: number; title: string; kind: 'private' | 'group' }>()

  async function importChat(importId: number) {
    const cached = chatCache.get(importId)
    if (cached) return cached
    const imp = await db
      .select({ chatId: imports.chatId })
      .from(imports)
      .where(owned(imports, ownerId, eq(imports.id, importId)))
      .get()
    if (!imp?.chatId) throw new Error('import has no chat')
    const chat = await db
      .select({ id: chats.id, title: chats.title, kind: chats.kind })
      .from(chats)
      .where(owned(chats, ownerId, eq(chats.id, imp.chatId)))
      .get()
    if (!chat) throw new Error('chat not found')
    chatCache.set(importId, chat)
    return chat
  }

  async function loadPersons(ids: number[]) {
    return chunked(ids, (chunk) =>
      db
        .select({ id: persons.id, label: persons.label, mergedIntoId: persons.mergedIntoId })
        .from(persons)
        .where(owned(persons, ownerId, inArray(persons.id, chunk)))
        .all(),
    )
  }

  return {
    async loadWindow(ref: WindowRef): Promise<LoadedWindow> {
      const chat = await importChat(ref.importId)
      const rows = await db
        .select({ id: messages.id, seq: messages.seq, sentAt: messages.sentAt, senderName: messages.senderName, senderHandleId: messages.senderHandleId, kind: messages.kind, body: messages.body, firstImportId: messages.firstImportId })
        .from(messages)
        .where(owned(messages, ownerId, eq(messages.chatId, chat.id), gte(messages.seq, ref.startSeq), lte(messages.seq, ref.endSeq)))
        .orderBy(asc(messages.seq))
        .all()

      // Persons of this chat: everyone with a handle scoped to it (senders from mapping, earlier aliases), senders, self.
      const handlePerson = new Map<number, number | null>()
      const chatHandles = await db
        .select({ id: handles.id, personId: handles.personId })
        .from(handles)
        .where(owned(handles, ownerId, eq(handles.chatId, chat.id)))
        .all()
      for (const h of chatHandles) handlePerson.set(h.id, h.personId)
      const missing = uniq(rows.map((r) => r.senderHandleId).filter((id): id is number => id !== null && !handlePerson.has(id)))
      const extra = await chunked(missing, (chunk) =>
        db
          .select({ id: handles.id, personId: handles.personId })
          .from(handles)
          .where(owned(handles, ownerId, inArray(handles.id, chunk)))
          .all(),
      )
      for (const h of extra) handlePerson.set(h.id, h.personId)

      const self = await db
        .select({ id: persons.id })
        .from(persons)
        .where(owned(persons, ownerId, eq(persons.isSelf, true), isNull(persons.mergedIntoId)))
        .orderBy(asc(persons.id))
        .get()

      const firstIds = uniq([...handlePerson.values()].filter((id): id is number => id !== null).concat(self ? [self.id] : []))
      const people = new Map((await loadPersons(firstIds)).map((p) => [p.id, p]))
      const targets = uniq([...people.values()].map((p) => p.mergedIntoId).filter((id): id is number => id !== null && !people.has(id)))
      for (const p of await loadPersons(targets)) people.set(p.id, p)
      const live = (id: number | null | undefined): number | null => {
        if (id == null) return null
        const p = people.get(id)
        if (!p) return null
        return p.mergedIntoId != null ? (people.has(p.mergedIntoId) ? p.mergedIntoId : null) : p.id
      }
      const liveIds = uniq(firstIds.map(live).filter((id): id is number => id !== null))

      const personHandles = await chunked(liveIds, (chunk) =>
        db
          .select({ personId: handles.personId, kind: handles.kind, value: handles.value, status: handles.status })
          .from(handles)
          .where(owned(handles, ownerId, inArray(handles.personId, chunk)))
          .orderBy(asc(handles.id))
          .all(),
      )
      const confirmed = await chunked(liveIds, (chunk) =>
        db
          .select({ id: claims.id, personId: claims.personId, statement: claims.statement, category: claims.category })
          .from(claims)
          .where(owned(claims, ownerId, inArray(claims.personId, chunk), eq(claims.status, 'confirmed')))
          .orderBy(desc(claims.id))
          .all(),
      )

      // Interaction input side (SPEC §8.8). `lastContact`: the latest segment of any chat this person spoke in, strictly
      // before this window's first message (hidden segments are the user saying "don't show me this", so they stay out).
      // `openLoops`: the ids the model may name in `closes`.
      const firstSentAt = rows[0]?.sentAt
      const lastContactRows = firstSentAt
        ? await chunked(liveIds, (chunk) =>
            db
              .select({ personId: segmentParticipants.personId, at: conversationSegments.startedAt, summary: conversationSegments.summary })
              .from(segmentParticipants)
              .innerJoin(conversationSegments, eq(segmentParticipants.segmentId, conversationSegments.id))
              .where(owned(segmentParticipants, ownerId, inArray(segmentParticipants.personId, chunk), eq(conversationSegments.hidden, false), lt(conversationSegments.startedAt, firstSentAt)))
              .orderBy(desc(conversationSegments.startedAt))
              .all(),
          )
        : []
      const openLoopRows = await chunked(liveIds, (chunk) =>
        db
          .select({ id: loopsTable.id, personId: loopsTable.personId, kind: loopsTable.kind, direction: loopsTable.direction, text: loopsTable.text, openedAt: loopsTable.openedAt })
          .from(loopsTable)
          .where(owned(loopsTable, ownerId, inArray(loopsTable.personId, chunk), isNull(loopsTable.closedMessageId), ne(loopsTable.status, 'rejected')))
          .orderBy(desc(loopsTable.openedAt), desc(loopsTable.id))
          .all(),
      )

      const known: KnownPerson[] = liveIds.map((id) => ({
        personId: id,
        label: people.get(id)?.label ?? '',
        handles: uniq(
          personHandles
            .filter((h) => h.personId === id && h.status !== 'rejected')
            .map((h) => JSON.stringify({ kind: h.kind, value: h.value })),
        )
          .slice(0, KNOWN_HANDLES_PER_PERSON)
          .map((s) => JSON.parse(s) as KnownPerson['handles'][number]),
        claims: confirmed
          .filter((c) => c.personId === id)
          .slice(0, KNOWN_CLAIMS_PER_PERSON)
          .reverse()
          .map((c) => ({ id: c.id, statement: c.statement, category: c.category })),
        lastContact: lastContactRows.filter((r) => r.personId === id).map((r) => ({ at: r.at, summary: r.summary }))[0] ?? null,
        openLoops: openLoopRows
          .filter((l) => l.personId === id)
          .slice(0, KNOWN_OPEN_LOOPS_PER_PERSON)
          .map((l) => ({ id: l.id, kind: l.kind, direction: l.direction, text: l.text, openedAt: l.openedAt })),
      }))

      const seqMap = new Map<number, number>()
      const windowMessages = rows.map((r, i) => {
        seqMap.set(i + 1, r.id)
        return {
          localSeq: i + 1,
          sentAt: r.sentAt,
          senderName: r.senderName,
          senderPersonId: r.senderHandleId === null ? null : live(handlePerson.get(r.senderHandleId)),
          kind: r.kind,
          body: r.body,
          // messages an earlier import brought in are context only (SPEC §8.4)
          context: r.firstImportId !== ref.importId,
        }
      })
      return {
        chat: { title: chat.title, kind: chat.kind },
        selfPersonId: live(self?.id) ?? 0,
        messages: windowMessages,
        known,
        seqMap,
        chatId: chat.id,
        span: {
          startSeq: rows[0]?.seq ?? ref.startSeq,
          endSeq: rows[rows.length - 1]?.seq ?? ref.endSeq,
          startedAt: rows[0]?.sentAt ?? '',
          endedAt: rows[rows.length - 1]?.sentAt ?? '',
        },
      }
    },

    async findSimilarClaims(personId: number, importId: number) {
      const rows = await db
        .select({ id: claims.id, statement: claims.statement, status: claims.status })
        .from(claims)
        .where(owned(claims, ownerId, eq(claims.personId, personId), or(and(eq(claims.importId, importId), inArray(claims.status, ['proposed', 'confirmed'])), eq(claims.status, 'confirmed'))))
        .orderBy(desc(claims.id))
        .limit(SIMILAR_CLAIMS_LIMIT)
        .all()
      return rows.reverse()
    },

    async findSimilarLoops(personId: number, importId: number) {
      const rows = await db
        .select({ id: loopsTable.id, text: loopsTable.text })
        .from(loopsTable)
        .where(owned(loopsTable, ownerId, eq(loopsTable.personId, personId), eq(loopsTable.importId, importId), isNull(loopsTable.closedMessageId), ne(loopsTable.status, 'rejected')))
        .orderBy(desc(loopsTable.id))
        .limit(DEDUP_LOOPS_LIMIT)
        .all()
      return rows.reverse()
    },

    async resolveTempPerson(importId: number, label: string, evidenceMessageIds: number[]) {
      const created = await db
        .select({ id: persons.id, label: persons.label })
        .from(persons)
        .where(owned(persons, ownerId, eq(persons.importId, importId), isNull(persons.mergedIntoId), eq(persons.isSelf, false)))
        .orderBy(asc(persons.id))
        .all()
      const n = normName(label)
      const exact = created.find((p) => normName(p.label) === n)
      if (exact) return exact.id
      const ev = uniq(evidenceMessageIds).slice(0, IN_CHUNK)
      if (n.length < 2 || !ev.length) return null
      for (const p of created) {
        const pl = normName(p.label)
        if (pl.length < 2 || !(pl.includes(n) || n.includes(pl))) continue
        const viaClaim = await db
          .select({ m: evidence.messageId })
          .from(evidence)
          .innerJoin(claims, and(eq(evidence.targetType, 'claim'), eq(evidence.targetId, claims.id)))
          .where(owned(evidence, ownerId, eq(claims.personId, p.id), inArray(evidence.messageId, ev)))
          .limit(1)
          .get()
        if (viaClaim) return p.id
        const viaHandle = await db
          .select({ m: evidence.messageId })
          .from(evidence)
          .innerJoin(handles, and(eq(evidence.targetType, 'handle'), eq(evidence.targetId, handles.id)))
          .where(owned(evidence, ownerId, eq(handles.personId, p.id), inArray(evidence.messageId, ev)))
          .limit(1)
          .get()
        if (viaHandle) return p.id
      }
      return null
    },

    async createPerson(importId: number, label: string) {
      const row = await db
        .insert(persons)
        .values(withOwner<typeof persons>(ownerId, { label, isSelf: false, pinned: false, labelSort: sortKey(label), importId }))
        .returning({ id: persons.id })
        .get()
      return row.id
    },

    async proposeItems(importId: number, items: ResolvedItems, ctx: { jobId: number | null; windowIndex: number }) {
      const chat = await importChat(importId)
      const now = nowIso()
      type Group = { stmts: Stmt[]; createIdx: number | null; mergeIdx: number | null }
      const groups: Group[] = []
      const inMessages = (ids: number[]) => sql`m.owner_id = ${ownerId} AND m.chat_id = ${chat.id} AND m.id IN (SELECT value FROM json_each(${idsJson(ids)}))`
      const evidenceInsert = (type: string, targetId: SQL) =>
        (ids: number[]) => q(sql`INSERT OR IGNORE INTO evidence (owner_id, created_at, target_type, target_id, message_id) SELECT ${ownerId}, ${now}, ${type}, ${targetId}, m.id FROM messages m WHERE ${inMessages(ids)}`)

      for (const c of items.claims) {
        if (!c.messageIds.length) continue
        if (c.duplicateOf !== undefined) {
          const target = sql`(SELECT id FROM claims WHERE owner_id = ${ownerId} AND id = ${c.duplicateOf})`
          groups.push({ stmts: [evidenceInsert('claim', target)(c.messageIds)], createIdx: null, mergeIdx: 0 })
          continue
        }
        const newId = sql`(SELECT max(id) FROM claims WHERE owner_id = ${ownerId})`
        const stmts: Stmt[] = [
          q(sql`INSERT INTO claims (owner_id, created_at, updated_at, person_id, statement, statement_norm, category, valid_from, learned_at, confidence, sensitive, status, status_changed_at, supersedes_claim_id, import_id, job_id, source_kind)
            VALUES (${ownerId}, ${now}, ${now}, ${c.personId}, ${c.statement}, ${normCol(c.statement)}, ${c.category}, ${c.validFrom ?? null}, ${now}, ${c.confidence}, ${c.sensitive ? 1 : 0}, 'proposed', ${now}, ${c.supersedesClaimId ?? null}, ${importId}, ${ctx.jobId}, 'ai')`),
          evidenceInsert('claim', newId)(c.messageIds),
        ]
        if (c.mentionIds.length) {
          stmts.push(q(sql`INSERT OR IGNORE INTO claim_mentions (owner_id, created_at, claim_id, person_id) SELECT ${ownerId}, ${now}, ${newId}, p.id FROM persons p WHERE p.owner_id = ${ownerId} AND p.id IN (SELECT value FROM json_each(${idsJson(c.mentionIds)}))`))
        }
        groups.push({ stmts, createIdx: 0, mergeIdx: null })
      }

      for (const h of items.handles) {
        if (!h.messageIds.length) continue
        const chatId = h.kind === 'real_name' ? null : chat.id
        const target = sql`(SELECT id FROM handles WHERE owner_id = ${ownerId} AND kind = ${h.kind} AND value = ${h.value} AND ifnull(chat_id, 0) = ${chatId ?? 0} AND person_id = ${h.personId})`
        groups.push({
          stmts: [
            q(sql`INSERT OR IGNORE INTO handles (owner_id, created_at, updated_at, person_id, kind, value, value_norm, chat_id, status, import_id, source_kind)
              VALUES (${ownerId}, ${now}, ${now}, ${h.personId}, ${h.kind}, ${h.value}, ${normCol(h.value)}, ${chatId}, 'proposed', ${importId}, 'ai')`),
            evidenceInsert('handle', target)(h.messageIds),
          ],
          createIdx: 0,
          mergeIdx: null,
        })
      }

      for (const r of items.relations) {
        if (!r.messageIds.length) continue
        const inv = inverseRelation(r.type)
        const match = sql`owner_id = ${ownerId} AND ((from_person_id = ${r.fromPersonId} AND to_person_id = ${r.toPersonId} AND type = ${r.type})${inv ? sql` OR (from_person_id = ${r.toPersonId} AND to_person_id = ${r.fromPersonId} AND type = ${inv})` : sql``})`
        groups.push({
          stmts: [
            q(sql`INSERT INTO relations (owner_id, created_at, updated_at, from_person_id, to_person_id, type, label, status, import_id, source_kind)
              SELECT ${ownerId}, ${now}, ${now}, ${r.fromPersonId}, ${r.toPersonId}, ${r.type}, ${r.label ?? null}, 'proposed', ${importId}, 'ai'
              WHERE NOT EXISTS (SELECT 1 FROM relations WHERE ${match})`),
            evidenceInsert('relation', sql`(SELECT id FROM relations WHERE ${match} ORDER BY id LIMIT 1)`)(r.messageIds),
          ],
          createIdx: 0,
          mergeIdx: null,
        })
      }

      for (const d of items.dates) {
        if (!d.messageIds.length) continue
        const match = sql`owner_id = ${ownerId} AND person_id = ${d.personId} AND kind = ${d.kind} AND calendar = ${d.calendar} AND ifnull(month, 0) = ${d.month ?? 0} AND ifnull(day, 0) = ${d.day ?? 0}`
        groups.push({
          stmts: [
            q(sql`INSERT INTO important_dates (owner_id, created_at, updated_at, person_id, kind, day, month, year, calendar, is_leap_month, label, status, import_id, source_kind)
              SELECT ${ownerId}, ${now}, ${now}, ${d.personId}, ${d.kind}, ${d.day ?? null}, ${d.month ?? null}, ${d.year ?? null}, ${d.calendar}, ${d.isLeapMonth ? 1 : 0}, NULL, 'proposed', ${importId}, 'ai'
              WHERE NOT EXISTS (SELECT 1 FROM important_dates WHERE ${match})`),
            evidenceInsert('date', sql`(SELECT id FROM important_dates WHERE ${match} ORDER BY id LIMIT 1)`)(d.messageIds),
          ],
          createIdx: 0,
          mergeIdx: null,
        })
      }

      for (const e of items.events) {
        if (!e.messageIds.length || !e.participantIds.length) continue
        const match = sql`owner_id = ${ownerId} AND import_id = ${importId} AND summary = ${e.summary}`
        const target = sql`(SELECT id FROM events WHERE ${match} ORDER BY id DESC LIMIT 1)`
        groups.push({
          stmts: [
            q(sql`INSERT INTO events (owner_id, created_at, updated_at, summary, happened_at, place, status, import_id, source_kind)
              SELECT ${ownerId}, ${now}, ${now}, ${e.summary}, ${e.happenedAt ?? null}, ${e.place ?? null}, 'proposed', ${importId}, 'ai'
              WHERE NOT EXISTS (SELECT 1 FROM events WHERE ${match})`),
            q(sql`INSERT OR IGNORE INTO event_participants (owner_id, created_at, event_id, person_id) SELECT ${ownerId}, ${now}, ${target}, p.id FROM persons p WHERE p.owner_id = ${ownerId} AND p.id IN (SELECT value FROM json_each(${idsJson(e.participantIds)}))`),
            evidenceInsert('event', target)(e.messageIds),
          ],
          createIdx: 0,
          mergeIdx: null,
        })
      }

      // ---- Interaction layer (SPEC §8.8) ---------------------------------------------------------------------
      // The segment is keyed by its span, so re-extracting it overwrites in place instead of adding a second row; its
      // participants and evidence are replaced with it, or the old rows would outlive what they describe.
      const seg = items.segment
      if (seg && seg.messageIds.length) {
        const span = sql`owner_id = ${ownerId} AND chat_id = ${seg.chatId} AND start_seq = ${seg.startSeq} AND end_seq = ${seg.endSeq}`
        const target = sql`(SELECT id FROM conversation_segments WHERE ${span})`
        const topics = JSON.stringify(seg.topics)
        const people = JSON.stringify(seg.participants.map((p) => ({ p: p.personId, m: p.messageCount })))
        groups.push({
          stmts: [
            q(sql`INSERT INTO conversation_segments (owner_id, created_at, updated_at, chat_id, start_seq, end_seq, started_at, ended_at, message_count, summary, summary_norm, topics, hidden, import_id, job_id, source_kind)
              VALUES (${ownerId}, ${now}, ${now}, ${seg.chatId}, ${seg.startSeq}, ${seg.endSeq}, ${seg.startedAt}, ${seg.endedAt}, ${seg.messageCount}, ${seg.summary}, ${normCol(seg.summary)}, ${topics}, 0, ${importId}, ${ctx.jobId}, 'ai')
              ON CONFLICT (owner_id, chat_id, start_seq, end_seq) DO UPDATE SET
                updated_at = excluded.updated_at, started_at = excluded.started_at, ended_at = excluded.ended_at,
                message_count = excluded.message_count, summary = excluded.summary, summary_norm = excluded.summary_norm,
                topics = excluded.topics, import_id = excluded.import_id, job_id = excluded.job_id, source_kind = excluded.source_kind`),
            q(sql`DELETE FROM segment_participants WHERE owner_id = ${ownerId} AND segment_id = ${target} AND person_id NOT IN (SELECT json_extract(value, '$.p') FROM json_each(${people}))`),
            q(sql`INSERT INTO segment_participants (owner_id, created_at, segment_id, person_id, message_count)
              SELECT ${ownerId}, ${now}, ${target}, p.id, json_extract(j.value, '$.m') FROM json_each(${people}) j JOIN persons p ON p.owner_id = ${ownerId} AND p.id = json_extract(j.value, '$.p') WHERE true
              ON CONFLICT (segment_id, person_id) DO UPDATE SET message_count = excluded.message_count`),
            q(sql`DELETE FROM evidence WHERE owner_id = ${ownerId} AND target_type = 'segment' AND target_id = ${target} AND message_id NOT IN (SELECT value FROM json_each(${idsJson(seg.messageIds)}))`),
            evidenceInsert('segment', target)(seg.messageIds),
          ],
          createIdx: 0,
          mergeIdx: null,
        })
      }

      for (const l of items.loops) {
        if (!l.messageIds.length) continue
        if (l.duplicateOf !== undefined) {
          const dup = sql`(SELECT id FROM loops WHERE owner_id = ${ownerId} AND id = ${l.duplicateOf})`
          groups.push({ stmts: [evidenceInsert('loop', dup)(l.messageIds)], createIdx: null, mergeIdx: 0 })
          continue
        }
        // One open loop per (person, text): a later window restating the same commitment merges its evidence.
        const match = sql`owner_id = ${ownerId} AND person_id = ${l.personId} AND text_norm = ${normCol(l.text)} AND closed_message_id IS NULL AND status <> 'rejected'`
        const target = sql`(SELECT id FROM loops WHERE ${match} ORDER BY id LIMIT 1)`
        groups.push({
          stmts: [
            q(sql`INSERT INTO loops (owner_id, created_at, updated_at, person_id, direction, kind, text, text_norm, due_at, opened_message_id, opened_at, status, import_id, job_id, source_kind)
              SELECT ${ownerId}, ${now}, ${now}, ${l.personId}, ${l.direction}, ${l.kind}, ${l.text}, ${normCol(l.text)}, ${l.dueAt ?? null}, ${l.openedMessageId}, ${l.openedAt}, 'proposed', ${importId}, ${ctx.jobId}, 'ai'
              WHERE NOT EXISTS (SELECT 1 FROM loops WHERE ${match})`),
            evidenceInsert('loop', target)(l.messageIds),
          ],
          createIdx: 0,
          mergeIdx: null,
        })
      }

      // Closing is an event, not a state change: an already-closed loop is never re-closed, so import order cannot
      // overwrite the message that actually ended it (SPEC §7 交互层).
      for (const c of items.closes) {
        groups.push({
          stmts: [
            q(sql`UPDATE loops SET closed_message_id = ${c.closedMessageId}, closed_at = ${c.closedAt}, closed_reason = ${c.reason}, updated_at = ${now}
              WHERE owner_id = ${ownerId} AND id = ${c.loopId} AND closed_message_id IS NULL`),
          ],
          createIdx: null,
          mergeIdx: null,
        })
      }

      let created = 0
      let mergedEvidence = 0
      let batch: Group[] = []
      let size = 0
      const flush = async () => {
        if (!batch.length) return
        const stmts = batch.flatMap((g) => g.stmts)
        const d1 = (db as unknown as { $client: D1Database }).$client
        const results = await d1.batch(stmts.map((st) => d1.prepare(st.sql).bind(...st.params)))
        let at = 0
        for (const g of batch) {
          if (g.createIdx !== null) created += changesOf(results[at + g.createIdx]) > 0 ? 1 : 0
          if (g.mergeIdx !== null) mergedEvidence += changesOf(results[at + g.mergeIdx])
          at += g.stmts.length
        }
        batch = []
        size = 0
      }
      for (const g of groups) {
        if (size + g.stmts.length > BATCH_STATEMENTS) await flush()
        batch.push(g)
        size += g.stmts.length
      }
      await flush()
      return { created, mergedEvidence }
    },
  }
}
