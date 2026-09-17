// Interaction-call validation (SPEC §8.8; ARCHITECTURE §6 `validateInteraction`). These are the rules that used to
// sit behind `validateOutput`'s `opts.interaction`; they moved here with the call (DECISIONS ## extract X40).
import { describe, expect, it } from 'vitest'
import type { WindowInput } from './types'
import { validateInteraction } from './validate-interaction'

// Invented names only.
const base = (): WindowInput => ({
  chat: { title: '柜子', kind: 'private' },
  selfPersonId: 1,
  known: [
    { personId: 1, label: '我', handles: [{ kind: 'display_private', value: '山野' }], claims: [] },
    { personId: 2, label: '周明', handles: [{ kind: 'display_private', value: '阿明' }], claims: [{ id: 50, statement: '住在成都', category: 'location' }] },
  ],
  messages: [
    { localSeq: 1, sentAt: '2026-05-01 09:00', senderName: '山野', senderPersonId: 1, kind: 'text', body: '柜子报价出来了吗' },
    { localSeq: 2, sentAt: '2026-05-01 09:02', senderName: '阿明', senderPersonId: 2, kind: 'text', body: '还在算，周五前发给你' },
    { localSeq: 3, sentAt: '2026-05-01 10:00', senderName: '阿明', senderPersonId: 2, kind: 'text', body: '报价发你了' },
    { localSeq: 4, sentAt: '2026-05-01 10:01', senderName: '山野', senderPersonId: 1, kind: 'text', body: '收到' },
  ],
})
const chat = (over: Partial<WindowInput> = {}): WindowInput => ({ ...base(), ...over })
type Shown = { id: number; kind: 'promise' | 'question' | 'plan' | 'request'; direction: 'mine' | 'theirs' | 'mutual'; text: string; openedAt: string }
const withLoops = (openLoops: Shown[], over: Partial<WindowInput> = {}) =>
  chat({ known: base().known.map((p) => (p.personId === 2 ? { ...p, openLoops } : p)), ...over })
const segment = (over: Record<string, unknown> = {}) => ({ summary: '对了柜子报价的进度', topics: ['柜子', '报价'], speakers: [{ personId: 1 }, { personId: 2 }], evidence: [1, 2], ...over })
const loop = (over: Record<string, unknown> = {}) => ({ person: { personId: 2 }, direction: 'theirs', kind: 'promise', text: '周五前把报价发过来', evidence: [2], ...over })
const ok = (r: ReturnType<typeof validateInteraction>) => {
  if ('error' in r) throw new Error(`validation_failed: ${r.issues.join('; ')}`)
  return r
}

describe('validateInteraction: top level', () => {
  it('rejects non-objects, unknown keys and non-array values as validation_failed', () => {
    expect(validateInteraction('nope', chat())).toMatchObject({ error: 'validation_failed' })
    expect(validateInteraction([], chat())).toMatchObject({ error: 'validation_failed' })
    expect(validateInteraction({ loops: [], claims: [] }, chat())).toMatchObject({ error: 'validation_failed' })
    expect(validateInteraction({ loops: {} }, chat())).toMatchObject({ error: 'validation_failed' })
  })

  it('accepts missing keys as empty', () => {
    const r = ok(validateInteraction({}, chat()))
    expect(r.output).toEqual({ segment: null, loops: [], closes: [] })
    expect(r.rawItemCount).toBe(0)
    expect(r.dropped).toEqual([])
  })

  it('accepts an all-empty answer ("nothing happened here") without a drop', () => {
    const r = ok(validateInteraction({ segment: null, loops: [], closes: [] }, chat()))
    expect(r.output.segment).toBeNull()
    expect(r.dropped).toEqual([])
  })
})

describe('validateInteraction: segment', () => {
  it('keeps a segment and a loop, resolves speakers, and counts them as raw items', () => {
    const r = ok(validateInteraction({ segment: segment({ speakers: [2, 1, 42] }), loops: [loop()] }, chat()))
    expect(r.output.segment).toEqual({ summary: '对了柜子报价的进度', topics: ['柜子', '报价'], speakers: [{ personId: 2 }, { personId: 1 }], evidence: [1, 2] })
    expect(r.output.loops).toEqual([{ person: { personId: 2 }, direction: 'theirs', kind: 'promise', text: '周五前把报价发过来', evidence: [2] }])
    expect(r.rawItemCount).toBe(2)
  })

  it('drops a segment whose summary says nothing, and every segment after the first', () => {
    const short = ok(validateInteraction({ segment: segment({ summary: '嗯 嗯 呐' }) }, chat()))
    expect(short.dropped).toEqual([{ path: 'segment', reason: 'invalid_item' }])
    expect(short.output.segment).toBeNull()

    const schema = ok(validateInteraction({ segment: segment({ summary: '嗯嗯' }) }, chat()))
    expect(schema.dropped[0]).toMatchObject({ path: 'segment', reason: 'invalid_item' })
    expect(schema.dropped[0].fields).toEqual(['summary:too_small'])

    const many = ok(validateInteraction({ segment: [segment(), segment({ summary: '还聊了别的事情' })] }, chat()))
    expect(many.output.segment?.summary).toBe('对了柜子报价的进度')
    expect(many.dropped).toEqual([{ path: 'segment[1]', reason: 'invalid_item' }])
  })

  it('an unresolvable speaker is dropped from the list, not the segment', () => {
    const r = ok(validateInteraction({ segment: segment({ speakers: [{ tempId: 't1' }, { personId: 2 }] }) }, chat()))
    expect(r.output.segment?.speakers).toEqual([{ personId: 2 }])
    expect(r.dropped).toEqual([])
  })
})

describe('validateInteraction: loops', () => {
  it('keeps a dated request without treating the acknowledgement as completion', () => {
    const input = base()
    input.chat = { title: '一年级家长群', kind: 'group' }
    input.messages[1].body = '请各位家长明天交孩子的观察报告'
    const request = loop({ kind: 'request', direction: 'mine', text: '提交孩子的观察报告', dueAt: '2026-05-02' })
    const result = ok(validateInteraction({ loops: [request] }, input))
    expect(result.output.loops).toEqual([request])
    input.known[1].openLoops = [{ id: 90, kind: 'request', direction: 'mine', text: '提交孩子的观察报告', openedAt: '2026-05-01 09:02' }]
    expect(ok(validateInteraction({ closes: [{ loopId: 90, reason: 'done', evidence: [4] }] }, input)).output.closes).toEqual([])
    input.messages[3].body = '孩子的观察报告已经交了'
    expect(ok(validateInteraction({ closes: [{ loopId: 90, reason: 'done', evidence: [4] }] }, input)).output.closes).toHaveLength(1)
  })

  it('drops loops on an unknown person or on self, merges repeats, and removes a malformed dueAt', () => {
    const r = ok(
      validateInteraction(
        {
          loops: [
            loop({ person: { personId: 99 } }),
            loop({ person: { personId: 1 }, direction: 'mine' }),
            loop({ kind: 'plan', direction: 'mutual', text: '约了周六看房', dueAt: '下周六' }),
            loop({ evidence: [1, 2] }),
          ],
        },
        chat(),
      ),
    )
    expect(r.dropped).toEqual([
      { path: 'loops[0]', reason: 'unknown_person' },
      { path: 'loops[1]', reason: 'self_loop' },
    ])
    expect(r.output.loops.map((l) => [l.text, l.dueAt, l.evidence])).toEqual([
      ['约了周六看房', undefined, [2]],
      ['周五前把报价发过来', undefined, [1, 2]],
    ])
  })

  it('a well-formed dueAt survives', () => {
    const r = ok(validateInteraction({ loops: [loop({ kind: 'plan', direction: 'mutual', text: '约了周六看房', dueAt: '2026-05-09' })] }, chat()))
    expect(r.output.loops[0].dueAt).toBe('2026-05-09')
  })

  it('a tempId person is `unknown_person`: the interaction call never sees the extraction call`s new persons', () => {
    const r = ok(validateInteraction({ loops: [loop({ person: { tempId: 't1' } })] }, chat()))
    expect(r.dropped).toEqual([{ path: 'loops[0]', reason: 'unknown_person' }])
    expect(r.output.loops).toEqual([])
  })

  it('an item resting only on invisible messages (voice, image, transfer) is dropped', () => {
    const voice = chat({ messages: base().messages.map((m) => (m.localSeq === 2 ? { ...m, kind: 'voice' as const } : m)) })
    const r = ok(validateInteraction({ loops: [loop()] }, voice))
    expect(r.dropped).toEqual([{ path: 'loops[0]', reason: 'invalid_item' }])
  })

  it('a schema-invalid loop is dropped alone, with field names but no values', () => {
    const r = ok(validateInteraction({ loops: [loop({ kind: 'reminder' }), loop()] }, chat()))
    expect(r.dropped[0]).toMatchObject({ path: 'loops[0]', reason: 'invalid_item' })
    expect(r.dropped[0].fields).toEqual(['kind:invalid_value'])
    expect(r.output.loops).toHaveLength(1)
  })
})

/**
 * Third threshold (SPEC §8.8, DECISIONS ## extract X41). These 16 strings are the interaction call's measured loop
 * false positives on the synthetic eval (eval/reports/synthetic/20260916-074900.json), every one of them annotated
 * `should_ignore`; together they are what took loop precision to 0.556 against a 0.80 gate. Each is listed with the
 * layer that has to stop it: `validator` = a same-day / immediate time marker and no `dueAt`, which is mechanical and
 * therefore must not be left to the prompt; `prompt` = only the worth-remembering judgement can reject it, and
 * `prompts.test.ts` pins the contrast list that teaches it.
 */
const FALSE_POSITIVES: [text: string, by: 'validator' | 'prompt'][] = [
  ['给留半个西瓜', 'prompt'],
  ['给静静留几个桃子', 'prompt'],
  ['晚上过去拿西瓜', 'validator'],
  ['把那个表情包发过去', 'prompt'],
  ['找找暑假阅读打卡的本子', 'prompt'],
  ['帮忙问问孩子有没有看到那个蓝色水杯', 'prompt'],
  ['明天放学在东门顺路接果果', 'validator'],
  ['周末回去帮忙清理手机内存', 'prompt'],
  ['回头细说面试安排的事', 'validator'],
  ['回头带去看苏苏工作室的门头', 'validator'],
  ['问订包厢还是去老地方，还没定', 'prompt'],
  ['国庆回九江办婚礼时发请帖', 'prompt'],
  ['把身份证号发给静静买国庆高铁票', 'prompt'],
  ['运动会家长志愿者报名找周明杰', 'prompt'],
  ['问了什么时候搬去深圳还没定', 'prompt'],
  ['私下问问老师换座位的事', 'prompt'],
]

describe('validateInteraction: the third threshold (worth remembering next time)', () => {
  const dropOf = (text: string, over: Record<string, unknown> = {}) => ok(validateInteraction({ loops: [loop({ text, ...over })] }, chat()))

  it.each(FALSE_POSITIVES.filter(([, by]) => by === 'validator').map(([t]) => t))('drops the same-day loop %s as `momentary`', (text) => {
    const r = dropOf(text)
    expect(r.dropped).toEqual([{ path: 'loops[0]', reason: 'momentary' }])
    expect(r.output.loops).toEqual([])
  })

  it('leaves the judgement-only false positives to the prompt, and says so by name', () => {
    // Not a gap being papered over: a word list cannot tell "给留半个西瓜" from "把那本书寄给她". Asserting it here
    // keeps the split honest — if a later validator rule starts catching one of these, this test says which.
    for (const [text, by] of FALSE_POSITIVES) {
      const r = dropOf(text)
      expect(r.dropped.length === 1 ? 'validator' : 'prompt', text).toBe(by)
    }
  })

  it('keeps the loops that are worth remembering a month later, including a dated plan', () => {
    for (const text of ['帮表妹看简历', '下个月一起去看动画展', '帮忙打听杭州的幼儿园', '把那本书寄给她']) {
      const r = dropOf(text)
      expect(r.dropped, text).toEqual([])
      expect(r.output.loops.map((l) => l.text), text).toEqual([text])
    }
  })

  it('the collateral this rule is measured to cost: two loops the frozen gold required (X49)', () => {
    // Honest record, not an aspiration. On the same report, the rule also removes two loops the blind gold asks for:
    // gold k6 is phrased "晚上看转过来的租房文章" — the GOLD's own words carry 晚上 — and gold k7 "把最近在追的剧名发过去"
    // was emitted as "回头把在追的剧名发过去". No word list separates those from "晚上过去拿西瓜" and "回头细说面试安排
    // 的事", so this is the price of the mechanical half, and it is pinned here so nobody rediscovers it in a report.
    for (const text of ['晚上看一舟转来的深圳租房避坑指南', '回头把在追的剧名发过去']) {
      expect(dropOf(text).dropped, text).toEqual([{ path: 'loops[0]', reason: 'momentary' }])
    }
    // The escape hatch is real and the model does use it: this one was emitted with dueAt "2025-12-14" and is kept.
    expect(dropOf('这周把龙井寄过来', { dueAt: '2025-12-14' }).output.loops.map((l) => l.text)).toEqual(['这周把龙井寄过来'])
  })

  it('a same-day marker with a real dueAt is a dated occasion and survives', () => {
    // "下周四晚上一起吃饭" carries 晚上 but is an occasion you would put on a calendar; the date proves it.
    const r = dropOf('约了晚上一起吃饭', { kind: 'plan', direction: 'mutual', dueAt: '2026-05-07' })
    expect(r.dropped).toEqual([])
    expect(r.output.loops[0]).toMatchObject({ text: '约了晚上一起吃饭', dueAt: '2026-05-07' })
    // …but a dueAt the model could not put a date on does not buy the same pass
    expect(dropOf('约了晚上一起吃饭', { kind: 'plan', direction: 'mutual', dueAt: '下周四' }).dropped).toEqual([{ path: 'loops[0]', reason: 'momentary' }])
  })
})

describe('validateInteraction: closes', () => {
  const shown: Shown[] = [{ id: 7, kind: 'promise', direction: 'theirs', text: '周五前把报价发过来', openedAt: '2026-05-01 09:02' }]

  it('unknown_close: a loop id this window was never shown, or one opened after the closing message', () => {
    const never = ok(validateInteraction({ closes: [{ loopId: 8, reason: 'done', evidence: [3] }] }, withLoops(shown)))
    expect(never.dropped).toEqual([{ path: 'closes[0]', reason: 'unknown_close' }])

    const later = ok(validateInteraction({ closes: [{ loopId: 7, reason: 'done', evidence: [1] }] }, withLoops(shown)))
    expect(later.dropped).toEqual([{ path: 'closes[0]', reason: 'unknown_close' }])

    const good = ok(validateInteraction({ closes: [{ loopId: 7, reason: 'done', evidence: [3] }, { loopId: 7, reason: 'dropped', evidence: [4] }] }, withLoops(shown)))
    expect(good.output.closes).toEqual([{ loopId: 7, reason: 'done', evidence: [3] }])
    expect(good.dropped).toEqual([{ path: 'closes[1]', reason: 'invalid_item' }])
  })

  it('a close landing exactly on the opening message is kept (openedAt <= sentAt)', () => {
    const same: Shown[] = [{ id: 7, kind: 'question', direction: 'theirs', text: '问了报价', openedAt: '2026-05-01 09:02' }]
    const r = ok(validateInteraction({ closes: [{ loopId: 7, reason: 'done', evidence: [2] }] }, withLoops(same)))
    expect(r.output.closes).toEqual([{ loopId: 7, reason: 'done', evidence: [2] }])
  })

  it('a string loopId is normalised before the strict parse', () => {
    const r = ok(validateInteraction({ closes: [{ loopId: '7', reason: 'done', evidence: [3] }] }, withLoops(shown)))
    expect(r.output.closes).toEqual([{ loopId: 7, reason: 'done', evidence: [3] }])
  })
})

describe('validateInteraction: evidence', () => {
  it('drops out-of-window, empty and context-only evidence on segment, loops and closes', () => {
    const out = (seg: unknown, ev: number[]) => ({ segment: seg, loops: [loop({ evidence: ev })], closes: [{ loopId: 7, reason: 'done', evidence: ev }] })
    const shown: Shown[] = [{ id: 7, kind: 'promise', direction: 'theirs', text: 'x', openedAt: '2026-05-01 08:00' }]

    const far = ok(validateInteraction(out(segment({ evidence: [9] }), [9]), withLoops(shown)))
    expect(far.dropped.map((d) => d.reason)).toEqual(['evidence_out_of_window', 'evidence_out_of_window', 'evidence_out_of_window'])
    expect(far.output).toEqual({ segment: null, loops: [], closes: [] })

    const ctx = withLoops(shown)
    ctx.messages = ctx.messages.map((m) => (m.localSeq === 2 ? { ...m, context: true } : m))
    const onlyContext = ok(validateInteraction(out(segment({ evidence: [2] }), [2]), ctx))
    expect(onlyContext.dropped.map((d) => d.reason)).toEqual(['context_only', 'context_only', 'context_only'])
    expect(onlyContext.output.segment).toBeNull()

    const empty = ok(validateInteraction({ closes: [{ loopId: 7, reason: 'done', evidence: [] }] }, withLoops(shown)))
    expect(empty.dropped[0]).toMatchObject({ path: 'closes[0]' })
  })

  it('context evidence next to a new message is kept', () => {
    const ctx = chat({ messages: base().messages.map((m) => (m.localSeq === 1 ? { ...m, context: true } : m)) })
    const r = ok(validateInteraction({ segment: segment({ evidence: [1, 2] }) }, ctx))
    expect(r.output.segment?.evidence).toEqual([1, 2])
  })
})
