// Small query helper shared by the interaction reads. Owner scoping itself is core's `owned()` from `@/server/db`
// (ARCHITECTURE §3), whose table unions now cover `loops`, `conversation_segments` and `segment_participants`.

/** Splits an id list into IN-clause sized chunks (D1: ≤ 100 bound params per statement, ARCHITECTURE §4.2). */
export function chunk<T>(xs: T[], size = 80): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}
