import type { BatchItem } from 'drizzle-orm/batch'
import type { Db } from '@/server/db'

/** D1: ≤ 100 statements per batch (ARCHITECTURE §4.2). */
export const MAX_BATCH = 100
/** D1: ≤ 100 bound parameters per statement; leave room for the owner id and fixed params. */
export const MAX_PARAMS = 90

export function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Runs statements in ordered batches of ≤ 100 (each batch is atomic); returns the per-statement results in order. */
export async function runBatches(db: Db, items: BatchItem<'sqlite'>[]): Promise<unknown[]> {
  const out: unknown[] = []
  for (const part of chunk(items, MAX_BATCH)) {
    const res = await db.batch(part as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
    out.push(...(res as unknown[]))
  }
  return out
}

export function logImport(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, msg, module: 'import', time: new Date().toISOString(), ...fields })
  if (level === 'info') console.log(line)
  else if (level === 'warn') console.warn(line)
  else console.error(line)
}
