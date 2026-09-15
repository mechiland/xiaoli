import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LlmError, LlmJsonRequest, LlmJsonResult } from '@/server/llm'
import { fakeLlm } from '@/tests/helpers/test-db'
import { CEREMONY, CEREMONY_MAPPING, parsedChat, SHIPPING_BLOCK, SHIPPING_BLOCK_MAPPING, TWO_SESSIONS, TWO_SESSIONS_MAPPING } from './__fixtures__/chats'
import { extractOffline } from './offline'
import { PROMPT_VERSION } from './prompt-version'

// Window packing (extract.v4+, DECISIONS ## extract X20) is switched off here so two short sessions stay two windows
// and retry/failure isolation between windows stays testable; `feats.pack` turns it on for the packing cases.
const feats = vi.hoisted(() => ({ pack: null as number | null }))
vi.mock('./prompt-version', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./prompt-version')>()
  return { ...mod, promptFeatures: (v: string) => ({ ...mod.promptFeatures(v), packMaxMessages: feats.pack }) }
})
afterEach(() => {
  feats.pack = null
})

const ok = (json: unknown, latencyMs = 1_000): LlmJsonResult => ({ ok: true, json, raw: JSON.stringify(json), usage: { inputTokens: 1_000, outputTokens: 100, cacheHitTokens: 0 }, latencyMs, model: 'deepseek-flash', finishReason: 'stop', fromCassette: false })
const err = (code: LlmError['code'], latencyMs = 500): LlmError => ({ ok: false, code, message: code, raw: code === 'invalid_json' ? '{bad' : null, retryable: code !== 'budget_exceeded', latencyMs })
const empty = { newPersons: [], handles: [], relations: [], claims: [], events: [], dates: [] }
const isWindow = (req: LlmJsonRequest, marker: string) => req.messages[1].content.includes(marker)

// Person ids inside the memory store: me = 1, ming = 2 (mapping order).
const window0 = {
  ...empty,
  newPersons: [{ tempId: 't1', label: '小林', evidence: [2] }],
  relations: [{ from: { tempId: 't1' }, to: { personId: 2 }, type: 'colleague', evidence: [2] }],
  claims: [{ person: { tempId: 't1' }, statement: '在读研究生', category: 'education', confidence: 0.9, sensitive: false, evidence: [3] }],
}
const window1 = {
  ...empty,
  newPersons: [{ tempId: 't1', label: '小林', evidence: [1] }],
  handles: [{ person: { personId: 2 }, kind: 'address_term', value: '周老师', evidence: [2] }],
  claims: [
    { person: { tempId: 't1' }, statement: '在读研二', category: 'education', confidence: 0.9, sensitive: false, evidence: [1] },
    { person: { personId: 2 }, statement: '手机号13800001111', category: 'other', confidence: 0.9, sensitive: false, evidence: [3] },
    { person: { personId: 2 }, statement: '喜欢爬山', category: 'preference', confidence: 0.8, sensitive: false, evidence: [9] },
  ],
}

describe('extractOffline', () => {
  it('shipping block in a private chat: the real name goes to the sender, no new person (overall critic r1 #1)', async () => {
    // The model output the critic observed, on invented data: a new person labelled with the recipient name whose only
    // item is that name as real_name, next to the sender's generic "提供过…" claims.
    const llm = fakeLlm([
      () =>
        ok({
          ...empty,
          newPersons: [{ tempId: 't1', label: '王小明', evidence: [2] }],
          handles: [{ person: { tempId: 't1' }, kind: 'real_name', value: '王小明', evidence: [2] }],
          claims: [
            { person: { personId: 2 }, statement: '提供过收货地址', category: 'other', confidence: 0.9, sensitive: true, evidence: [2] },
            { person: { personId: 2 }, statement: '提供过手机号', category: 'other', confidence: 0.9, sensitive: true, evidence: [2] },
          ],
        }),
    ])
    const r = await extractOffline({ parsed: parsedChat(SHIPPING_BLOCK), mapping: SHIPPING_BLOCK_MAPPING, llm, model: 'deepseek-flash', deadlinePolicy: 'app' })
    expect(r.windows.map((w) => w.outcome)).toEqual(['done'])
    expect(r.persons.filter((p) => p.key.startsWith('new:'))).toEqual([])
    expect(r.handles).toEqual([{ person: 'xiaoming', kind: 'real_name', value: '王小明', evidence: [1], windowIndex: 0 }])
    expect(r.claims.map((c) => [c.person, c.statement])).toEqual([
      ['xiaoming', '提供过收货地址'],
      ['xiaoming', '提供过手机号'],
    ])
  })

  it('ceremony post + "返校": one education claim, not the generic status next to a school read off the post (overall critic r1 #3)', async () => {
    feats.pack = 40 // as in-app with extract.v4+: the two sessions share one window
    const llm = fakeLlm([
      () =>
        ok({
          ...empty,
          claims: [
            { person: { personId: 2 }, statement: '在上学，是学生', category: 'education', confidence: 0.9, sensitive: false, evidence: [1, 3] },
            { person: { personId: 2 }, statement: '在云杉市第一中学读书', category: 'education', confidence: 0.9, sensitive: false, evidence: [1] },
          ],
        }),
    ])
    const r = await extractOffline({ parsed: parsedChat(CEREMONY), mapping: CEREMONY_MAPPING, llm, model: 'deepseek-flash', deadlinePolicy: 'app' })
    // the school is only in the shared post's title; the chat text ("返校") supports the status
    expect(r.claims.map((c) => [c.person, c.statement])).toEqual([['son', '在上学，是学生']])
  })

  it('drops the generic student status when an earlier window of the import already proposed a grade', async () => {
    const llm = fakeLlm([
      (req) => {
        if (req.purpose === 'dedup') return ok({ duplicates: [] })
        return ok(
          isWindow(req, '周末去爬山吗')
            ? { ...empty, newPersons: [{ tempId: 't1', label: '小林', evidence: [2] }], claims: [{ person: { tempId: 't1' }, statement: '读研二', category: 'education', confidence: 0.9, sensitive: false, evidence: [3] }] }
            : {
                ...empty,
                newPersons: [{ tempId: 't1', label: '小林', evidence: [1] }],
                // evidence #2 mentions "老师", so the in-window check keeps it; the earlier grade makes it redundant
                claims: [
                  { person: { tempId: 't1' }, statement: '在上学，是学生', category: 'education', confidence: 0.9, sensitive: false, evidence: [2] },
                  { person: { tempId: 't1' }, statement: '研究方向是高分子材料', category: 'education', confidence: 0.9, sensitive: false, evidence: [1] },
                ],
              },
        )
      },
    ])
    const r = await extractOffline({ parsed: parsedChat(TWO_SESSIONS), mapping: TWO_SESSIONS_MAPPING, llm, model: 'deepseek-flash', deadlinePolicy: 'app' })
    expect(r.windows.map((w) => w.outcome)).toEqual(['done', 'done'])
    expect(r.claims.map((c) => c.statement)).toEqual(['读研二', '研究方向是高分子材料'])
  })

  it('plans windows, resolves tempIds across windows, dedups, guards sensitive text and maps evidence to idx', async () => {
    const llm = fakeLlm([
      (req) => {
        if (req.purpose === 'dedup') {
          const input = JSON.parse(req.messages[1].content.split('\n')[0]) as { persons: { candidates: { id: number; statement: string }[]; new: { index: number; statement: string }[] }[] }
          const g = input.persons[0]
          return ok({ duplicates: [{ newIndex: g.new.find((n) => n.statement === '在读研二')!.index, existingClaimId: g.candidates[0].id }] })
        }
        return ok(isWindow(req, '周末去爬山吗') ? window0 : window1)
      },
    ])
    const r = await extractOffline({ parsed: parsedChat(TWO_SESSIONS), mapping: TWO_SESSIONS_MAPPING, llm, model: 'deepseek-flash', deadlinePolicy: 'app' })

    expect(r.windows.map((w) => [w.startIdx, w.endIdx, w.outcome, w.attempts])).toEqual([
      [0, 3, 'done', 1],
      [4, 7, 'done', 1],
    ])
    expect(r.persons).toEqual([
      { key: 'me', label: '山野', isSelf: true },
      { key: 'ming', label: '阿明', isSelf: false },
      { key: 'new:小林', label: '小林', isSelf: false },
    ])
    // dedup merged window 1's claim into window 0's; evidence outside window 0 is not attached (harness checks windowIndex)
    const lin = r.claims.filter((c) => c.person === 'new:小林')
    expect(lin).toEqual([{ person: 'new:小林', statement: '在读研究生', category: 'education', confidence: 0.9, sensitive: false, evidence: [2], windowIndex: 0 }])
    expect(r.windows[1].dedup).toBe('ran')
    // sensitive statement rewritten
    expect(r.claims.find((c) => c.person === 'ming')).toMatchObject({ statement: '提供过手机号', sensitive: true, evidence: [6] })
    // evidence outside the window dropped and counted
    expect(r.claims.some((c) => c.statement === '喜欢爬山')).toBe(false)
    expect(r.windows[1].droppedInvalidEvidence).toBe(1)
    expect(r.windows[1].rawItemCount).toBe(5)
    expect(r.relations).toEqual([{ from: 'new:小林', to: 'ming', type: 'colleague', evidence: [1], windowIndex: 0 }])
    expect(r.handles).toEqual([{ person: 'ming', kind: 'address_term', value: '周老师', evidence: [5], windowIndex: 1 }])
    for (const item of [...r.claims, ...r.handles, ...r.relations]) {
      const w = r.windows[item.windowIndex]
      for (const idx of item.evidence) expect(idx >= w.startIdx && idx <= w.endIdx).toBe(true)
    }
    expect(r.usage).toEqual({ inputTokens: 3_000, outputTokens: 300, calls: 3 })
    expect(r.promptVersion).toBe(PROMPT_VERSION)
    expect(llm.calls.filter((c) => c.purpose === 'extract').every((c) => c.maxTransportRetries === 0 && (c.timeoutMs ?? 0) <= 20_000)).toBe(true)
  })

  it('retries a failing window up to 3 attempts, then fails it while other windows continue', async () => {
    const llm = fakeLlm([(req) => (isWindow(req, '周末去爬山吗') ? err('invalid_json') : ok(empty))])
    const r = await extractOffline({ parsed: parsedChat(TWO_SESSIONS), mapping: TWO_SESSIONS_MAPPING, llm })
    expect(r.windows.map((w) => [w.outcome, w.code, w.attempts])).toEqual([
      ['retryable_error', 'invalid_json', 3],
      ['done', undefined, 1],
    ])
    expect(r.windows[0].attemptMs).toHaveLength(3)
    expect(r.windows[0].rawOutputs).toEqual(['{bad', '{bad', '{bad'])
  })

  it('counts schema-invalid output as validation_failed and retries it', async () => {
    const llm = fakeLlm([(req) => (isWindow(req, '周末去爬山吗') ? ok({ people: [] }) : ok(empty))])
    const r = await extractOffline({ parsed: parsedChat(TWO_SESSIONS), mapping: TWO_SESSIONS_MAPPING, llm })
    expect(r.windows[0]).toMatchObject({ outcome: 'retryable_error', code: 'validation_failed', attempts: 3 })
    expect(r.windows[1].outcome).toBe('done')
  })

  it('stops after budget_exceeded without retrying or calling for later windows', async () => {
    const llm = fakeLlm([err('budget_exceeded')])
    const r = await extractOffline({ parsed: parsedChat(TWO_SESSIONS), mapping: TWO_SESSIONS_MAPPING, llm })
    expect(llm.calls).toHaveLength(1)
    expect(r.windows.map((w) => [w.outcome, w.code, w.attempts])).toEqual([
      ['fatal_error', 'budget_exceeded', 1],
      ['fatal_error', 'budget_exceeded', 0],
    ])
  })

  it('app deadline: recorded latency counts against the 28 s budget and skips dedup when < 4 s remain', async () => {
    const llm = fakeLlm([
      (req) => {
        if (req.purpose === 'dedup') return ok({ duplicates: [] })
        return isWindow(req, '周末去爬山吗') ? ok(window0) : ok(window1, 24_500)
      },
    ])
    const r = await extractOffline({ parsed: parsedChat(TWO_SESSIONS), mapping: TWO_SESSIONS_MAPPING, llm, deadlinePolicy: 'app' })
    expect(r.windows[1].dedup).toBe('skipped_deadline')
    expect(r.windows[1].attemptMs[0]).toBeGreaterThanOrEqual(24_500)
    expect(r.windows[1].attemptMs[0]).toBeLessThan(28_000)
    expect(llm.calls.some((c) => c.purpose === 'dedup')).toBe(false)
    // without dedup the near-duplicate stays a separate claim
    expect(r.claims.filter((c) => c.person === 'new:小林').map((c) => c.statement)).toEqual(['在读研究生', '在读研二'])
  })

  it('packs adjacent short sessions into one call and marks the session gap in the prompt', async () => {
    feats.pack = 40
    const llm = fakeLlm([ok(empty)])
    const r = await extractOffline({ parsed: parsedChat(TWO_SESSIONS), mapping: TWO_SESSIONS_MAPPING, llm })
    expect(r.windows.map((w) => [w.startIdx, w.endIdx, w.outcome])).toEqual([[0, 7, 'done']])
    const user = llm.calls[0].messages[1].content
    expect(user).toMatch(/—— 间隔约\d+(小时|天)，以下是新的一段对话 ——/)
    expect(user.indexOf('周末去爬山吗')).toBeLessThan(user.indexOf('—— 间隔'))
  })

  it('handles an export with no messages and rejects unknown prompt versions', async () => {
    const llm = fakeLlm([ok(empty)])
    const parsed = parsedChat(TWO_SESSIONS)
    const r = await extractOffline({ parsed: { ...parsed, messages: [] }, mapping: TWO_SESSIONS_MAPPING, llm })
    expect(r.windows).toEqual([])
    await expect(extractOffline({ parsed, mapping: TWO_SESSIONS_MAPPING, llm, promptVersion: 'extract.v999' })).rejects.toThrow()
  })
})
