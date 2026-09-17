// Internal helpers for the review module (not a public entry).
import type { BatchItem } from 'drizzle-orm/batch'
import type { ReviewAction, TargetType } from '@/contracts'
import { nowIso } from '@/lib/time'
import { reviewLog, withOwner, type Db } from '@/server/db'

/** NFKC + lowercase + trim (same normalisation the seed and search use for *_norm columns). */
export const norm = (s: string): string => s.normalize('NFKC').toLowerCase().trim()

export function chunk<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

export const uniq = <T>(xs: Iterable<T>): T[] => [...new Set(xs)]

/** D1 caps bound params per statement at 100; keep `inArray` lists well below it. */
export const IN_CHUNK = 90

/** Rows per multi-row insert so `rows × columns` stays under D1's 100 bound params (a few left for ON CONFLICT etc.). */
export const rowsPerInsert = (columns: number): number => Math.floor(96 / columns)
/** claim_mentions / event_participants: owner_id, left id, person_id, created_at. */
export const LINK_ROWS = rowsPerInsert(4)
/** evidence: owner_id, target_type, target_id, message_id, created_at. */
export const EVIDENCE_ROWS = rowsPerInsert(5)

/** Statements per db.batch (ARCHITECTURE §4.2: ≤ 100). One batch is atomic; longer runs commit chunk by chunk. */
export const BATCH_STATEMENTS = 100

/** Runs statements with db.batch in chunks (D1 has no interactive transactions, ARCHITECTURE §4.2). */
export async function runBatch(db: Db, stmts: BatchItem<'sqlite'>[], size = BATCH_STATEMENTS): Promise<void> {
  for (const part of chunk(stmts, size)) {
    if (part.length === 0) continue
    await db.batch(part as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  }
}

/**
 * runBatch for a write that already inserted rows outside the batch (ids needed by the batch): when the batch fails,
 * `undo` removes those rows and restores anything an earlier committed chunk changed, then the error is rethrown.
 * `undo` must be idempotent (it may run against a state where nothing of the batch was committed).
 */
export async function runBatchOrUndo(db: Db, stmts: BatchItem<'sqlite'>[], undo: () => Promise<void>): Promise<void> {
  try {
    await runBatch(db, stmts)
  } catch (e) {
    try {
      await undo()
    } catch (undoError) {
      console.error('[review] undo after failed batch also failed', undoError)
    }
    throw e
  }
}

export interface LogEntry {
  targetType: TargetType
  targetId: number
  action: ReviewAction
  before: unknown
  after: unknown
}

/** review_log insert statements, chunked so each stays under D1's bound-param cap (8 columns per row). */
export function logStatements(db: Db, ownerId: string, entries: LogEntry[], now = nowIso()): BatchItem<'sqlite'>[] {
  return chunk(entries, rowsPerInsert(8)).map((part) =>
    db.insert(reviewLog).values(
      part.map((e) =>
        withOwner<typeof reviewLog>(
          ownerId,
          { targetType: e.targetType, targetId: e.targetId, action: e.action, before: e.before ?? null, after: e.after ?? null },
          now,
        ),
      ),
    ),
  )
}
