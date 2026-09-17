import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { claims, eventParticipants, evidence, handles, importantDates, owned, persons, relations, reviewLog, withOwner, withOwnerLink, type Db } from '@/server/db'
import { createTestDb, createTestUser } from '@/tests/helpers/test-db'
import { client, seedWorld, type Json, type World } from './fixtures'

describe('people actions: create, merge, split, manual add, isolation', () => {
  let db: Db
  let dispose: () => Promise<void>
  let uid: string
  let w: World
  let api: ReturnType<typeof client>

  beforeAll(async () => {
    const t = await createTestDb()
    db = t.db
    dispose = t.dispose
  })
  afterAll(async () => dispose?.())
  beforeEach(async () => {
    uid = (await createTestUser(db, `p${Math.random()}@xiaoli.test`)).id
    w = await seedWorld(db, uid)
    api = client(db, uid)
  })

  const person = (id: number) => db.select().from(persons).where(owned(persons, uid, eq(persons.id, id))).get()
  const evCount = async (type: 'claim' | 'relation', id: number) =>
    (await db.select().from(evidence).where(owned(evidence, uid, eq(evidence.targetType, type), eq(evidence.targetId, id)))).length

  it('POST /api/people creates a person (201) with a pinyin sort key', async () => {
    const r = await api.post('/api/people', { label: '  王小丽 ' })
    expect(r.status).toBe(201)
    expect(r.body.person).toMatchObject({ label: '王小丽', isSelf: false, mergedIntoId: null, pinned: false })
    expect((await person(r.body.person.id))!.labelSort).toBe('wang xiao li')
    expect((await api.post('/api/people', { label: '   ' })).status).toBe(400)
  })

  it('merge moves handles, claims, dates, relations, events; evidence follows the items; self-loops dropped; log rows', async () => {
    const r = await api.post(`/api/people/${w.b.id}/merge`, { intoId: w.a.id })
    expect(r.status).toBe(200)
    expect(r.body.person.id).toBe(w.a.id)
    expect(r.body.moved).toEqual({ handle: 2, claim: 4, date: 1, relation: 1, event: 1, loop: 0, segment: 0 })
    expect(await person(w.b.id)).toMatchObject({ mergedIntoId: w.a.id })
    const hs = await db.select().from(handles).where(owned(handles, uid, eq(handles.personId, w.a.id)))
    expect(hs.map((h) => h.id).sort()).toEqual([w.hA.id, w.hAp.id, w.hB.id, w.hBmention.id].sort())
    const cs = await db.select().from(claims).where(owned(claims, uid, eq(claims.personId, w.a.id)))
    expect(cs).toHaveLength(7)
    expect(await evCount('claim', w.b1.id)).toBe(1)
    expect(await db.select().from(importantDates).where(owned(importantDates, uid, eq(importantDates.personId, w.a.id)))).toHaveLength(1)
    // relation b→a became a→a → deleted with its evidence
    expect(await db.select().from(relations).where(owned(relations, uid, eq(relations.id, w.rel.id)))).toEqual([])
    expect(await evCount('relation', w.rel.id)).toBe(0)
    // event had a and b → only a remains, no duplicate participant row
    const parts = await db.select().from(eventParticipants).where(owned(eventParticipants, uid, eq(eventParticipants.eventId, w.evt.id)))
    expect(parts.map((p) => p.personId)).toEqual([w.a.id])
    const logs = await db.select().from(reviewLog).where(owned(reviewLog, uid, eq(reviewLog.action, 'merge')))
    expect(logs.length).toBe(2 + 4 + 1 + 1 + 1)
    // import review now shows everything under a
    const review = await api.get(`/api/imports/${w.imp.id}/review`)
    expect(review.body.sections.map((s: Json) => s.person.id)).toEqual([w.a.id])
    // merged person cannot be merged again; self cannot be merged away; same id rejected
    expect((await api.post(`/api/people/${w.b.id}/merge`, { intoId: w.c.id })).status).toBe(409)
    expect((await api.post(`/api/people/${w.self.id}/merge`, { intoId: w.c.id })).status).toBe(409)
    expect((await api.post(`/api/people/${w.c.id}/merge`, { intoId: w.c.id })).status).toBe(400)
    expect((await api.post(`/api/people/${w.c.id}/merge`, { intoId: w.b.id })).status).toBe(409)
  })

  it('merge folds duplicate relations into one, keeping the union of evidence', async () => {
    // c → a friend (confirmed) duplicates b → a friend once b is merged into c
    const [dup] = await db
      .insert(relations)
      .values(withOwner<typeof relations>(uid, { fromPersonId: w.c.id, toPersonId: w.a.id, type: 'friend', label: null, status: 'confirmed', importId: null, sourceKind: 'ai' }))
      .returning()
    await db.insert(evidence).values(withOwnerLink<typeof evidence>(uid, { targetType: 'relation', targetId: dup.id, messageId: w.g[8].id }))
    const r = await api.post(`/api/people/${w.b.id}/merge`, { intoId: w.c.id })
    expect(r.body.moved.relation).toBe(1)
    const rels = await db.select().from(relations).where(owned(relations, uid, and(eq(relations.fromPersonId, w.c.id), eq(relations.toPersonId, w.a.id))))
    expect(rels.map((x) => x.id)).toEqual([dup.id])
    expect(await evCount('relation', dup.id)).toBe(2)
    expect(await evCount('relation', w.rel.id)).toBe(0)
  })

  it('split moves the handle to a new person; items evidenced only by that handle go back to proposed (candidates)', async () => {
    await api.post('/api/review/bulk', { action: 'accept', items: [w.b1, w.b2, w.bMixed].map((c) => ({ type: 'claim', id: c.id })) })
    const r = await api.post(`/api/people/${w.b.id}/split`, { handleId: w.hB.id })
    expect(r.status).toBe(200)
    expect(r.body.person).toMatchObject({ label: '嘉树', mergedIntoId: null })
    const cands = (r.body.movedEvidenceCandidates as Json[]).map((x) => `${x.targetType}:${x.targetId}`).sort()
    // b1 (g1 by hB), b2 (g4 by hB), bSensitive (g7 by hB), hBmention (g4 by hB); bMixed has a self message → not a candidate
    expect(cands).toEqual([`claim:${w.b1.id}`, `claim:${w.b2.id}`, `claim:${w.bSensitive.id}`, `handle:${w.hBmention.id}`].sort())
    const h = await db.select().from(handles).where(owned(handles, uid, eq(handles.id, w.hB.id))).get()
    expect(h!.personId).toBe(r.body.person.id)
    const b1 = await db.select().from(claims).where(owned(claims, uid, eq(claims.id, w.b1.id))).get()
    expect(b1).toMatchObject({ personId: w.b.id, status: 'proposed' })
    const mixed = await db.select().from(claims).where(owned(claims, uid, eq(claims.id, w.bMixed.id))).get()
    expect(mixed!.status).toBe('confirmed')
    const splitLogs = await db.select().from(reviewLog).where(owned(reviewLog, uid, eq(reviewLog.action, 'split')))
    expect(splitLogs.length).toBe(5)
    // a handle of another person → 404; into an existing person works
    expect((await api.post(`/api/people/${w.b.id}/split`, { handleId: w.hA.id })).status).toBe(404)
    const into = await api.post(`/api/people/${w.a.id}/split`, { handleId: w.hAp.id, into: { personId: w.c.id } })
    expect(into.body.person.id).toBe(w.c.id)
    expect((await api.post(`/api/people/${w.c.id}/split`, { handleId: w.hAp.id, into: { newPerson: { label: '新人' } } })).body.person.label).toBe('新人')
  })

  it('manual add: claim (confirmed, manual, mentions), date, relation, event; validation', async () => {
    const c = await api.post(`/api/people/${w.b.id}/claims`, { statement: '和顾清禾是大学同学', category: 'education', validFrom: '2015' })
    expect(c.status).toBe(201)
    expect(c.body.claim).toMatchObject({ status: 'confirmed', sourceKind: 'manual', confidence: null, importId: null, evidenceCount: 0, validFrom: '2015', mentions: [{ id: w.c.id, label: '顾清禾' }] })
    const ev = await api.get(`/api/evidence/claim/${c.body.claim.id}`)
    expect(ev.body).toMatchObject({ sourceKind: 'manual', items: [] })
    expect(ev.body.manualAddedAt).toBe(c.body.claim.createdAt)

    const d = await api.post(`/api/people/${w.b.id}/dates`, { kind: 'birthday', month: 6, day: 18, calendar: 'lunar', isLeapMonth: true })
    expect(d.status).toBe(201)
    expect(d.body.date).toMatchObject({ calendar: 'lunar', isLeapMonth: true, status: 'confirmed', sourceKind: 'manual' })
    expect(d.body.date.next.days).toBeGreaterThanOrEqual(0)
    expect((await api.post(`/api/people/${w.b.id}/dates`, { kind: 'birthday', month: 4, day: 31, calendar: 'solar' })).status).toBe(400)

    const rel = await api.post(`/api/people/${w.b.id}/relations`, { toPersonId: w.c.id, type: 'classmate', label: '同学' })
    expect(rel.status).toBe(201)
    expect(rel.body.relation).toMatchObject({ from: { id: w.b.id }, to: { id: w.c.id, label: '顾清禾' }, status: 'confirmed', sourceKind: 'manual' })
    expect((await api.post(`/api/people/${w.b.id}/relations`, { toPersonId: w.b.id, type: 'friend' })).status).toBe(400)

    const e = await api.post(`/api/people/${w.b.id}/events`, { summary: '一起毕业旅行', happenedAt: '2019-07', participantIds: [w.c.id, w.b.id] })
    expect(e.status).toBe(201)
    expect(e.body.event.participants.map((p: Json) => p.id).sort()).toEqual([w.b.id, w.c.id].sort())
    expect((await api.post(`/api/people/${w.b.id}/events`, { summary: 'x', participantIds: [999999] })).status).toBe(404)

    const created = await db.select().from(reviewLog).where(owned(reviewLog, uid, eq(reviewLog.action, 'edit')))
    expect(created.filter((l) => l.before === null)).toHaveLength(4)
    // merged persons cannot receive items
    await api.post(`/api/people/${w.c.id}/merge`, { intoId: w.a.id })
    expect((await api.post(`/api/people/${w.c.id}/claims`, { statement: '测试', category: 'other' })).status).toBe(409)
  })

  it('owner isolation: another account gets 404 on every id route and cannot touch the data', async () => {
    const bob = (await createTestUser(db, `bob${Math.random()}@xiaoli.test`)).id
    const bw = await seedWorld(db, bob, 'bob')
    const b = client(db, bob)
    const results = await Promise.all([
      b.get(`/api/evidence/claim/${w.newWork.id}`),
      b.get(`/api/imports/${w.imp.id}/review`),
      b.post(`/api/review/claim/${w.newWork.id}`, { action: 'accept' }),
      b.post(`/api/review/claim/${w.newWork.id}`, { action: 'delete' }),
      b.post(`/api/review/handle/${w.hB.id}`, { action: 'edit', patch: { value: 'x' } }),
      b.post(`/api/people/${w.b.id}/merge`, { intoId: bw.a.id }),
      b.post(`/api/people/${bw.b.id}/merge`, { intoId: w.a.id }),
      b.post(`/api/people/${w.b.id}/split`, { handleId: w.hB.id }),
      b.post(`/api/people/${bw.b.id}/split`, { handleId: w.hB.id }),
      b.post(`/api/people/${w.b.id}/claims`, { statement: '越权', category: 'other' }),
      b.post(`/api/people/${w.b.id}/dates`, { kind: 'birthday', month: 1, day: 1, calendar: 'solar' }),
      b.post(`/api/people/${bw.b.id}/relations`, { toPersonId: w.a.id, type: 'friend' }),
      b.post(`/api/people/${bw.b.id}/events`, { summary: '越权', participantIds: [w.a.id] }),
    ])
    expect(results.map((r) => r.status)).toEqual(Array(results.length).fill(404))
    const bulk = await b.post('/api/review/bulk', { action: 'reject', items: [{ type: 'claim', id: w.b1.id }] })
    expect(bulk.body).toEqual({ updated: 0, failed: [{ type: 'claim', id: w.b1.id, code: 'not_found' }] })
    // alice's data unchanged
    expect((await db.select().from(claims).where(owned(claims, uid, eq(claims.id, w.newWork.id))).get())!.status).toBe('proposed')
    expect((await db.select().from(claims).where(owned(claims, uid, eq(claims.id, w.b1.id))).get())!.status).toBe('proposed')
    expect(await db.select().from(reviewLog).where(owned(reviewLog, uid))).toEqual([])
    // unauthenticated → 401
    const { createTestApp } = await import('@/tests/helpers/test-db')
    const anon = createTestApp({ db, userId: null })
    expect((await anon.request(`/api/evidence/claim/${w.b1.id}`)).status).toBe(401)
  })
})
