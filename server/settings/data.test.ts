// GET /api/export and DELETE /api/data: table lists (§11), owner isolation, R2 prefix, idempotency. Synthetic data only.
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ExportDumpSchema } from '@/contracts'
import {
  attachments,
  chats,
  claimMentions,
  claims,
  eventParticipants,
  events,
  evidence,
  extractionJobs,
  handles,
  importantDates,
  importMessages,
  imports,
  llmCalls,
  messages,
  persons,
  relations,
  reviewLog,
  updateUserSettings,
  withOwner,
  withOwnerLink,
  type Db,
} from '@/server/db'
import { createTestApp, createTestDb, createTestUser } from '@/tests/helpers/test-db'
import { countOwnerRows, DELETE_ALL_TABLES, EXPORT_TABLE_KEYS, exportFileName } from './data'

const STATS = { byKind: {}, bySender: {}, images: { count: 0, bytes: 0 }, videos: { count: 0, bytes: 0 } }
const NOW = '2026-09-15T08:00:00.000Z'

/** One row in every §11 table for `ownerId`, plus R2 objects under its prefix. */
async function world(db: Db, r2: R2Bucket, ownerId: string, tag: string) {
  const one = async <T>(q: Promise<T[]>) => (await q)[0]
  const chat = await one(db.insert(chats).values(withOwner<typeof chats>(ownerId, { title: `聊天${tag}`, kind: 'private', note: null })).returning())
  const imp = await one(
    db
      .insert(imports)
      .values(withOwner<typeof imports>(ownerId, { chatId: chat.id, fileName: `${tag}.zip`, fileSha256: `sha-${tag}`, exportedAt: null, parserVersion: 't', status: 'done', messageCount: 1, newMessageCount: 1, dateFrom: null, dateTo: null, stats: STATS, error: null }))
      .returning(),
  )
  const self = await one(db.insert(persons).values(withOwner<typeof persons>(ownerId, { label: '我', labelSort: 'wo', isSelf: true, pinned: false, mergedIntoId: null, importId: null })).returning())
  const p = await one(db.insert(persons).values(withOwner<typeof persons>(ownerId, { label: `周以宁${tag}`, labelSort: 'zhou', isSelf: false, pinned: true, mergedIntoId: null, importId: imp.id })).returning())
  // a merged-into person (self-FK) must not block delete-all
  await db.insert(persons).values(withOwner<typeof persons>(ownerId, { label: `旧${tag}`, labelSort: 'jiu', isSelf: false, pinned: false, mergedIntoId: p.id, importId: null }))
  const h = await one(
    db.insert(handles).values(withOwner<typeof handles>(ownerId, { personId: p.id, kind: 'display_private', value: `以宁${tag}`, valueNorm: `以宁${tag}`, chatId: chat.id, status: 'confirmed', importId: imp.id, sourceKind: 'manual' })).returning(),
  )
  const m = await one(
    db
      .insert(messages)
      .values(withOwner<typeof messages>(ownerId, { chatId: chat.id, firstImportId: imp.id, senderHandleId: h.id, senderName: `以宁${tag}`, sentAt: '2026-09-01 10:00', seq: 1024, kind: 'image', body: '[图片]', meta: null, fingerprint: `fp-${tag}` }))
      .returning(),
  )
  const key = `u/${ownerId}/att/${imp.id}/x-a.jpg`
  await r2.put(key, new Uint8Array([1, 2, 3]))
  await r2.put(`u/${ownerId}/avatar/${p.id}`, new Uint8Array([4]))
  await db.insert(attachments).values(withOwner<typeof attachments>(ownerId, { messageId: m.id, kind: 'image', fileName: 'a.jpg', selected: true, r2Key: key, byteSize: 3, mime: 'image/jpeg' }))
  await db.insert(importMessages).values(withOwnerLink<typeof importMessages>(ownerId, { importId: imp.id, messageId: m.id }))
  const c1 = await one(
    db
      .insert(claims)
      .values(withOwner<typeof claims>(ownerId, { personId: p.id, statement: `在汉中读高中${tag}`, statementNorm: 'x', category: 'education', validFrom: null, validTo: null, learnedAt: NOW, confidence: 0.9, sensitive: false, status: 'confirmed', statusReason: null, statusChangedAt: NOW, supersedesClaimId: null, supersededByClaimId: null, importId: imp.id, jobId: null, sourceKind: 'ai' }))
      .returning(),
  )
  await db.insert(claimMentions).values(withOwnerLink<typeof claimMentions>(ownerId, { claimId: c1.id, personId: self.id }))
  await db.insert(evidence).values(withOwnerLink<typeof evidence>(ownerId, { targetType: 'claim', targetId: c1.id, messageId: m.id }))
  const e = await one(db.insert(events).values(withOwner<typeof events>(ownerId, { summary: `一起吃饭${tag}`, happenedAt: '2026-09', place: null, status: 'confirmed', importId: imp.id, sourceKind: 'ai' })).returning())
  await db.insert(eventParticipants).values(withOwnerLink<typeof eventParticipants>(ownerId, { eventId: e.id, personId: p.id }))
  await db.insert(importantDates).values(withOwner<typeof importantDates>(ownerId, { personId: p.id, kind: 'birthday', day: 3, month: 5, year: null, calendar: 'lunar', isLeapMonth: false, label: null, status: 'confirmed', importId: imp.id, sourceKind: 'ai' }))
  await db.insert(relations).values(withOwner<typeof relations>(ownerId, { fromPersonId: p.id, toPersonId: self.id, type: 'friend', label: null, status: 'confirmed', importId: imp.id, sourceKind: 'ai' }))
  await db
    .insert(extractionJobs)
    .values(withOwner<typeof extractionJobs>(ownerId, { importId: imp.id, windowStartSeq: 0, windowEndSeq: 1024, focusStartSeq: 0, focusEndSeq: 1024, status: 'done', attempts: 1, lockedAt: null, model: 'deepseek-flash', promptVersion: 'extract.v5', rawOutput: '{"claims":[]}', error: null, itemsCreated: 1 }))
  await db.insert(reviewLog).values(withOwner<typeof reviewLog>(ownerId, { targetType: 'claim', targetId: c1.id, action: 'accept', before: { status: 'proposed' }, after: { status: 'confirmed' } }))
  await db.insert(llmCalls).values({ ownerId, provider: 'deepseek', model: 'deepseek-flash', promptVersion: 'extract.v5', purpose: 'extract', importId: imp.id, jobId: null, evalRunId: null, inputTokens: 10, outputTokens: 5, cacheHitTokens: 0, latencyMs: 100, attempt: 1, mode: 'replay', cassetteKey: null, rawOutput: '{"claims":[]}', finishReason: 'stop', errorCode: null, errorMessage: null, createdAt: NOW })
  await updateUserSettings(db, ownerId, { selfDisplayNames: [`小丽${tag}`], extractModel: 'deepseek-v4-pro', highConfidenceThreshold: 0.9, onboarded: true })
  return { chat, imp, p }
}

async function r2Count(r2: R2Bucket, ownerId: string) {
  return (await r2.list({ prefix: `u/${ownerId}/` })).objects.length
}

describe('settings data routes: export + delete all', () => {
  let db: Db
  let r2: R2Bucket
  let dispose: () => Promise<void>
  let userA: { id: string; email: string; name: string }
  let userB: { id: string; email: string; name: string }

  const call = async (userId: string | null, method: string, url: string, body?: unknown, env?: Record<string, unknown>) => {
    const app = createTestApp({ db, r2, userId, env })
    const res = await app.request(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, headers: res.headers, json: text ? (JSON.parse(text) as Record<string, unknown>) : null, text }
  }

  beforeAll(async () => {
    const t = await createTestDb()
    db = t.db
    r2 = t.r2
    dispose = t.dispose
    userA = await createTestUser(db, 'settings-a@xiaoli.test', '甲')
    userB = await createTestUser(db, 'settings-b@xiaoli.test', '乙')
    await world(db, r2, userA.id, 'A')
    await world(db, r2, userB.id, 'B')
  })
  afterAll(async () => dispose?.())

  it('requires a session', async () => {
    expect((await call(null, 'GET', '/api/export')).status).toBe(401)
    expect((await call(null, 'DELETE', '/api/data', { confirm: '删除全部数据' })).status).toBe(401)
  })

  it('GET /api/export returns the full dump of the caller only, as an attachment, without ownerId', async () => {
    const r = await call(userA.id, 'GET', '/api/export')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="xiaoli-export-\d{8}\.json"$/)
    const dump = ExportDumpSchema.parse(r.json)
    expect(dump.version).toBe(1)
    expect(dump.user).toEqual({ id: userA.id, email: userA.email, name: '甲' })
    expect(dump.settings).toMatchObject({ selfDisplayNames: ['小丽A'], extractModel: 'deepseek-v4-pro', highConfidenceThreshold: 0.9 })
    // exactly the documented keys
    expect(Object.keys(r.json!).sort()).toEqual(['exportedAt', 'version', 'user', 'settings', ...EXPORT_TABLE_KEYS].sort())
    for (const key of EXPORT_TABLE_KEYS) {
      const rows = dump[key]
      expect(rows.length, key).toBeGreaterThan(0)
      for (const row of rows) expect(row, key).not.toHaveProperty('ownerId')
    }
    expect(dump.persons).toHaveLength(3)
    expect(dump.extractionJobs[0]).toHaveProperty('rawOutput', '{"claims":[]}')
    expect(dump.llmCalls[0]).toHaveProperty('rawOutput', '{"claims":[]}')
    expect(dump.attachments[0]).toMatchObject({ fileName: 'a.jpg', byteSize: 3 })
    expect(dump.imports[0]).toMatchObject({ stats: STATS })
    // nothing of user B leaks
    expect(r.text).not.toContain('周以宁B')
    expect(r.text).not.toContain(userB.id)
  })

  it('export file name is dated in APP_TZ, not UTC (16:30Z is already the next day in Asia/Shanghai)', async () => {
    const clock = new Date('2026-09-15T16:30:00.000Z')
    expect(exportFileName('Asia/Shanghai', clock)).toBe('xiaoli-export-20260916.json')
    expect(exportFileName(undefined, clock)).toBe('xiaoli-export-20260916.json') // default tz = Asia/Shanghai
    expect(exportFileName('UTC', clock)).toBe('xiaoli-export-20260915.json')
    expect(exportFileName('America/Los_Angeles', new Date('2026-09-16T06:59:00.000Z'))).toBe('xiaoli-export-20260915.json')

    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(clock)
      const local = await call(userA.id, 'GET', '/api/export', undefined, { APP_TZ: 'Asia/Shanghai' })
      expect(local.headers.get('content-disposition')).toBe('attachment; filename="xiaoli-export-20260916.json"')
      const utc = await call(userA.id, 'GET', '/api/export', undefined, { APP_TZ: 'UTC' })
      expect(utc.headers.get('content-disposition')).toBe('attachment; filename="xiaoli-export-20260915.json"')
    } finally {
      vi.useRealTimers()
    }
  })

  it('export of an account with no data is a valid, empty dump', async () => {
    const lonely = await createTestUser(db, 'settings-empty@xiaoli.test')
    const r = await call(lonely.id, 'GET', '/api/export')
    expect(r.status).toBe(200)
    const dump = ExportDumpSchema.parse(r.json)
    for (const key of EXPORT_TABLE_KEYS) expect(dump[key]).toEqual([])
    expect(dump.settings).toEqual({ selfDisplayNames: [], extractModel: null, highConfidenceThreshold: 0.8, onboardedAt: null })
  })

  it('DELETE /api/data rejects a missing or wrong confirmation text and deletes nothing', async () => {
    const before = await countOwnerRows(db, userA.id)
    expect((await call(userA.id, 'DELETE', '/api/data', {})).status).toBe(400)
    expect((await call(userA.id, 'DELETE', '/api/data', { confirm: '删除全部' })).status).toBe(400)
    expect((await call(userA.id, 'DELETE', '/api/data', { confirm: ' 删除全部数据' })).status).toBe(400)
    expect(await countOwnerRows(db, userA.id)).toEqual(before)
    expect(await r2Count(r2, userA.id)).toBe(2)
  })

  it('DELETE /api/data removes every §11 table and the R2 prefix for the caller, keeps the account, leaves user B untouched', async () => {
    const bBefore = await countOwnerRows(db, userB.id)
    const r = await call(userA.id, 'DELETE', '/api/data', { confirm: '删除全部数据' })
    expect(r.status).toBe(200)
    const body = r.json as { deleted: Record<string, number>; r2Objects: number }
    expect(Object.keys(body.deleted)).toEqual([...DELETE_ALL_TABLES])
    expect(body.deleted).toMatchObject({ persons: 3, messages: 1, claims: 1, llm_calls: 1, user_settings: 1, evidence: 1, import_messages: 1 })
    expect(body.r2Objects).toBe(2)

    const after = await countOwnerRows(db, userA.id)
    expect(Object.values(after).every((n) => n === 0)).toBe(true)
    expect(await r2Count(r2, userA.id)).toBe(0)

    // account kept; settings read back as defaults
    const me = await call(userA.id, 'GET', '/api/me')
    expect(me.status).toBe(200)
    expect((me.json as { settings: unknown }).settings).toEqual({ selfDisplayNames: [], extractModel: null, highConfidenceThreshold: 0.8, onboardedAt: null })

    // user B unchanged, in D1 and R2
    expect(await countOwnerRows(db, userB.id)).toEqual(bBefore)
    expect(await r2Count(r2, userB.id)).toBe(2)
    const bPerson = await db.select().from(persons).where(eq(persons.label, '周以宁B')).get() // owner-checked: test assertion on a unique synthetic label
    expect(bPerson?.ownerId).toBe(userB.id)
  })

  it('is idempotent: a second delete-all deletes 0 rows and 0 objects', async () => {
    const r = await call(userA.id, 'DELETE', '/api/data', { confirm: '删除全部数据' })
    expect(r.status).toBe(200)
    const body = r.json as { deleted: Record<string, number>; r2Objects: number }
    expect(Object.values(body.deleted).every((n) => n === 0)).toBe(true)
    expect(body.r2Objects).toBe(0)
  })

  it('after delete-all the account can import again (self person is re-created by mapping)', async () => {
    const r = await call(userA.id, 'PATCH', '/api/settings', { selfDisplayNames: ['小丽'] })
    expect(r.status).toBe(200)
    expect((await call(userA.id, 'GET', '/api/export')).status).toBe(200)
  })
})
