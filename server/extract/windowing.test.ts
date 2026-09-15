import { describe, expect, it } from 'vitest'
import { packWindows, planWindows } from './windowing'

function msgs(n: number, opts: { start?: string; stepMin?: number; seqStep?: number; gapsAt?: Record<number, number> } = {}) {
  const base = Date.UTC(2026, 0, 1, 8, 0) / 60_000
  let minute = base
  const out: { seq: number; sentAt: string }[] = []
  for (let i = 0; i < n; i++) {
    if (i > 0) minute += opts.gapsAt?.[i] ?? opts.stepMin ?? 1
    const d = new Date(minute * 60_000)
    const p = (x: number) => String(x).padStart(2, '0')
    out.push({ seq: i * (opts.seqStep ?? 1), sentAt: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` })
  }
  return out
}

describe('planWindows', () => {
  it('keeps a short session in one window', () => {
    expect(planWindows(msgs(40), [[0, 39]])).toEqual([{ startSeq: 0, endSeq: 39, focusStartSeq: 0, focusEndSeq: 39 }])
  })

  it('splits sessions on gaps longer than 3 hours (exactly 3 hours stays together)', () => {
    const m = msgs(30, { gapsAt: { 10: 180, 20: 181 } })
    const w = planWindows(m, [[0, 29]])
    expect(w.map((x) => [x.startSeq, x.endSeq])).toEqual([
      [0, 19],
      [20, 29],
    ])
  })

  it('cuts long sessions into 150-message windows overlapping by 20', () => {
    const w = planWindows(msgs(400), [[0, 399]])
    expect(w.map((x) => [x.startSeq, x.endSeq])).toEqual([
      [0, 149],
      [130, 279],
      [260, 399],
    ])
    for (const x of w) expect(x.endSeq - x.startSeq + 1).toBeLessThanOrEqual(150)
  })

  it('works with gapped seq numbers (steps of 1024)', () => {
    const w = planWindows(msgs(151, { seqStep: 1024 }), [[0, 150 * 1024]])
    expect(w).toEqual([
      { startSeq: 0, endSeq: 149 * 1024, focusStartSeq: 0, focusEndSeq: 149 * 1024 },
      { startSeq: 130 * 1024, endSeq: 150 * 1024, focusStartSeq: 130 * 1024, focusEndSeq: 150 * 1024 },
    ])
  })

  it('only windows new messages, with up to 20 existing messages of context on each side', () => {
    const w = planWindows(msgs(300), [[100, 109]])
    expect(w).toEqual([{ startSeq: 80, endSeq: 129, focusStartSeq: 100, focusEndSeq: 109 }])
  })

  it('context never crosses a session boundary', () => {
    const m = msgs(60, { gapsAt: { 30: 600 } })
    expect(planWindows(m, [[30, 34]])).toEqual([{ startSeq: 30, endSeq: 54, focusStartSeq: 30, focusEndSeq: 34 }])
  })

  it('merges nearby new ranges into one span and keeps distant ones apart', () => {
    const near = planWindows(msgs(300), [
      [100, 104],
      [140, 144],
    ])
    expect(near).toEqual([{ startSeq: 80, endSeq: 164, focusStartSeq: 100, focusEndSeq: 144 }])
    const far = planWindows(msgs(300), [
      [10, 12],
      [200, 202],
    ])
    expect(far.map((x) => [x.startSeq, x.endSeq])).toEqual([
      [0, 32],
      [180, 222],
    ])
  })

  it('returns nothing without focus or messages', () => {
    expect(planWindows(msgs(10), [])).toEqual([])
    expect(planWindows([], [[0, 10]])).toEqual([])
  })
})

describe('packWindows', () => {
  it('packs adjacent short sessions up to the message cap, never across a skipped message', () => {
    // sessions of 10 messages separated by 4-hour gaps
    const gaps = Object.fromEntries([10, 20, 30, 40, 50].map((i) => [i, 240]))
    const m = msgs(60, { gapsAt: gaps })
    const plans = planWindows(m, [[0, 59]])
    expect(plans).toHaveLength(6)
    expect(packWindows(plans, m, 25).map((x) => [x.startSeq, x.endSeq])).toEqual([
      [0, 19],
      [20, 39],
      [40, 59],
    ])
    expect(packWindows(plans, m, 40).map((x) => [x.startSeq, x.endSeq, x.focusStartSeq, x.focusEndSeq])).toEqual([
      [0, 39, 0, 39],
      [40, 59, 40, 59],
    ])
  })

  it('does not merge overlapping 150-message windows or windows with messages between them', () => {
    const long = msgs(400)
    const plans = planWindows(long, [[0, 399]])
    expect(packWindows(plans, long, 1000)).toEqual(plans)
    const m = msgs(300)
    const apart = planWindows(m, [
      [10, 12],
      [200, 202],
    ])
    expect(packWindows(apart, m, 1000)).toEqual(apart)
  })

  it('keeps a session longer than the cap on its own', () => {
    const m = msgs(80, { gapsAt: { 5: 600, 70: 600 } })
    const plans = planWindows(m, [[0, 79]])
    expect(packWindows(plans, m, 40).map((x) => [x.startSeq, x.endSeq])).toEqual([
      [0, 4],
      [5, 69],
      [70, 79],
    ])
  })
})
