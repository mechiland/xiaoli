// Writes seed datasets into D1/R2: reset the seed owners' rows, allocate ids above the current max, batched inserts.
import { getTableColumns, inArray, sql } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { Db } from '@/server/db'
import * as schema from '@/server/db/schema'
import type { SeedAccountName } from './accounts'
import {
  buildIsolationAccount,
  buildMainAccount,
  createIdAllocator,
  ENTITY_TABLES,
  INSERT_ORDER,
  type AccountDataset,
  type EntityTableName,
  type SeedTables,
} from './dataset'

/** D1 caps bound parameters per statement at 100. */
const MAX_PARAMS = 100
const STATEMENTS_PER_BATCH = 60
/** gap above the current max id so rows the running app inserts meanwhile don't collide */
const ID_GAP = 100

const TABLES: Record<keyof SeedTables, SQLiteTable> = {
  chats: schema.chats,
  imports: schema.imports,
  persons: schema.persons,
  handles: schema.handles,
  messages: schema.messages,
  importMessages: schema.importMessages,
  attachments: schema.attachments,
  claims: schema.claims,
  claimMentions: schema.claimMentions,
  events: schema.events,
  eventParticipants: schema.eventParticipants,
  importantDates: schema.importantDates,
  relations: schema.relations,
  evidence: schema.evidence,
  extractionJobs: schema.extractionJobs,
  reviewLog: schema.reviewLog,
  llmCalls: schema.llmCalls,
  userSettings: schema.userSettings,
}

/** Children before parents; messages before handles (avoids SET NULL updates), persons before imports. */
export const DELETE_ORDER: (keyof SeedTables)[] = ['evidence', 'claimMentions', 'eventParticipants', 'attachments', 'importMessages', 'llmCalls', 'reviewLog', 'extractionJobs', 'claims', 'events', 'importantDates', 'relations', 'messages', 'handles', 'persons', 'imports', 'chats', 'userSettings']

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function withBusyRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const msg = String((err as Error)?.message ?? err) + String((err as { cause?: Error })?.cause?.message ?? '')
      if (attempt >= 5 || !/SQLITE_BUSY|database is locked/i.test(msg)) throw err
      await sleep(200 * 2 ** attempt)
    }
  }
}

type BatchItem = Parameters<Db['batch']>[0][number]

async function runBatches(db: Db, stmts: BatchItem[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += STATEMENTS_PER_BATCH) {
    const chunk = stmts.slice(i, i + STATEMENTS_PER_BATCH) as [BatchItem, ...BatchItem[]]
    await withBusyRetry(() => db.batch(chunk))
  }
}

export async function resetOwners(db: Db, ownerIds: string[]): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {}
  if (!ownerIds.length) return deleted
  for (const key of DELETE_ORDER) {
    const table = TABLES[key] as typeof schema.claims
    const res = await withBusyRetry(() => db.delete(table).where(inArray(table.ownerId, ownerIds)).run())
    deleted[key] = (res as { meta?: { changes?: number } }).meta?.changes ?? 0
  }
  return deleted
}

export async function clearR2(r2: R2Bucket, ownerId: string): Promise<number> {
  let n = 0
  let cursor: string | undefined
  do {
    const list = await r2.list({ prefix: `u/${ownerId}/`, cursor, limit: 1000 })
    const keys = list.objects.map((o) => o.key)
    if (keys.length) await r2.delete(keys)
    n += keys.length
    cursor = list.truncated ? list.cursor : undefined
  } while (cursor)
  return n
}

async function maxIds(db: Db): Promise<Partial<Record<EntityTableName, number>>> {
  const out: Partial<Record<EntityTableName, number>> = {}
  for (const name of ENTITY_TABLES) {
    const table = TABLES[name] as typeof schema.chats
    const row = await db.select({ m: sql<number | null>`max(${table.id})` }).from(table).get()
    out[name] = (row?.m ?? 0) + ID_GAP
  }
  return out
}

export async function insertDataset(db: Db, ds: AccountDataset): Promise<number> {
  const stmts: BatchItem[] = []
  for (const key of INSERT_ORDER) {
    const rows = ds.tables[key] as Record<string, unknown>[]
    if (!rows.length) continue
    const table = TABLES[key]
    const perStmt = Math.max(1, Math.floor(MAX_PARAMS / Object.keys(getTableColumns(table)).length))
    for (let i = 0; i < rows.length; i += perStmt) {
      stmts.push(db.insert(table).values(rows.slice(i, i + perStmt) as never) as unknown as BatchItem)
    }
  }
  await runBatches(db, stmts)
  return stmts.length
}

export interface SeedResult {
  datasets: Partial<Record<SeedAccountName, AccountDataset>>
  deleted: Record<string, number>
  r2Deleted: number
  statements: number
  ms: { reset: number; build: number; insert: number; r2: number; total: number }
}

/** Resets and re-creates business data for the given seed owners. Never touches other users' rows. */
export async function seedAccounts(db: Db, r2: R2Bucket, owners: Partial<Record<SeedAccountName, string>>, opts: { today: string; now: Date }): Promise<SeedResult> {
  const t0 = performance.now()
  const ownerIds = Object.values(owners).filter((v): v is string => Boolean(v))
  const deleted = await resetOwners(db, ownerIds)
  let r2Deleted = 0
  for (const id of ownerIds) r2Deleted += await clearR2(r2, id)
  const t1 = performance.now()

  const ids = createIdAllocator(await maxIds(db))
  const datasets: SeedResult['datasets'] = {}
  if (owners.seed) datasets.seed = buildMainAccount(owners.seed, ids, opts)
  if (owners.seed2) datasets.seed2 = buildIsolationAccount(owners.seed2, ids, opts)
  if (owners.empty) datasets.empty = { tables: (await import('./dataset')).emptyTables(), r2: [], refs: { persons: {}, imports: {}, chats: {}, claims: {} }, counts: { visiblePersons: 0 } }
  const t2 = performance.now()

  let statements = 0
  for (const ds of Object.values(datasets)) statements += await insertDataset(db, ds)
  const t3 = performance.now()
  for (const ds of Object.values(datasets)) {
    for (const obj of ds.r2) await r2.put(obj.key, obj.bytes, { httpMetadata: { contentType: obj.mime } })
  }
  const t4 = performance.now()
  const ms = (a: number, b: number) => Math.round(b - a)
  return { datasets, deleted, r2Deleted, statements, ms: { reset: ms(t0, t1), build: ms(t1, t2), insert: ms(t2, t3), r2: ms(t3, t4), total: ms(t0, t4) } }
}
