// Window planning (SPEC §8.4, §8.5; ARCHITECTURE §6). Pure.
import { minutesBetween } from '@/lib/time'
import type { WindowPlan } from './types'

export interface PlanOptions {
  gapHours?: number
  maxSize?: number
  overlap?: number
  context?: number
}

/**
 * Sessions split where consecutive messages are > gapHours apart. Inside a session, focus messages (new seq ranges)
 * are clustered; each cluster gets up to `context` existing messages on both sides, and the span is cut into windows
 * of at most `maxSize` messages overlapping by `overlap`. Windows without any focus message are not emitted.
 * With focus = everything this reduces to plain session/150/20 windowing.
 */
export function planWindows(msgs: { seq: number; sentAt: string }[], focus: [number, number][], opts: PlanOptions = {}): WindowPlan[] {
  const gapMin = (opts.gapHours ?? 3) * 60
  const maxSize = Math.max(2, opts.maxSize ?? 150)
  const overlap = Math.min(Math.max(0, opts.overlap ?? 20), maxSize - 1)
  const context = Math.max(0, opts.context ?? 20)
  const inFocus = (seq: number) => focus.some(([a, b]) => seq >= Math.min(a, b) && seq <= Math.max(a, b))

  const sorted = [...msgs].sort((a, b) => a.seq - b.seq)
  const sessions: { seq: number; sentAt: string }[][] = []
  for (const m of sorted) {
    const cur = sessions[sessions.length - 1]
    if (!cur || minutesBetween(cur[cur.length - 1].sentAt, m.sentAt) > gapMin) sessions.push([m])
    else cur.push(m)
  }

  const out: WindowPlan[] = []
  for (const s of sessions) {
    const focusIdx: number[] = []
    s.forEach((m, i) => {
      if (inFocus(m.seq)) focusIdx.push(i)
    })
    if (!focusIdx.length) continue

    // cluster focus messages separated by at most 2×context existing messages
    const clusters: [number, number][] = []
    for (const i of focusIdx) {
      const c = clusters[clusters.length - 1]
      if (c && i - c[1] - 1 <= 2 * context) c[1] = i
      else clusters.push([i, i])
    }
    const spans: [number, number][] = []
    for (const [a, b] of clusters) {
      const span: [number, number] = [Math.max(0, a - context), Math.min(s.length - 1, b + context)]
      const last = spans[spans.length - 1]
      if (last && span[0] <= last[1] + 1) last[1] = Math.max(last[1], span[1])
      else spans.push(span)
    }

    for (const [a, b] of spans) {
      let start = a
      for (;;) {
        const end = Math.min(start + maxSize - 1, b)
        const seqs = s.slice(start, end + 1).filter((m) => inFocus(m.seq)).map((m) => m.seq)
        if (seqs.length) {
          out.push({ startSeq: s[start].seq, endSeq: s[end].seq, focusStartSeq: Math.min(...seqs), focusEndSeq: Math.max(...seqs) })
        }
        if (end === b) break
        start = end - overlap + 1
      }
    }
  }
  return out
}

/**
 * Packs adjacent windows into one model call (DECISIONS ## extract X20). Two consecutive plans merge only when the
 * second starts at the message right after the first ends (no skipped or overlapping messages) and the merged span
 * holds at most `maxMessages` messages. Session boundaries stay visible in the prompt as gap separator lines; a session
 * longer than `maxMessages` keeps its own 150/20 windows.
 */
export function packWindows(plans: WindowPlan[], msgs: { seq: number }[], maxMessages: number): WindowPlan[] {
  if (plans.length < 2) return plans.map((p) => ({ ...p }))
  const pos = new Map([...msgs].sort((a, b) => a.seq - b.seq).map((m, i) => [m.seq, i] as [number, number]))
  const out: WindowPlan[] = []
  for (const p of plans) {
    const last = out[out.length - 1]
    if (last) {
      const a = pos.get(last.startSeq)
      const e = pos.get(last.endSeq)
      const s = pos.get(p.startSeq)
      const b = pos.get(p.endSeq)
      if (a !== undefined && e !== undefined && s !== undefined && b !== undefined && s === e + 1 && b - a + 1 <= maxMessages) {
        out[out.length - 1] = {
          startSeq: last.startSeq,
          endSeq: p.endSeq,
          focusStartSeq: Math.min(last.focusStartSeq, p.focusStartSeq),
          focusEndSeq: Math.max(last.focusEndSeq, p.focusEndSeq),
        }
        continue
      }
    }
    out.push({ ...p })
  }
  return out
}
