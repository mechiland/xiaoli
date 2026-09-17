// Internal helpers for the person module (not a public entry).

export function chunk<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

export const uniq = <T>(xs: Iterable<T>): T[] => [...new Set(xs)]

/** D1 caps bound params per statement at 100; keep `inArray` lists well below it. */
export const IN_CHUNK = 90

/** Statements per db.batch (ARCHITECTURE §4.2: ≤ 100). */
export const BATCH_STATEMENTS = 100
