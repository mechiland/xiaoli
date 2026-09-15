// Full owner export and delete-all (ARCHITECTURE §2.4 ExportDump, §11 "Delete all data" / "Export"). Owner: settings.
import { asc, eq, sql } from 'drizzle-orm'
import type { DeleteAllResponse, ExportDump } from '@/contracts'
import { DEFAULT_TZ, nowIso, todayInTz } from '@/lib/time'
import {
  attachments,
  chats,
  claimMentions,
  claims,
  eventParticipants,
  events,
  evidence,
  extractionJobs,
  getUserSettings,
  handles,
  importantDates,
  importMessages,
  imports,
  llmCalls,
  messages,
  owned,
  persons,
  relations,
  reviewLog,
  userSettings,
  type Db,
} from '@/server/db'

/** §11 delete order (children before parents). The response `deleted` has exactly these keys, in this order. */
export const DELETE_ALL_TABLES = [
  'evidence',
  'claim_mentions',
  'event_participants',
  'claims',
  'events',
  'important_dates',
  'relations',
  'handles',
  'attachments',
  'import_messages',
  'messages',
  'extraction_jobs',
  'llm_calls',
  'review_log',
  'imports',
  'chats',
  'persons',
  'user_settings',
] as const
export type DeleteAllTable = (typeof DELETE_ALL_TABLES)[number]

/** ExportDump row-array keys (§2.4), same tables as delete-all minus user_settings (exported as `settings`). */
export const EXPORT_TABLE_KEYS = [
  'chats',
  'imports',
  'importMessages',
  'messages',
  'attachments',
  'persons',
  'handles',
  'relations',
  'claims',
  'claimMentions',
  'events',
  'eventParticipants',
  'importantDates',
  'evidence',
  'extractionJobs',
  'reviewLog',
  'llmCalls',
] as const
export type ExportTableKey = (typeof EXPORT_TABLE_KEYS)[number]

/** Rows per page when reading a table for export (keeps each D1 result small). */
const EXPORT_PAGE = 2000

type Row = Record<string, unknown>

function stripOwner(row: Row): Row {
  const { ownerId: _omit, ...rest } = row
  return rest
}

/** Reads every row of one table for the owner, in pages, in a stable order. */
async function readAll(fetchPage: (limit: number, offset: number) => Promise<Row[]>): Promise<Row[]> {
  const out: Row[] = []
  for (let offset = 0; ; offset += EXPORT_PAGE) {
    const page = await fetchPage(EXPORT_PAGE, offset)
    for (const r of page) out.push(stripOwner(r))
    if (page.length < EXPORT_PAGE) return out
  }
}

/** Full JSON dump of one owner's data. Attachments are metadata rows only (no bytes). ownerId is never serialized. */
export async function buildExportDump(db: Db, user: { id: string; email: string; name: string }): Promise<ExportDump> {
  const o = user.id
  // Entity tables: ordered by id. Link tables: ordered by their composite pk. llm_calls has a nullable owner_id and no FK.
  const readers: Record<ExportTableKey, (limit: number, offset: number) => Promise<Row[]>> = {
    chats: (l, s) => db.select().from(chats).where(owned(chats, o)).orderBy(asc(chats.id)).limit(l).offset(s),
    imports: (l, s) => db.select().from(imports).where(owned(imports, o)).orderBy(asc(imports.id)).limit(l).offset(s),
    importMessages: (l, s) =>
      db.select().from(importMessages).where(owned(importMessages, o)).orderBy(asc(importMessages.importId), asc(importMessages.messageId)).limit(l).offset(s),
    messages: (l, s) => db.select().from(messages).where(owned(messages, o)).orderBy(asc(messages.id)).limit(l).offset(s),
    attachments: (l, s) => db.select().from(attachments).where(owned(attachments, o)).orderBy(asc(attachments.id)).limit(l).offset(s),
    persons: (l, s) => db.select().from(persons).where(owned(persons, o)).orderBy(asc(persons.id)).limit(l).offset(s),
    handles: (l, s) => db.select().from(handles).where(owned(handles, o)).orderBy(asc(handles.id)).limit(l).offset(s),
    relations: (l, s) => db.select().from(relations).where(owned(relations, o)).orderBy(asc(relations.id)).limit(l).offset(s),
    claims: (l, s) => db.select().from(claims).where(owned(claims, o)).orderBy(asc(claims.id)).limit(l).offset(s),
    claimMentions: (l, s) =>
      db.select().from(claimMentions).where(owned(claimMentions, o)).orderBy(asc(claimMentions.claimId), asc(claimMentions.personId)).limit(l).offset(s),
    events: (l, s) => db.select().from(events).where(owned(events, o)).orderBy(asc(events.id)).limit(l).offset(s),
    eventParticipants: (l, s) =>
      db.select().from(eventParticipants).where(owned(eventParticipants, o)).orderBy(asc(eventParticipants.eventId), asc(eventParticipants.personId)).limit(l).offset(s),
    importantDates: (l, s) => db.select().from(importantDates).where(owned(importantDates, o)).orderBy(asc(importantDates.id)).limit(l).offset(s),
    evidence: (l, s) =>
      db.select().from(evidence).where(owned(evidence, o)).orderBy(asc(evidence.targetType), asc(evidence.targetId), asc(evidence.messageId)).limit(l).offset(s),
    extractionJobs: (l, s) => db.select().from(extractionJobs).where(owned(extractionJobs, o)).orderBy(asc(extractionJobs.id)).limit(l).offset(s),
    reviewLog: (l, s) => db.select().from(reviewLog).where(owned(reviewLog, o)).orderBy(asc(reviewLog.id)).limit(l).offset(s),
    llmCalls: (l, s) => db.select().from(llmCalls).where(eq(llmCalls.ownerId, o)).orderBy(asc(llmCalls.id)).limit(l).offset(s), // owner-checked: llm_calls has a nullable owner_id (§4.1), not an OwnedTable
  }

  const settings = await getUserSettings(db, o)
  const tables = {} as Record<ExportTableKey, Row[]>
  // Sequential: one D1 query at a time keeps the local WAL lock short and memory flat.
  for (const key of EXPORT_TABLE_KEYS) tables[key] = await readAll(readers[key])

  return {
    exportedAt: nowIso(),
    version: 1,
    user: { id: user.id, email: user.email, name: user.name },
    settings,
    ...tables,
  }
}

/**
 * `xiaoli-export-20260916.json`: the calendar date in `tz` (APP_TZ, §3 "today"), so the label matches
 * the local dates shown everywhere else (an export at 00:40 Asia/Shanghai is dated that local day, not UTC's).
 */
export function exportFileName(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  return `xiaoli-export-${todayInTz(tz, now).replaceAll('-', '')}.json`
}

type BatchItem = Parameters<Db['batch']>[0][number]

/** Deletes every R2 object under `u/<ownerId>/`. Returns the number of objects deleted. */
export async function deleteOwnerObjects(r2: R2Bucket, ownerId: string): Promise<number> {
  if (!ownerId) throw new Error('deleteOwnerObjects: ownerId is required')
  const prefix = `u/${ownerId}/`
  let n = 0
  // Re-list from the start after each delete: the listing shrinks, so no cursor is needed and nothing is skipped.
  for (;;) {
    const keys = (await r2.list({ prefix, limit: 1000 })).objects.map((obj) => obj.key)
    if (keys.length === 0) return n
    await r2.delete(keys)
    n += keys.length
  }
}

/**
 * Deletes all business data of one owner (§11 order) in ONE D1 batch (atomic: all tables or none),
 * then the owner's R2 prefix. Better Auth tables are kept. Idempotent: running it again deletes 0 rows.
 */
export async function deleteAllData(db: Db, r2: R2Bucket | undefined, ownerId: string): Promise<DeleteAllResponse> {
  const o = ownerId
  const statements: Record<DeleteAllTable, BatchItem> = {
    evidence: db.delete(evidence).where(owned(evidence, o)),
    claim_mentions: db.delete(claimMentions).where(owned(claimMentions, o)),
    event_participants: db.delete(eventParticipants).where(owned(eventParticipants, o)),
    claims: db.delete(claims).where(owned(claims, o)),
    events: db.delete(events).where(owned(events, o)),
    important_dates: db.delete(importantDates).where(owned(importantDates, o)),
    relations: db.delete(relations).where(owned(relations, o)),
    handles: db.delete(handles).where(owned(handles, o)),
    attachments: db.delete(attachments).where(owned(attachments, o)),
    import_messages: db.delete(importMessages).where(owned(importMessages, o)),
    messages: db.delete(messages).where(owned(messages, o)),
    extraction_jobs: db.delete(extractionJobs).where(owned(extractionJobs, o)),
    llm_calls: db.delete(llmCalls).where(eq(llmCalls.ownerId, o)), // owner-checked: llm_calls has a nullable owner_id (§4.1)
    review_log: db.delete(reviewLog).where(owned(reviewLog, o)),
    imports: db.delete(imports).where(owned(imports, o)),
    chats: db.delete(chats).where(owned(chats, o)),
    // merged_into_id is a self-FK (set null); one statement deletes all persons so no row is left dangling.
    persons: db.delete(persons).where(owned(persons, o)),
    user_settings: db.delete(userSettings).where(owned(userSettings, o)),
  }
  // Counts run inside the same atomic batch, before the deletes: D1's meta.changes also counts FK "set null" updates
  // (e.g. persons.merged_into_id), so it is not a reliable per-table row count.
  const c = sql<number>`count(*)`
  const counts: Record<DeleteAllTable, BatchItem> = {
    evidence: db.select({ n: c }).from(evidence).where(owned(evidence, o)),
    claim_mentions: db.select({ n: c }).from(claimMentions).where(owned(claimMentions, o)),
    event_participants: db.select({ n: c }).from(eventParticipants).where(owned(eventParticipants, o)),
    claims: db.select({ n: c }).from(claims).where(owned(claims, o)),
    events: db.select({ n: c }).from(events).where(owned(events, o)),
    important_dates: db.select({ n: c }).from(importantDates).where(owned(importantDates, o)),
    relations: db.select({ n: c }).from(relations).where(owned(relations, o)),
    handles: db.select({ n: c }).from(handles).where(owned(handles, o)),
    attachments: db.select({ n: c }).from(attachments).where(owned(attachments, o)),
    import_messages: db.select({ n: c }).from(importMessages).where(owned(importMessages, o)),
    messages: db.select({ n: c }).from(messages).where(owned(messages, o)),
    extraction_jobs: db.select({ n: c }).from(extractionJobs).where(owned(extractionJobs, o)),
    llm_calls: db.select({ n: c }).from(llmCalls).where(eq(llmCalls.ownerId, o)), // owner-checked: nullable owner_id (§4.1)
    review_log: db.select({ n: c }).from(reviewLog).where(owned(reviewLog, o)),
    imports: db.select({ n: c }).from(imports).where(owned(imports, o)),
    chats: db.select({ n: c }).from(chats).where(owned(chats, o)),
    persons: db.select({ n: c }).from(persons).where(owned(persons, o)),
    user_settings: db.select({ n: c }).from(userSettings).where(owned(userSettings, o)),
  }
  const ordered = [...DELETE_ALL_TABLES.map((t) => counts[t]), ...DELETE_ALL_TABLES.map((t) => statements[t])] as [BatchItem, ...BatchItem[]]
  const results = (await db.batch(ordered)) as unknown as unknown[]
  const deleted = {} as Record<DeleteAllTable, number>
  DELETE_ALL_TABLES.forEach((t, i) => {
    const rows = results[i] as { n: number }[] | undefined
    deleted[t] = Number(rows?.[0]?.n ?? 0)
  })

  const r2Objects = r2 ? await deleteOwnerObjects(r2, o) : 0
  return { deleted, r2Objects }
}

/** Row counts per §11 table for one owner (tests, scenario checks). */
export async function countOwnerRows(db: Db, ownerId: string): Promise<Record<DeleteAllTable, number>> {
  const o = ownerId
  const c = sql<number>`count(*)`
  const one = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0)
  return {
    evidence: await one(db.select({ n: c }).from(evidence).where(owned(evidence, o))),
    claim_mentions: await one(db.select({ n: c }).from(claimMentions).where(owned(claimMentions, o))),
    event_participants: await one(db.select({ n: c }).from(eventParticipants).where(owned(eventParticipants, o))),
    claims: await one(db.select({ n: c }).from(claims).where(owned(claims, o))),
    events: await one(db.select({ n: c }).from(events).where(owned(events, o))),
    important_dates: await one(db.select({ n: c }).from(importantDates).where(owned(importantDates, o))),
    relations: await one(db.select({ n: c }).from(relations).where(owned(relations, o))),
    handles: await one(db.select({ n: c }).from(handles).where(owned(handles, o))),
    attachments: await one(db.select({ n: c }).from(attachments).where(owned(attachments, o))),
    import_messages: await one(db.select({ n: c }).from(importMessages).where(owned(importMessages, o))),
    messages: await one(db.select({ n: c }).from(messages).where(owned(messages, o))),
    extraction_jobs: await one(db.select({ n: c }).from(extractionJobs).where(owned(extractionJobs, o))),
    llm_calls: await one(db.select({ n: c }).from(llmCalls).where(eq(llmCalls.ownerId, o))), // owner-checked: nullable owner_id
    review_log: await one(db.select({ n: c }).from(reviewLog).where(owned(reviewLog, o))),
    imports: await one(db.select({ n: c }).from(imports).where(owned(imports, o))),
    chats: await one(db.select({ n: c }).from(chats).where(owned(chats, o))),
    persons: await one(db.select({ n: c }).from(persons).where(owned(persons, o))),
    user_settings: await one(db.select({ n: c }).from(userSettings).where(owned(userSettings, o))),
  }
}
