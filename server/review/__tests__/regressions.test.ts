// Regressions from the round-1 critic: evidence segments, D1 bound-param cap, bulk supersede order,
// undo of pre-inserted rows when a batch fails, import review with person-less handles.
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claimMentions,
  claims,
  eventParticipants,
  events,
  evidence,
  handles,
  imports,
  owned,
  persons,
  reviewLog,
  withOwner,
  withOwnerLink,
  type Db,
} from '@/server/db'
import { addEvent, applyReview, splitHandle } from '@/server/review'
import { createTestDb, createTestUser } from '@/tests/helpers/test-db'
import { client, seedWorld, type Json, type World } from './fixtures'

describe('review regressions (round 2)', () => {
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
    vi.restoreAllMocks()
    uid = (await createTestUser(db, `r${Math.random()}@xiaoli.test`)).id
    w = await seedWorld(db, uid)
    api = client(db, uid)
  })

  const seqs = (body: Json) => (body.items as Json[]).map((s) => s.messages.map((m: Json) => m.seq / 1024))
  const addEv = (claimId: number, messageId: number) => db.insert(evidence).values(withOwnerLink<typeof evidence>(uid, { targetType: 'claim', targetId: claimId, messageId }))
  const newPerson = async (label: string) =>
    (await db.insert(persons).values(withOwner<typeof persons>(uid, { label, labelSort: label, isSelf: false, pinned: false, mergedIntoId: null, importId: null })).returning())[0]

  it('evidence: far-apart evidence in one chat stays in separate segments, each with its own link target', async () => {
    // b1: group #1 and #10 → [1..3] and [8..10]
    await addEv(w.b1.id, w.g[9].id)
    const r1 = await api.get(`/api/evidence/claim/${w.b1.id}`)
    expect(seqs(r1.body)).toEqual([
      [1, 2, 3],
      [8, 9, 10],
    ])
    expect((r1.body.items as Json[]).map((s) => s.messageId)).toEqual([w.g[0].id, w.g[9].id])
    // b2: group #4 and #10 → [2..6] and [8..10] (#7 lies between the windows); segments are in time order and the
    // fixture's #10 (2026-09-03) is earlier than #4 (2026-09-05)
    await addEv(w.b2.id, w.g[9].id)
    expect(seqs((await api.get(`/api/evidence/claim/${w.b2.id}`)).body)).toEqual([
      [8, 9, 10],
      [2, 3, 4, 5, 6],
    ])
    // #4 and #9: windows [2..6] and [7..10] are next to each other in the chat → one segment
    await addEv(w.bSensitive.id, w.g[3].id)
    await addEv(w.bSensitive.id, w.g[8].id)
    await db.delete(evidence).where(owned(evidence, uid, eq(evidence.targetType, 'claim'), eq(evidence.targetId, w.bSensitive.id), eq(evidence.messageId, w.g[6].id)))
    expect(seqs((await api.get(`/api/evidence/claim/${w.bSensitive.id}`)).body)).toEqual([[2, 3, 4, 5, 6, 7, 8, 9, 10]])
    // context 0: #1 and #10 are separate; overlapping windows still merge without repeats
    expect(seqs((await api.get(`/api/evidence/claim/${w.b1.id}?context=0`)).body)).toEqual([[1], [10]])
    await addEv(w.b1.id, w.g[1].id)
    expect(seqs((await api.get(`/api/evidence/claim/${w.b1.id}`)).body)).toEqual([
      [1, 2, 3, 4],
      [8, 9, 10],
    ])
    expect(seqs((await api.get(`/api/evidence/claim/${w.b1.id}?context=0`)).body)).toEqual([[1, 2], [10]])
  })

  it('merge of a person in 30 events and mentioned in 30 claims (D1 100-param cap)', async () => {
    const eventIds: number[] = []
    for (let i = 0; i < 30; i++) {
      const [e] = await db.insert(events).values(withOwner<typeof events>(uid, { summary: `事件${i}`, happenedAt: null, place: null, status: 'confirmed', importId: null, sourceKind: 'manual' })).returning()
      eventIds.push(e.id)
      await db.insert(eventParticipants).values(withOwnerLink<typeof eventParticipants>(uid, { eventId: e.id, personId: w.c.id }))
      const [cl] = await db
        .insert(claims)
        .values(withOwner<typeof claims>(uid, { personId: w.a.id, statement: `和顾清禾${i}`, statementNorm: `和顾清禾${i}`, category: 'other', validFrom: null, validTo: null, learnedAt: '2026-09-01T00:00:00.000Z', confidence: null, sensitive: false, status: 'confirmed', statusReason: null, statusChangedAt: '2026-09-01T00:00:00.000Z', supersedesClaimId: null, supersededByClaimId: null, importId: null, jobId: null, sourceKind: 'manual' }))
        .returning()
      await db.insert(claimMentions).values(withOwnerLink<typeof claimMentions>(uid, { claimId: cl.id, personId: w.c.id }))
    }
    const r = await api.post(`/api/people/${w.c.id}/merge`, { intoId: w.b.id })
    expect(r.status).toBe(200)
    expect(r.body.moved.event).toBe(30)
    expect(await db.select().from(eventParticipants).where(owned(eventParticipants, uid, eq(eventParticipants.personId, w.c.id)))).toHaveLength(0)
    expect(await db.select().from(eventParticipants).where(owned(eventParticipants, uid, eq(eventParticipants.personId, w.b.id)))).toHaveLength(31)
    expect(await db.select().from(claimMentions).where(owned(claimMentions, uid, eq(claimMentions.personId, w.c.id)))).toHaveLength(0)
    expect(await db.select().from(claimMentions).where(owned(claimMentions, uid, eq(claimMentions.personId, w.b.id)))).toHaveLength(30)
    expect((await db.select().from(persons).where(owned(persons, uid, eq(persons.id, w.c.id))).get())!.mergedIntoId).toBe(w.b.id)
  })

  it('manual event with 30 participants (D1 100-param cap)', async () => {
    const ids: number[] = []
    for (let i = 0; i < 30; i++) ids.push((await newPerson(`人物${i}`)).id)
    const r = await api.post(`/api/people/${w.a.id}/events`, { summary: '大聚会', participantIds: ids })
    expect(r.status).toBe(201)
    expect(await db.select().from(eventParticipants).where(owned(eventParticipants, uid, eq(eventParticipants.eventId, r.body.event?.id ?? r.body.id)))).toHaveLength(31)
  })

  it('bulk accept with the replacement listed before the claim it replaces: old ends superseded, reported as conflict', async () => {
    await db.update(claims).set({ status: 'proposed' }).where(owned(claims, uid, eq(claims.id, w.oldWork.id)))
    const r = await api.post('/api/review/bulk', { action: 'accept', items: [{ type: 'claim', id: w.newWork.id }, { type: 'claim', id: w.oldWork.id }] })
    expect(r.body).toEqual({ updated: 1, failed: [{ type: 'claim', id: w.oldWork.id, code: 'conflict' }] })
    const old = await db.select().from(claims).where(owned(claims, uid, eq(claims.id, w.oldWork.id))).get()
    expect(old).toMatchObject({ status: 'superseded', supersededByClaimId: w.newWork.id })
    expect((await db.select().from(claims).where(owned(claims, uid, eq(claims.id, w.newWork.id))).get())!.status).toBe('confirmed')
  })

  it('bulk accept with the old claim listed first: old confirmed then superseded in order', async () => {
    await db.update(claims).set({ status: 'proposed' }).where(owned(claims, uid, eq(claims.id, w.oldWork.id)))
    const r = await api.post('/api/review/bulk', { action: 'accept', items: [{ type: 'claim', id: w.oldWork.id }, { type: 'claim', id: w.newWork.id }] })
    expect(r.body).toEqual({ updated: 2, failed: [] })
    expect((await db.select().from(claims).where(owned(claims, uid, eq(claims.id, w.oldWork.id))).get())).toMatchObject({ status: 'superseded', supersededByClaimId: w.newWork.id })
  })

  it('bulk reject of a confirmed replacement then reject of the restored claim: both rejected, no stale restore', async () => {
    await api.post(`/api/review/claim/${w.newWork.id}`, { action: 'accept' })
    const r = await api.post('/api/review/bulk', { action: 'reject', items: [{ type: 'claim', id: w.newWork.id }, { type: 'claim', id: w.oldWork.id }] })
    expect(r.body).toEqual({ updated: 2, failed: [] })
    expect((await db.select().from(claims).where(owned(claims, uid, eq(claims.id, w.oldWork.id))).get())!.status).toBe('rejected')
  })

  it('a failing batch leaves no pre-inserted rows: split, edit of a confirmed claim, supersede with replacement, manual event', async () => {
    const count = async () => ({
      persons: (await db.select().from(persons).where(eq(persons.ownerId, uid))).length,
      claims: (await db.select().from(claims).where(eq(claims.ownerId, uid))).length,
      events: (await db.select().from(events).where(eq(events.ownerId, uid))).length,
      participants: (await db.select().from(eventParticipants).where(eq(eventParticipants.ownerId, uid))).length,
      evidence: (await db.select().from(evidence).where(eq(evidence.ownerId, uid))).length,
      mentions: (await db.select().from(claimMentions).where(eq(claimMentions.ownerId, uid))).length,
      logs: (await db.select().from(reviewLog).where(eq(reviewLog.ownerId, uid))).length,
    })
    const before = await count()
    const fail = () => vi.spyOn(db, 'batch').mockRejectedValueOnce(new Error('D1_ERROR: forced'))

    fail()
    await expect(splitHandle(db, uid, w.b.id, w.hB.id)).rejects.toThrow('forced')
    const h = await db.select().from(handles).where(eq(handles.id, w.hB.id)).get()
    expect(h!.personId).toBe(w.b.id)

    fail()
    await expect(applyReview(db, uid, { type: 'claim', id: w.oldWork.id }, 'edit', { statement: '在苏州做审计' })).rejects.toThrow('forced')
    expect((await db.select().from(claims).where(eq(claims.id, w.oldWork.id)).get())).toMatchObject({ status: 'confirmed', supersededByClaimId: null })

    fail()
    await expect(applyReview(db, uid, { type: 'claim', id: w.manual.id }, 'supersede', undefined, { replacement: { statement: '养了两只猫' } })).rejects.toThrow('forced')
    expect((await db.select().from(claims).where(eq(claims.id, w.manual.id)).get())).toMatchObject({ status: 'confirmed', validTo: null })

    fail()
    await expect(addEvent(db, uid, w.a.id, { summary: '聚餐', participantIds: [w.b.id] })).rejects.toThrow('forced')

    expect(await count()).toEqual(before)
  })

  it('import review: a proposed ai handle without a person does not keep allHandled false', async () => {
    const [imp] = await db
      .insert(imports)
      .values(withOwner<typeof imports>(uid, { chatId: w.group.id, fileName: 'h.zip', fileSha256: `h-${Math.random()}`, exportedAt: null, parserVersion: 't', status: 'reviewing', messageCount: 0, newMessageCount: 0, dateFrom: null, dateTo: null, stats: { byKind: {}, bySender: {}, images: { count: 0, bytes: 0 }, videos: { count: 0, bytes: 0 } }, error: null }))
      .returning()
    await db.insert(handles).values(withOwner<typeof handles>(uid, { personId: null, kind: 'mentioned', value: '无主别名', valueNorm: '无主别名', chatId: w.group.id, status: 'proposed', importId: imp.id, sourceKind: 'ai' }))
    const r = await api.get(`/api/imports/${imp.id}/review`)
    expect(r.body).toMatchObject({ sections: [], empty: true, allHandled: true })
  })
})
