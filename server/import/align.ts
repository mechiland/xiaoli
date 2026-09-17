// Message dedup by sequence alignment (SPEC §8.4, ARCHITECTURE §1.4). Pure: no DB, no Node APIs.
//
// Messages carry no ids in the export, so a re-exported chat is merged by aligning fingerprint SEQUENCES
// (longest common subsequence), never by per-fingerprint lookup: two "嗯" sent in the same minute share a
// fingerprint and must both survive.
import type { ParsedMessage } from '@/contracts'

export const SEQ_STEP = 1024

export interface AlignResult {
  /** incoming messages that are already stored */
  reuse: { incomingIdx: number; messageId: number }[]
  /** incoming messages to insert, with their final seq */
  insert: { incomingIdx: number; seq: number }[]
  /** existing messages whose seq changes (only when a gap between existing seqs is too small) */
  resequence: { messageId: number; seq: number }[]
  /** [firstSeq, lastSeq] of each run of consecutive inserted messages, in chat order */
  newSeqRanges: [number, number][]
}

/** `sentAt` (optional, additive to the §1.4 signature) places unmatched messages by time between matched anchors. */
type Existing = { id: number; seq: number; fingerprint: string; sentAt?: string }

/**
 * Aligns `incoming` (export order) against `existing` (any order; sorted by seq here).
 * `incomingIdx` is the position in the `incoming` array.
 */
export function alignMessages(existing: Existing[], incoming: ParsedMessage[]): AlignResult {
  const ex = [...existing].sort((a, b) => a.seq - b.seq)
  const pairs = lcsPairs(
    ex.map((e) => e.fingerprint),
    incoming.map((m) => m.fingerprint),
  )

  // matchOf[incomingIdx] = index into ex, or -1
  const matchOf = new Int32Array(incoming.length).fill(-1)
  for (const [i, j] of pairs) matchOf[j] = i

  // nextMatch[j] = index into ex of the first matched incoming message at or after j (ex.length if none)
  const nextMatch = new Int32Array(incoming.length + 1)
  nextMatch[incoming.length] = ex.length
  for (let j = incoming.length - 1; j >= 0; j--) nextMatch[j] = matchOf[j] >= 0 ? matchOf[j] : nextMatch[j + 1]

  // An unmatched incoming message goes after the previous matched existing message (lastEx) and before the next one;
  // between those anchors it follows the last existing message sent at or before it (existing order is time order),
  // never before an earlier unmatched message of the same export.
  // gaps: key = index of the existing message they follow (-1 = before the first), value = incoming idxs in order.
  const gaps = new Map<number, number[]>()
  let lastEx = -1
  let lastPos = -1
  for (let j = 0; j < incoming.length; j++) {
    const m = matchOf[j]
    if (m >= 0) {
      lastEx = m
      lastPos = m
      continue
    }
    const pos = Math.max(lastPos, placeByTime(ex, lastEx, nextMatch[j], incoming[j].sentAt))
    lastPos = pos
    const list = gaps.get(pos)
    if (list) list.push(j)
    else gaps.set(pos, [j])
  }

  const unit = chooseRenumberUnit(ex, gaps)
  const seqOf = (i: number) => (unit === null ? ex[i].seq : (i + 1) * unit)
  const resequence = unit === null ? [] : ex.map((e, i) => ({ messageId: e.id, seq: (i + 1) * unit }))

  const insertSeq = new Map<number, number>()
  for (const [after, list] of gaps) {
    const lo = after >= 0 ? seqOf(after) : 0
    const hi = after + 1 < ex.length ? seqOf(after + 1) : null
    if (hi === null) {
      list.forEach((j, k) => insertSeq.set(j, lo + SEQ_STEP * (k + 1)))
    } else {
      const step = Math.floor((hi - lo) / (list.length + 1))
      list.forEach((j, k) => insertSeq.set(j, lo + step * (k + 1)))
    }
  }

  const reuse: AlignResult['reuse'] = []
  const insert: AlignResult['insert'] = []
  for (let j = 0; j < incoming.length; j++) {
    if (matchOf[j] >= 0) reuse.push({ incomingIdx: j, messageId: ex[matchOf[j]].id })
    else insert.push({ incomingIdx: j, seq: insertSeq.get(j)! })
  }

  const top = Math.max(ex.length ? seqOf(ex.length - 1) : 0, ...insert.map((x) => x.seq))
  if (!(top <= MAX_SEQ)) throw new Error('alignMessages: seq space exhausted')

  return { reuse, insert, resequence, newSeqRanges: seqRanges(ex.map((_, i) => seqOf(i)), insert.map((x) => x.seq)) }
}

/**
 * Largest k in [lo, hi) with ex[k].sentAt <= sentAt (k = lo means "right after the anchor lo"; lo may be -1).
 * Binary search: existing messages in seq order are in time order. Without sentAt → lo.
 */
function placeByTime(ex: Existing[], lo: number, hi: number, sentAt: string): number {
  let a = lo + 1
  let b = hi // search in [a, b)
  if (a >= b || ex[a].sentAt === undefined) return lo
  while (a < b) {
    const mid = (a + b) >> 1
    if ((ex[mid].sentAt ?? '') <= sentAt) a = mid + 1
    else b = mid
  }
  return a - 1
}

/** Every stored and inserted seq stays at or below this (exact in JS doubles and far inside SQLite's int64). */
export const MAX_SEQ = 2 ** 52
/** Stored seqs above this are renumbered on the next import even when the gaps have room (legacy ×1024 rescales). */
const RENUMBER_ABOVE = 2 ** 44

/**
 * null when the stored seqs already leave room for every gap's inserts. Otherwise the chat is renumbered:
 * stored message k (0-based, seq order) → (k + 1) * unit, where unit is the smallest power of two that gives the
 * largest bounded gap SEQ_STEP of spacing per insert. A renumber never multiplies earlier values, so repeated
 * prepends cannot grow seqs without bound: max seq ≈ stored count × unit + appended count × SEQ_STEP.
 */
function chooseRenumberUnit(ex: Existing[], gaps: Map<number, number[]>): number | null {
  let fits = ex.length === 0 || ex[ex.length - 1].seq <= RENUMBER_ABOVE
  let largest = 0
  for (const [after, list] of gaps) {
    const lo = after >= 0 ? ex[after].seq : 0
    const hi = after + 1 < ex.length ? ex[after + 1].seq : null
    if (hi === null) continue
    largest = Math.max(largest, list.length)
    if (hi - lo < list.length + 1) fits = false
  }
  if (fits) return null
  let unit = SEQ_STEP
  while (unit < (largest + 1) * SEQ_STEP) unit *= 2
  return unit
}

/** Runs of inserted seqs with no existing seq between them. */
function seqRanges(existingSeqs: number[], inserted: number[]): [number, number][] {
  if (inserted.length === 0) return []
  const all = [...existingSeqs.map((s) => ({ s, ins: false })), ...inserted.map((s) => ({ s, ins: true }))].sort((a, b) => a.s - b.s)
  const out: [number, number][] = []
  let cur: [number, number] | null = null
  for (const x of all) {
    if (x.ins) {
      if (cur) cur[1] = x.s
      else cur = [x.s, x.s]
    } else if (cur) {
      out.push(cur)
      cur = null
    }
  }
  if (cur) out.push(cur)
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// LCS

/** Above this many edit steps Myers' trace gets too large for a Worker; fall back to a greedy alignment. */
export const MAX_EDIT_DISTANCE = 1000

/**
 * Index pairs [ai, bj] of a longest common subsequence of `a` and `b` (strictly increasing in both).
 * Steps: drop elements whose value does not occur in the other sequence (they can never match, and this makes a
 * disjoint re-import O(n)), trim the common prefix/suffix, then Myers O((N+M)·D) on what is left.
 */
export function lcsPairs(a: string[], b: string[]): [number, number][] {
  const inB = new Set(b)
  const inA = new Set(a)
  const ai = a.flatMap((v, i) => (inB.has(v) ? [i] : []))
  const bj = b.flatMap((v, j) => (inA.has(v) ? [j] : []))
  const fa = ai.map((i) => a[i])
  const fb = bj.map((j) => b[j])

  const out: [number, number][] = []
  let start = 0
  while (start < fa.length && start < fb.length && fa[start] === fb[start]) {
    out.push([ai[start], bj[start]])
    start++
  }
  let endA = fa.length
  let endB = fb.length
  const suffix: [number, number][] = []
  while (endA > start && endB > start && fa[endA - 1] === fb[endB - 1]) {
    endA--
    endB--
    suffix.push([ai[endA], bj[endB]])
  }
  const midA = fa.slice(start, endA)
  const midB = fb.slice(start, endB)
  const mid = myers(midA, midB) ?? greedy(midA, midB)
  for (const [x, y] of mid) out.push([ai[start + x], bj[start + y]])
  for (let k = suffix.length - 1; k >= 0; k--) out.push(suffix[k])
  return out
}

/** Myers' greedy shortest-edit-script; returns matched index pairs, or null when D exceeds MAX_EDIT_DISTANCE. */
function myers(a: string[], b: string[]): [number, number][] | null {
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0) return []
  const max = Math.min(n + m, MAX_EDIT_DISTANCE)
  const offset = max + 1
  let v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    const next = v.slice()
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1]
      else x = v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      next[offset + k] = x
      if (x >= n && y >= m) {
        trace.push(next)
        return backtrack(trace, a, b, offset)
      }
    }
    trace.push(next)
    v = next
  }
  return null
}

function backtrack(trace: Int32Array[], a: string[], b: string[], offset: number): [number, number][] {
  const pairs: [number, number][] = []
  let x = a.length
  let y = b.length
  for (let d = trace.length - 1; d >= 0; d--) {
    const k = x - y
    let prevK: number
    if (d === 0) prevK = 0
    else {
      const v = trace[d - 1]
      prevK = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1
    }
    const prevX = d === 0 ? 0 : trace[d - 1][offset + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x--
      y--
      pairs.push([x, y])
    }
    if (d > 0) {
      x = prevX
      y = prevY
    }
  }
  return pairs.reverse()
}

/** Fallback for pathological inputs: walk both sequences, matching the nearest equal element ahead. Not optimal. */
function greedy(a: string[], b: string[]): [number, number][] {
  const pos = new Map<string, number[]>()
  b.forEach((v, j) => {
    const l = pos.get(v)
    if (l) l.push(j)
    else pos.set(v, [j])
  })
  const pairs: [number, number][] = []
  let lastJ = -1
  for (let i = 0; i < a.length; i++) {
    const l = pos.get(a[i])
    if (!l) continue
    const j = l.find((x) => x > lastJ)
    if (j === undefined) continue
    pairs.push([i, j])
    lastJ = j
  }
  return pairs
}
