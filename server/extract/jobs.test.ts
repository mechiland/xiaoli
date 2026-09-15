import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chats, claimMentions, claims, events, evidence, extractionJobs, handles, importantDates, imports, llmCalls, messages, persons, relations, withOwner, type Db } from '@/server/db'
import { ApiError } from '@/server/errors'
import { cassetteKey, createLlmClient, d1CallLogger, memoryCassetteStore, type LlmError, type LlmJsonRequest, type LlmJsonResult } from '@/server/llm'
import { createTestDb, createTestUser, fakeLlm } from '@/tests/helpers/test-db'
import { d1Store } from './d1-store'
import { createJobsForImport, processNextJob, retryFailedJobs } from './jobs'
import { renderExtractPrompt } from './prompt'
import { PROMPT_VERSION } from './prompt-version'

// Window packing (extract.v4+, DECISIONS ## extract X20) is switched off here so two short sessions stay two windows
// and retry/failure isolation between windows stays testable; `feats.pack` turns it on for the packing cases.
const feats = vi.hoisted(() => ({ pack: null as number | null }))
vi.mock('./prompt-version', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./prompt-version')>()
  return { ...mod, promptFeatures: (v: string) => ({ ...mod.promptFeatures(v), packMaxMessages: feats.pack }) }
})

// All chat content is invented.
const ok = (json: unknown, latencyMs = 800): LlmJsonResult => ({ ok: true, json, raw: JSON.stringify(json), usage: { inputTokens: 900, outputTokens: 90, cacheHitTokens: 0 }, latencyMs, model: 'deepseek-flash', finishReason: 'stop', fromCassette: false })
const err = (code: LlmError['code']): LlmError => ({ ok: false, code, message: code, raw: null, retryable: code !== 'budget_exceeded', latencyMs: 300 })
const empty = { newPersons: [], handles: [], relations: [], claims: [], events: [], dates: [] }
const env = { EXTRACT_MODEL: undefined }
const deadline = () => Date.now() + 28_000

let t: Awaited<ReturnType<typeof createTestDb>>
let db: Db
beforeAll(async () => {
  t = await createTestDb()
  db = t.db
})
afterAll(async () => t?.dispose())
afterEach(() => {
  feats.pack = null
})

let counter = 0
/** An import in status `extracting` of a group chat: self (山野), 阿明 with one confirmed claim, and messages. */
async function seedImport(bodies: { sender: 'me' | 'ming'; at: string; body: string }[]) {
  const user = await createTestUser(db, `extract-${++counter}-${Date.now()}@xiaoli.test`)
  const o = user.id
  const [self] = await db.insert(persons).values(withOwner<typeof persons>(o, { label: '我', isSelf: true, pinned: false, labelSort: 'wo' })).returning()
  const [ming] = await db.insert(persons).values(withOwner<typeof persons>(o, { label: '周明', isSelf: false, pinned: false, labelSort: 'zhouming' })).returning()
  const [chat] = await db.insert(chats).values(withOwner<typeof chats>(o, { title: '周末徒步', kind: 'group' })).returning()
  const [imp] = await db
    .insert(imports)
    .values(withOwner<typeof imports>(o, { chatId: chat.id, fileName: 'x.zip', fileSha256: `sha-${counter}`, parserVersion: 'test', status: 'extracting', messageCount: bodies.length, newMessageCount: bodies.length, stats: { byKind: {}, bySender: {}, images: { count: 0, bytes: 0 }, videos: { count: 0, bytes: 0 } } }))
    .returning()
  const [hSelf] = await db.insert(handles).values(withOwner<typeof handles>(o, { personId: self.id, kind: 'display_group', value: '山野', valueNorm: '山野', chatId: chat.id, status: 'confirmed', importId: imp.id, sourceKind: 'manual' })).returning()
  const [hMing] = await db.insert(handles).values(withOwner<typeof handles>(o, { personId: ming.id, kind: 'display_group', value: '阿明', valueNorm: '阿明', chatId: chat.id, status: 'confirmed', importId: imp.id, sourceKind: 'manual' })).returning()
  const [oldClaim] = await db
    .insert(claims)
    .values(withOwner<typeof claims>(o, { personId: ming.id, statement: '住在成都', statementNorm: '住在成都', category: 'location', learnedAt: '2026-01-01T00:00:00.000Z', confidence: null, sensitive: false, status: 'confirmed', statusChangedAt: '2026-01-01T00:00:00.000Z', sourceKind: 'manual' }))
    .returning()
  const msgRows = await db
    .insert(messages)
    .values(
      bodies.map((b, i) =>
        withOwner<typeof messages>(o, { chatId: chat.id, firstImportId: imp.id, senderHandleId: b.sender === 'me' ? hSelf.id : hMing.id, senderName: b.sender === 'me' ? '山野' : '阿明', sentAt: b.at, seq: i * 1024, kind: 'text', body: b.body, fingerprint: `f${i}` }),
      ),
    )
    .returning({ id: messages.id, seq: messages.seq })
  return { ownerId: o, self, ming, chat, imp, oldClaim, msgIds: msgRows.map((m) => m.id) }
}

const SESSIONS = [
  { sender: 'ming' as const, at: '2026-06-01 09:00', body: '我下个月搬去重庆了' },
  { sender: 'me' as const, at: '2026-06-01 09:01', body: '@阿明 周老师 恭喜！' },
  { sender: 'ming' as const, at: '2026-06-01 09:02', body: '我妈也一起过去，她农历三月初八生日' },
  { sender: 'ming' as const, at: '2026-06-01 15:00', body: '小林是我新同事，在设计公司' },
  { sender: 'me' as const, at: '2026-06-01 15:05', body: '周明现在在重庆定居了吧' },
]

describe('createJobsForImport', () => {
  it('plans windows over the chat, is idempotent, and is owner-scoped', async () => {
    const s = await seedImport(SESSIONS)
    expect(await createJobsForImport(db, s.ownerId, s.imp.id, [[0, 4 * 1024]])).toBe(2)
    expect(await createJobsForImport(db, s.ownerId, s.imp.id, [[0, 4 * 1024]])).toBe(0)
    const jobs = await db.select().from(extractionJobs).where(eq(extractionJobs.importId, s.imp.id)).all() // owner-checked: test
    expect(jobs.map((j) => [j.windowStartSeq, j.windowEndSeq, j.status, j.attempts])).toEqual([
      [0, 2048, 'pending', 0],
      [3072, 4096, 'pending', 0],
    ])
    const other = await createTestUser(db, `other-${Date.now()}@xiaoli.test`)
    await expect(createJobsForImport(db, other.id, s.imp.id, [[0, 1]])).rejects.toBeInstanceOf(ApiError)
  })

  it('packs adjacent short sessions into one job when the prompt version packs windows', async () => {
    feats.pack = 40
    const s = await seedImport(SESSIONS)
    expect(await createJobsForImport(db, s.ownerId, s.imp.id, [[0, 4 * 1024]])).toBe(1)
    const jobs = await db.select().from(extractionJobs).where(eq(extractionJobs.importId, s.imp.id)).all() // owner-checked: test
    expect(jobs.map((j) => [j.windowStartSeq, j.windowEndSeq, j.focusStartSeq, j.focusEndSeq])).toEqual([[0, 4096, 0, 4096]])
  })
})

describe('processNextJob', () => {
  it('persists proposed items with evidence, supersede link, mentions, new persons; finishes the import', async () => {
    const s = await seedImport(SESSIONS)
    await createJobsForImport(db, s.ownerId, s.imp.id, [[0, 4 * 1024]])
    const first = {
      ...empty,
      newPersons: [{ tempId: 't1', label: '周妈妈', evidence: [3] }],
      handles: [{ person: { personId: s.ming.id }, kind: 'address_term', value: '周老师', evidence: [2] }],
      relations: [{ from: { tempId: 't1' }, to: { personId: s.ming.id }, type: 'parent', label: '妈妈', evidence: [3] }],
      claims: [{ person: { personId: s.ming.id }, statement: '搬去重庆', category: 'location', validFrom: '2026-07', confidence: 0.9, sensitive: false, supersedesClaimId: s.oldClaim.id, evidence: [1] }],
      events: [{ summary: '和妈妈一起搬去重庆', participants: [{ personId: s.ming.id }, { tempId: 't1' }], evidence: [1, 3] }],
      dates: [{ person: { tempId: 't1' }, kind: 'birthday', month: 3, day: 8, calendar: 'lunar', evidence: [3] }],
    }
    const second = {
      ...empty,
      newPersons: [{ tempId: 't1', label: '小林', evidence: [1] }],
      relations: [{ from: { tempId: 't1' }, to: { personId: s.ming.id }, type: 'colleague', evidence: [1] }],
      claims: [
        { person: { tempId: 't1' }, statement: '在设计公司工作，是周明的同事', category: 'work', confidence: 0.9, sensitive: false, evidence: [1] },
        { person: { personId: s.ming.id }, statement: '在重庆定居', category: 'location', confidence: 0.85, sensitive: false, evidence: [2] },
      ],
    }
    const llm = fakeLlm([
      (req) => {
        if (req.purpose === 'dedup') {
          const g = (JSON.parse(req.messages[1].content.split('\n')[0]) as { persons: { personId: number; candidates: { id: number; statement: string }[]; new: { index: number }[] }[] }).persons.find((p) => p.personId === s.ming.id)!
          const moved = g?.candidates.find((c) => c.statement === '搬去重庆')
          return ok({ duplicates: moved ? [{ newIndex: g.new[0].index, existingClaimId: moved.id }] : [] })
        }
        return ok(req.messages[1].content.includes('我下个月搬去重庆了') ? first : second)
      },
    ])

    const r1 = await processNextJob(db, llm, s.ownerId, s.imp.id, { deadlineAt: deadline(), env })
    expect(r1.processed).toMatchObject({ status: 'done', itemsCreated: 5 })
    expect(r1.progress).toEqual({ total: 2, done: 1, failed: 0, pending: 1, running: 0 })
    expect(r1.importStatus).toBe('extracting')
    expect(llm.calls[0].context).toEqual({ ownerId: s.ownerId, importId: s.imp.id, jobId: r1.processed!.jobId })
    expect(llm.calls[0].promptVersion).toBe(PROMPT_VERSION)

    const r2 = await processNextJob(db, llm, s.ownerId, s.imp.id, { deadlineAt: deadline(), env })
    expect(r2.processed).toMatchObject({ status: 'done', itemsCreated: 2 }) // the dedup-merged claim is not a new item
    expect(r2.importStatus).toBe('reviewing')
    const r3 = await processNextJob(db, llm, s.ownerId, s.imp.id, { deadlineAt: deadline(), env })
    expect(r3).toMatchObject({ processed: null, importStatus: 'reviewing' })

    const o = s.ownerId
    const newPersons = await db.select().from(persons).where(and(eq(persons.ownerId, o), eq(persons.importId, s.imp.id))).all()
    expect(newPersons.map((p) => p.label).sort()).toEqual(['周妈妈', '小林'])
    const cl = await db.select().from(claims).where(and(eq(claims.ownerId, o), eq(claims.importId, s.imp.id))).all()
    expect(cl.map((c) => [c.statement, c.status, c.sourceKind]).sort()).toEqual([
      ['在设计公司工作，是周明的同事', 'proposed', 'ai'],
      ['搬去重庆', 'proposed', 'ai'],
    ])
    const moved = cl.find((c) => c.statement === '搬去重庆')!
    expect(moved).toMatchObject({ supersedesClaimId: s.oldClaim.id, validFrom: '2026-07', confidence: 0.9, personId: s.ming.id })
    // dedup merged "在重庆定居" (message 5) into the first window's claim
    const ev = await db.select().from(evidence).where(and(eq(evidence.ownerId, o), eq(evidence.targetType, 'claim'), eq(evidence.targetId, moved.id))).all()
    expect(ev.map((e) => e.messageId).sort((a, b) => a - b)).toEqual([s.msgIds[0], s.msgIds[4]])
    const mentions = await db.select().from(claimMentions).where(eq(claimMentions.ownerId, o)).all()
    expect(mentions.map((m) => m.personId)).toEqual([s.ming.id])
    const h = await db.select().from(handles).where(and(eq(handles.ownerId, o), eq(handles.kind, 'address_term'))).all()
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ value: '周老师', personId: s.ming.id, chatId: s.chat.id, status: 'proposed' })
    const rel = await db.select().from(relations).where(eq(relations.ownerId, o)).all()
    expect(rel.map((x) => [x.type, x.toPersonId === s.ming.id])).toEqual([
      ['parent', true],
      ['colleague', true],
    ])
    const dates = await db.select().from(importantDates).where(eq(importantDates.ownerId, o)).all()
    expect(dates[0]).toMatchObject({ kind: 'birthday', month: 3, day: 8, calendar: 'lunar', status: 'proposed' })
    const evs = await db.select().from(events).where(eq(events.ownerId, o)).all()
    expect(evs).toHaveLength(1)
    const jobs = await db.select().from(extractionJobs).where(eq(extractionJobs.ownerId, o)).all()
    expect(jobs.every((j) => j.status === 'done' && j.model === 'deepseek-flash' && j.promptVersion === PROMPT_VERSION && j.rawOutput && j.attempts === 1 && j.lockedAt === null)).toBe(true)
    // the old confirmed claim is not touched until review confirms the new one
    const old = await db.select().from(claims).where(and(eq(claims.ownerId, o), eq(claims.id, s.oldClaim.id))).get()
    expect(old?.status).toBe('confirmed')
  })

  it('stores a claim the model emitted without `sensitive`; logs schema drops by field name only (overall critic r3 #1, X31)', async () => {
    const s = await seedImport([
      { sender: 'me', at: '2026-08-26 06:46', body: '阿明，孩子啥时候返校' },
      { sender: 'ming', at: '2026-08-26 07:10', body: '我在成都一中教物理，下周一开学' },
      { sender: 'ming', at: '2026-08-26 07:12', body: '新号码13812345678' },
    ])
    await createJobsForImport(db, s.ownerId, s.imp.id, [[0, 2 * 1024]])
    const out = {
      ...empty,
      claims: [
        { person: { personId: s.ming.id }, statement: '在成都一中教物理', category: 'work', confidence: 0.9, evidence: [2] },
        { person: { personId: s.ming.id }, statement: '手机号13812345678', category: 'other', confidence: 0.9, evidence: [3] },
        { person: { personId: s.ming.id }, statement: '喜欢爬山', category: 'hobby', confidence: 0.9, evidence: [2] },
      ],
    }
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => void logs.push(String(line)))
    try {
      const r = await processNextJob(db, fakeLlm([ok(out)]), s.ownerId, s.imp.id, { deadlineAt: deadline(), env })
      expect(r.processed).toMatchObject({ status: 'done', itemsCreated: 2 })
    } finally {
      spy.mockRestore()
    }
    const cl = await db.select().from(claims).where(and(eq(claims.ownerId, s.ownerId), eq(claims.importId, s.imp.id))).all()
    expect(cl.map((c) => [c.statement, c.sensitive, c.status]).sort()).toEqual([
      ['在成都一中教物理', false, 'proposed'],
      ['提供过手机号', true, 'proposed'],
    ])
    const warn = logs.map((l) => JSON.parse(l) as { msg: string; items?: unknown }).find((l) => l.msg === 'extract items dropped (invalid_item)')
    expect(warn?.items).toEqual([{ path: 'claims[2]', fields: ['category:invalid_value'] }])
    expect(logs.join('\n')).not.toMatch(/喜欢爬山|13812345678/)
  })

  it('retries a failing window (max 3 attempts), fails it, continues the others; retryFailedJobs resets', async () => {
    const s = await seedImport(SESSIONS)
    await createJobsForImport(db, s.ownerId, s.imp.id, [[0, 4 * 1024]])
    const llm = fakeLlm([(req) => (req.messages[1].content.includes('我下个月搬去重庆了') ? err('invalid_json') : ok(empty))])
    const statuses: (string | undefined)[] = []
    for (let i = 0; i < 6; i++) {
      const r = await processNextJob(db, llm, s.ownerId, s.imp.id, { deadlineAt: deadline(), env })
      statuses.push(r.processed ? `${r.processed.status}:${r.processed.code ?? ''}` : `none:${r.importStatus}`)
    }
    // job order is by id and a pending retry is picked before the later job
    expect(statuses).toEqual(['pending:invalid_json', 'pending:invalid_json', 'failed:invalid_json', 'done:', 'none:reviewing', 'none:reviewing'])
    const jobs = await db.select().from(extractionJobs).where(eq(extractionJobs.ownerId, s.ownerId)).all()
    expect(jobs.map((j) => [j.status, j.attempts])).toEqual([
      ['failed', 3],
      ['done', 1],
    ])
    expect(jobs[0].error).toContain('invalid_json')

    const reset = await retryFailedJobs(db, s.ownerId, s.imp.id)
    expect(reset).toEqual({ reset: 1, progress: { total: 2, done: 1, failed: 0, pending: 1, running: 0 } })
    const imp = await db.select().from(imports).where(and(eq(imports.ownerId, s.ownerId), eq(imports.id, s.imp.id))).get()
    expect(imp?.status).toBe('extracting')
    const again = await db.select().from(extractionJobs).where(and(eq(extractionJobs.ownerId, s.ownerId), eq(extractionJobs.id, jobs[0].id))).get()
    expect(again).toMatchObject({ status: 'pending', attempts: 0, error: null })
  })

  it('fails immediately on budget_exceeded (fatal) and ends the import with nothing to review as reviewing', async () => {
    const s = await seedImport(SESSIONS.slice(0, 3))
    await createJobsForImport(db, s.ownerId, s.imp.id, [[0, 2048]])
    const r = await processNextJob(db, fakeLlm([err('budget_exceeded')]), s.ownerId, s.imp.id, { deadlineAt: deadline(), env })
    expect(r.processed).toMatchObject({ status: 'failed', code: 'budget_exceeded' })
    expect(r.importStatus).toBe('reviewing')
  })

  it('an import with no proposed items and no failures ends as done', async () => {
    const s = await seedImport(SESSIONS.slice(0, 3))
    await createJobsForImport(db, s.ownerId, s.imp.id, [[0, 2048]])
    const r = await processNextJob(db, fakeLlm([ok(empty)]), s.ownerId, s.imp.id, { deadlineAt: deadline(), env })
    expect(r).toMatchObject({ processed: { status: 'done', itemsCreated: 0 }, importStatus: 'done' })
  })

  it('respects the per-request deadline: slow extract call → dedup skipped, response well under 30 s', async () => {
    const s = await seedImport(SESSIONS.slice(0, 3))
    await createJobsForImport(db, s.ownerId, s.imp.id, [[0, 2048]])
    const out = { ...empty, claims: [{ person: { personId: s.ming.id }, statement: '在成都生活', category: 'location', confidence: 0.9, sensitive: false, evidence: [1] }] }
    // a misbehaving adapter that ignores timeoutMs and returns after 5 s, with 8 s left of the request
    const llm = fakeLlm([
      async (req) => {
        if (req.purpose === 'dedup') return ok({ duplicates: [] })
        await new Promise((res) => setTimeout(res, 5_000))
        return ok(out, 5_000)
      },
    ])
    const start = Date.now()
    const r = await processNextJob(db, llm, s.ownerId, s.imp.id, { deadlineAt: Date.now() + 8_000, env })
    expect(Date.now() - start).toBeLessThan(30_000)
    expect(r.processed).toMatchObject({ status: 'done', itemsCreated: 1 })
    expect(llm.calls.map((c) => c.purpose)).toEqual(['extract'])
    expect(llm.calls[0].timeoutMs).toBeLessThanOrEqual(2_000)
  }, 20_000)

  it('does not call the model with less than 1 s for the extract call; the attempt counts', async () => {
    const s = await seedImport(SESSIONS.slice(0, 3))
    await createJobsForImport(db, s.ownerId, s.imp.id, [[0, 2048]])
    const llm = fakeLlm([ok(empty)])
    const r = await processNextJob(db, llm, s.ownerId, s.imp.id, { deadlineAt: Date.now() + 3_000, env })
    expect(r.processed).toMatchObject({ status: 'pending', code: 'deadline' })
    expect(llm.calls).toHaveLength(0)
  })

  it('uses the model from settings / env and does nothing for imports that are not extracting', async () => {
    const s = await seedImport(SESSIONS.slice(0, 3))
    await createJobsForImport(db, s.ownerId, s.imp.id, [[0, 2048]])
    const llm = fakeLlm([ok(empty)])
    await processNextJob(db, llm, s.ownerId, s.imp.id, { deadlineAt: deadline(), env: { EXTRACT_MODEL: 'deepseek-v4-pro' } })
    expect(llm.calls[0].model).toBe('deepseek-v4-pro')
    const r = await processNextJob(db, llm, s.ownerId, s.imp.id, { deadlineAt: deadline(), env })
    expect(r).toMatchObject({ processed: null, importStatus: 'done' })
    expect(llm.calls).toHaveLength(1)
  })

  it('isolates owners: another account gets 404 and cannot see the window', async () => {
    const s = await seedImport(SESSIONS.slice(0, 3))
    await createJobsForImport(db, s.ownerId, s.imp.id, [[0, 2048]])
    const other = await createTestUser(db, `iso-${Date.now()}@xiaoli.test`)
    const llm = fakeLlm([ok(empty)])
    await expect(processNextJob(db, llm, other.id, s.imp.id, { deadlineAt: deadline(), env })).rejects.toMatchObject({ status: 404 })
    await expect(retryFailedJobs(db, other.id, s.imp.id)).rejects.toMatchObject({ status: 404 })
    await expect(d1Store(db, other.id).loadWindow({ importId: s.imp.id, jobId: null, windowIndex: 0, startSeq: 0, endSeq: 2048, focusStartSeq: 0, focusEndSeq: 2048 })).rejects.toThrow()
    expect(await d1Store(db, other.id).findSimilarClaims(s.ming.id, s.imp.id)).toEqual([])
    expect(llm.calls).toHaveLength(0)
    const jobs = await db.select().from(extractionJobs).where(eq(extractionJobs.ownerId, s.ownerId)).all()
    expect(jobs.every((j) => j.status === 'pending' && j.attempts === 0)).toBe(true)
  })

  it('marks context messages from earlier imports and never stores items resting only on them', async () => {
    const s = await seedImport(SESSIONS.slice(0, 3))
    const [imp2] = await db
      .insert(imports)
      .values(withOwner<typeof imports>(s.ownerId, { chatId: s.chat.id, fileName: 'y.zip', fileSha256: `sha2-${counter}`, parserVersion: 'test', status: 'extracting', messageCount: 1, newMessageCount: 1, stats: { byKind: {}, bySender: {}, images: { count: 0, bytes: 0 }, videos: { count: 0, bytes: 0 } } }))
      .returning()
    const [hMing] = await db.select().from(handles).where(and(eq(handles.ownerId, s.ownerId), eq(handles.value, '阿明'))).all()
    await db.insert(messages).values(withOwner<typeof messages>(s.ownerId, { chatId: s.chat.id, firstImportId: imp2.id, senderHandleId: hMing.id, senderName: '阿明', sentAt: '2026-06-01 09:30', seq: 3 * 1024, kind: 'text', body: '新消息：我养了一只猫', fingerprint: 'fnew' }))
    expect(await createJobsForImport(db, s.ownerId, imp2.id, [[3 * 1024, 3 * 1024]])).toBe(1)
    let prompt = ''
    const llm = fakeLlm([
      (req) => {
        if (req.purpose === 'dedup') return ok({ duplicates: [] })
        prompt = req.messages[1].content
        return ok({
          ...empty,
          claims: [
            { person: { personId: s.ming.id }, statement: '下个月搬去重庆', category: 'location', confidence: 0.9, sensitive: false, evidence: [1] },
            { person: { personId: s.ming.id }, statement: '养了一只猫', category: 'preference', confidence: 0.9, sensitive: false, evidence: [4] },
          ],
        })
      },
    ])
    const r = await processNextJob(db, llm, s.ownerId, imp2.id, { deadlineAt: deadline(), env })
    expect(prompt).toContain('【上下文】#1 [2026-06-01 09:00]')
    expect(prompt).toContain(`\n#4 [2026-06-01 09:30] 阿明(${s.ming.id}): 新消息`)
    expect(r.processed).toMatchObject({ status: 'done', itemsCreated: 1 })
    const cl = await db.select().from(claims).where(and(eq(claims.ownerId, s.ownerId), eq(claims.importId, imp2.id))).all()
    expect(cl.map((c) => c.statement)).toEqual(['养了一只猫'])
  })

  it('writes llm_calls through the real adapter in replay mode with owner/import/job context', async () => {
    const s = await seedImport(SESSIONS.slice(0, 3))
    await createJobsForImport(db, s.ownerId, s.imp.id, [[0, 2048]])
    const [job] = await db.select().from(extractionJobs).where(and(eq(extractionJobs.ownerId, s.ownerId), eq(extractionJobs.importId, s.imp.id))).all()
    const win = await d1Store(db, s.ownerId).loadWindow({ importId: s.imp.id, jobId: job.id, windowIndex: job.id, startSeq: job.windowStartSeq, endSeq: job.windowEndSeq, focusStartSeq: job.focusStartSeq, focusEndSeq: job.focusEndSeq })
    const req: LlmJsonRequest = { purpose: 'extract', promptVersion: PROMPT_VERSION, model: 'deepseek-flash', messages: renderExtractPrompt(win), maxTokens: 8192, temperature: 0 }
    const content = JSON.stringify({ ...empty, dates: [{ person: { personId: s.ming.id }, kind: 'birthday', month: 3, day: 8, calendar: 'lunar', evidence: [3] }] })
    const store = memoryCassetteStore([
      { key: cassetteKey(req, 'disabled'), recordedAt: '2026-09-15T00:00:00.000Z', model: 'deepseek-flash', promptVersion: PROMPT_VERSION, purpose: 'extract', request: { messages: req.messages, maxTokens: 8192, temperature: 0, thinking: 'disabled' }, response: { content, finishReason: 'stop', usage: { inputTokens: 1500, outputTokens: 60, cacheHitTokens: 0 }, latencyMs: 1200 }, error: null },
    ])
    const llm = createLlmClient({ env: { NEXTJS_ENV: 'test' }, logger: d1CallLogger(db), mode: 'replay', budget: null, cassetteStore: store })
    const r = await processNextJob(db, llm, s.ownerId, s.imp.id, { deadlineAt: deadline(), env })
    expect(r.processed).toMatchObject({ status: 'done', itemsCreated: 1 })
    const calls = await db.select().from(llmCalls).where(eq(llmCalls.importId, s.imp.id)).all() // owner-checked: filtered by this test's import
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ ownerId: s.ownerId, jobId: job.id, purpose: 'extract', mode: 'replay', promptVersion: PROMPT_VERSION, inputTokens: 1500, rawOutput: content })
  })
})
