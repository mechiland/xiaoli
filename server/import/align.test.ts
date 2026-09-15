import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ParsedMessage } from '@/contracts'
import { fingerprint, parseExportText, parseExportZip } from '@/lib/wechat-export'
import { alignMessages, lcsPairs, SEQ_STEP } from './align'

const FIXTURES = path.resolve(__dirname, '..', '..', 'fixtures', 'synthetic')
const load = async (name: string) => parseExportZip(new Uint8Array(readFileSync(path.join(FIXTURES, name))), { fileName: name })

function msg(idx: number, senderName: string, sentAt: string, body: string): ParsedMessage {
  return { idx, senderName, sentAt, kind: 'text', body, meta: null, fingerprint: fingerprint({ senderName, sentAt, body, kind: 'text' }), attachmentName: null }
}

/** Stores `incoming` as if it were the first import: ids 1.., seqs 1024, 2048, ... */
function stored(ms: ParsedMessage[]) {
  return ms.map((m, i) => ({ id: i + 1, seq: (i + 1) * SEQ_STEP, fingerprint: m.fingerprint, sentAt: m.sentAt }))
}

/** Applies an AlignResult and returns the merged chat as fingerprints in seq order. */
function merged(existing: { id: number; seq: number; fingerprint: string }[], incoming: ParsedMessage[]) {
  const r = alignMessages(existing, incoming)
  const reseq = new Map(r.resequence.map((x) => [x.messageId, x.seq]))
  const rows = [
    ...existing.map((e) => ({ seq: reseq.get(e.id) ?? e.seq, fp: e.fingerprint })),
    ...r.insert.map((x) => ({ seq: x.seq, fp: incoming[x.incomingIdx].fingerprint })),
  ].sort((a, b) => a.seq - b.seq)
  return { r, rows }
}

describe('alignMessages', () => {
  it('partial-overlap synthetic pair: the 32 shared messages are reused, the rest appended once', async () => {
    const first = await load('聊天记录_20260405_223012.zip')
    const second = await load('聊天记录_20260914_211545.zip')
    const existing = stored(first.messages)
    const { r, rows } = merged(existing, second.messages)

    expect(r.reuse).toHaveLength(32)
    expect(r.insert).toHaveLength(second.messages.length - 32)
    expect(r.resequence).toEqual([])
    // reused messages are exactly the first 32 of the second export and the last 32 of the first
    expect(r.reuse.map((x) => x.incomingIdx)).toEqual([...Array(32).keys()])
    expect(r.reuse.map((x) => x.messageId)).toEqual(existing.slice(-32).map((e) => e.id))
    // new messages form one range after the existing ones
    expect(r.newSeqRanges).toEqual([[r.insert[0].seq, r.insert.at(-1)!.seq]])
    expect(r.insert[0].seq).toBeGreaterThan(existing.at(-1)!.seq)
    // merged chat = first export followed by the non-overlapping tail of the second, no duplicates
    expect(rows.map((x) => x.fp)).toEqual([...first.messages, ...second.messages.slice(32)].map((m) => m.fingerprint))
    expect(new Set(rows.map((x) => x.seq)).size).toBe(rows.length)
  })

  it('re-importing the same export reuses everything and creates no ranges', async () => {
    const first = await load('聊天记录_20260405_223012.zip')
    const r = alignMessages(stored(first.messages), first.messages)
    expect(r.insert).toEqual([])
    expect(r.reuse).toHaveLength(first.messages.length)
    expect(r.newSeqRanges).toEqual([])
  })

  it('importing the older export after the newer one prepends without renumbering', async () => {
    const first = await load('聊天记录_20260405_223012.zip')
    const second = await load('聊天记录_20260914_211545.zip')
    const { r, rows } = merged(stored(second.messages), first.messages)
    expect(r.reuse).toHaveLength(32)
    expect(r.insert).toHaveLength(first.messages.length - 32)
    // 175 inserts fit into the (0, 1024) gap before the first stored seq
    expect(r.resequence).toEqual([])
    expect(r.insert.every((x) => x.seq > 0 && x.seq < SEQ_STEP)).toBe(true)
    expect(rows.map((x) => x.fp)).toEqual([...first.messages, ...second.messages.slice(32)].map((m) => m.fingerprint))
  })

  it('keeps two identical "嗯" sent in the same minute (never dedups by fingerprint alone)', () => {
    const a = msg(0, '甲', '2026-09-01 10:00', '在吗')
    const u1 = msg(1, '乙', '2026-09-01 10:01', '嗯')
    const u2 = msg(2, '乙', '2026-09-01 10:01', '嗯')
    const b = msg(3, '甲', '2026-09-01 10:02', '好')
    expect(u1.fingerprint).toBe(u2.fingerprint)

    // first import: both 嗯 are stored
    const empty = alignMessages([], [a, u1, u2, b])
    expect(empty.insert).toHaveLength(4)

    // second export has the same two plus a third 嗯 and one more message
    const u3 = msg(3, '乙', '2026-09-01 10:01', '嗯')
    const c = msg(5, '甲', '2026-09-01 10:05', '走了')
    const existing = stored([a, u1, u2, b])
    const { r, rows } = merged(existing, [a, u1, u2, u3, { ...b, idx: 4 }, c])
    expect(r.reuse.map((x) => x.messageId)).toEqual([1, 2, 3, 4])
    expect(r.insert.map((x) => x.incomingIdx)).toEqual([3, 5])
    expect(rows.map((x) => x.fp)).toEqual([a, u1, u2, u3, b, c].map((m) => m.fingerprint))
    expect(r.newSeqRanges).toHaveLength(2)
  })

  it('same-minute duplicates from parsed text survive a re-import with an overlap', () => {
    const text = (lines: [string, string, string][]) =>
      lines.map(([s, t, body]) => `·${s}\n${t}\n${body}\n`).join('\n')
    const t1 = parseExportText(text([['甲', '2026年09月01日 10:00', '嗯'], ['甲', '2026年09月01日 10:00', '嗯'], ['乙', '2026年09月01日 10:01', '好']]))
    const t2 = parseExportText(text([['甲', '2026年09月01日 10:00', '嗯'], ['乙', '2026年09月01日 10:01', '好'], ['乙', '2026年09月01日 10:03', '嗯']]))
    const { r, rows } = merged(stored(t1.messages), t2.messages)
    expect(r.reuse).toHaveLength(2)
    expect(r.insert).toHaveLength(1)
    expect(rows).toHaveLength(4)
  })

  it('rescales existing seqs when a gap is too small', () => {
    const base = [msg(0, '甲', '2026-09-01 10:00', 'a'), msg(1, '甲', '2026-09-01 10:10', 'z')]
    const existing = [
      { id: 10, seq: 1, fingerprint: base[0].fingerprint },
      { id: 11, seq: 3, fingerprint: base[1].fingerprint },
    ]
    const middle = Array.from({ length: 5 }, (_, i) => msg(i + 1, '乙', '2026-09-01 10:05', `m${i}`))
    const { r, rows } = merged(existing, [base[0], ...middle, { ...base[1], idx: 6 }])
    // renumbered to rank × unit; unit = smallest power of two ≥ (5 + 1) × SEQ_STEP
    expect(r.resequence).toEqual([
      { messageId: 10, seq: 8192 },
      { messageId: 11, seq: 16384 },
    ])
    expect(rows.map((x) => x.fp)).toEqual([base[0], ...middle, base[1]].map((m) => m.fingerprint))
    expect(new Set(rows.map((x) => x.seq)).size).toBe(rows.length)
  })

  it('repeated large prepends renumber instead of multiplying: seqs stay unique, time-ordered and ≤ 2^52', () => {
    let chat: { id: number; seq: number; fingerprint: string; sentAt: string }[] = []
    let nextId = 1
    const maxSeqs: number[] = []
    for (let round = 0; round < 10; round++) {
      // each export is older than everything stored and has 1,200 messages (more than one 1024 gap can hold)
      const day = String(28 - round).padStart(2, '0')
      const incoming = Array.from({ length: 1200 }, (_, k) =>
        msg(k, k % 2 ? '甲' : '乙', `2026-01-${day} ${String(Math.floor(k / 60)).padStart(2, '0')}:${String(k % 60).padStart(2, '0')}`, `r${round}-${k}`),
      )
      const r = alignMessages(chat, incoming)
      const reseq = new Map(r.resequence.map((x) => [x.messageId, x.seq]))
      chat = chat.map((e) => ({ ...e, seq: reseq.get(e.id) ?? e.seq }))
      for (const x of r.insert) chat.push({ id: nextId++, seq: x.seq, fingerprint: incoming[x.incomingIdx].fingerprint, sentAt: incoming[x.incomingIdx].sentAt })
      const sorted = [...chat].sort((a, b) => a.seq - b.seq)
      expect(new Set(chat.map((e) => e.seq)).size).toBe(chat.length)
      expect(sorted.every((e, i) => i === 0 || sorted[i - 1].sentAt <= e.sentAt)).toBe(true)
      expect(chat.every((e) => Number.isSafeInteger(e.seq) && e.seq > 0 && e.seq <= 2 ** 52)).toBe(true)
      maxSeqs.push(sorted.at(-1)!.seq)
    }
    expect(chat).toHaveLength(12_000)
    // bounded by stored count × unit, not by 1024^rounds
    expect(Math.max(...maxSeqs)).toBeLessThan(12_000 * 2 ** 21)
  })

  it('legacy seqs above 2^44 are renumbered on the next import even when the gaps have room', () => {
    const a = msg(0, '甲', '2026-09-01 10:00', 'a')
    const b = msg(1, '甲', '2026-09-01 11:00', 'b')
    const existing = [
      { id: 1, seq: 2 ** 45, fingerprint: a.fingerprint, sentAt: a.sentAt },
      { id: 2, seq: 2 ** 46, fingerprint: b.fingerprint, sentAt: b.sentAt },
    ]
    const r = alignMessages(existing, [a, b, msg(2, '甲', '2026-09-01 12:00', 'c')])
    expect(r.resequence).toEqual([
      { messageId: 1, seq: SEQ_STEP },
      { messageId: 2, seq: 2 * SEQ_STEP },
    ])
    expect(r.insert).toEqual([{ incomingIdx: 2, seq: 3 * SEQ_STEP }])
  })

  it('disjoint later export appends after existing messages', () => {
    const existing = stored([msg(0, '甲', '2026-01-01 10:00', 'x')])
    const r = alignMessages(existing, [msg(0, '乙', '2026-02-01 10:00', 'y'), msg(1, '乙', '2026-02-01 10:01', 'z')])
    expect(r.insert.map((x) => x.seq)).toEqual([2048, 3072])
    expect(r.newSeqRanges).toEqual([[2048, 3072]])
  })

  it('disjoint earlier export goes before existing messages (placed by time, no match anchor)', () => {
    const existing = stored([msg(0, '甲', '2026-03-01 10:00', 'x'), msg(1, '甲', '2026-03-02 10:00', 'y')])
    const earlier = [msg(0, '乙', '2026-01-01 10:00', 'a'), msg(1, '乙', '2026-01-02 10:00', 'b')]
    const { r, rows } = merged(existing, earlier)
    expect(r.resequence).toEqual([])
    expect(rows.map((x) => x.fp)).toEqual([earlier[0].fingerprint, earlier[1].fingerprint, existing[0].fingerprint, existing[1].fingerprint])
    expect(r.newSeqRanges).toHaveLength(1)
  })

  it('unmatched messages between anchors interleave with existing ones by time', () => {
    const e = [
      msg(0, '甲', '2026-01-01 10:00', 'anchor1'),
      msg(1, '甲', '2026-01-01 11:00', 'e-11'),
      msg(2, '甲', '2026-01-01 13:00', 'e-13'),
      msg(3, '甲', '2026-01-01 15:00', 'anchor2'),
    ]
    const inc = [e[0], msg(1, '乙', '2026-01-01 12:00', 'i-12'), msg(2, '乙', '2026-01-01 14:00', 'i-14'), { ...e[3], idx: 3 }]
    const { r, rows } = merged(stored(e), inc)
    expect(r.reuse).toHaveLength(2)
    expect(rows.map((x) => x.fp)).toEqual([e[0], e[1], inc[1], e[2], inc[2], e[3]].map((m) => m.fingerprint))
    expect(r.newSeqRanges).toHaveLength(2)
  })
})

describe('lcsPairs', () => {
  const brute = (a: string[], b: string[]) => {
    const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    return dp[0][0]
  }

  it('finds an optimal common subsequence on random inputs', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: Math.floor(rand() * 30) }, () => 'abcde'[Math.floor(rand() * 5)])
      const b = Array.from({ length: Math.floor(rand() * 30) }, () => 'abcde'[Math.floor(rand() * 5)])
      const pairs = lcsPairs(a, b)
      expect(pairs.length).toBe(brute(a, b))
      for (let k = 0; k < pairs.length; k++) {
        expect(a[pairs[k][0]]).toBe(b[pairs[k][1]])
        if (k) expect(pairs[k][0] > pairs[k - 1][0] && pairs[k][1] > pairs[k - 1][1]).toBe(true)
      }
    }
  })

  it('stays fast on a 50k disjoint import', () => {
    const a = Array.from({ length: 50_000 }, (_, i) => `a${i}`)
    const b = Array.from({ length: 50_000 }, (_, i) => `b${i}`)
    const t0 = performance.now()
    expect(lcsPairs(a, b)).toEqual([])
    expect(performance.now() - t0).toBeLessThan(1000)
  })
})
