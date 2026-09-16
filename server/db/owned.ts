import { and, eq, type SQL } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { nowIso } from '@/lib/time'
import { errors } from '@/server/errors'
import * as schema from './schema'

export type Schema = typeof schema
export type Db = DrizzleD1Database<Schema>

/** Business entity tables: id / owner_id / created_at / updated_at. */
export type OwnedTable =
  | typeof schema.chats
  | typeof schema.imports
  | typeof schema.messages
  | typeof schema.attachments
  | typeof schema.persons
  | typeof schema.handles
  | typeof schema.relations
  | typeof schema.claims
  | typeof schema.events
  | typeof schema.importantDates
  | typeof schema.conversationSegments
  | typeof schema.loops
  | typeof schema.extractionJobs
  | typeof schema.reviewLog

/** Link tables: composite pk, owner_id / created_at, no id. */
export type OwnedLinkTable =
  | typeof schema.importMessages
  | typeof schema.claimMentions
  | typeof schema.eventParticipants
  | typeof schema.segmentParticipants
  | typeof schema.evidence

/** `and(eq(table.ownerId, ownerId), ...conds)` — use as the `where` of every business select/update/delete. */
export function owned(
  table: OwnedTable | OwnedLinkTable | typeof schema.userSettings,
  ownerId: string,
  ...conds: (SQL | undefined)[]
): SQL {
  if (!ownerId) throw new Error('owned(): ownerId is required')
  return and(eq(table.ownerId, ownerId), ...conds) as SQL
}

/** Loads one row by id scoped to the owner; throws ApiError 404 when missing or owned by someone else. */
export async function getOwnedOr404<T extends OwnedTable>(db: Db, table: T, ownerId: string, id: number): Promise<T['$inferSelect']> {
  // The union of table types defeats drizzle's generic inference; the where clause keeps it owner-scoped.
  const t = table as typeof schema.chats
  const row = await db.select().from(t).where(owned(table, ownerId, eq(t.id, id))).get()
  if (!row) throw errors.notFound()
  return row as T['$inferSelect']
}

/** Stamps ownerId + createdAt/updatedAt on an entity insert row. */
export function withOwner<T extends OwnedTable>(
  ownerId: string,
  row: Omit<T['$inferInsert'], 'ownerId' | 'createdAt' | 'updatedAt'>,
  now: string = nowIso(),
): T['$inferInsert'] {
  return { ...row, ownerId, createdAt: now, updatedAt: now } as T['$inferInsert']
}

/** Stamps ownerId + createdAt on a link-table insert row. */
export function withOwnerLink<T extends OwnedLinkTable>(
  ownerId: string,
  row: Omit<T['$inferInsert'], 'ownerId' | 'createdAt'>,
  now: string = nowIso(),
): T['$inferInsert'] {
  return { ...row, ownerId, createdAt: now } as T['$inferInsert']
}
