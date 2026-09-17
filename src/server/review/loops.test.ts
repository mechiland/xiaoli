// Review of 未结事项 (SPEC §7 交互层, §9.9): loop accept/reject/edit/delete, the import-review 未结事项 group,
// merge, and the fact that a 段落摘要 is not reviewable at all.
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { conversationSegments, evidence, loops, owned, persons, reviewLog, segmentParticipants, type Db } from '@/server/db'
import { applyReview } from '@/server/review'
import { deriveLoop, dueDay } from '@/server/review/loops'
import { createTestDb, createTestUser } from '~/tests/helpers/test-db'
import { client, seedInteraction, seedWorld, type InteractionWorld, type World } from './test-fixtures'

describe('loop derivation (pure)', () => {
  const open = { dueAt: null, openedAt: '2026-06-01 10:00', closedMessageId: null, closedAt: null, closedReason: null } as const

  it('state comes from the close event, never from a column', () => {
    expect(deriveLoop(open, '2026-06-10')).toMatchObject({ state: 'open', daysOpen: 9 })
    // closed by a message
    expect(deriveLoop({ ...open, closedMessageId: 7, closedAt: '2026-06-05 09:00', closedReason: 'done' }, '2026-06-10')).toMatchObject({
      state: 'done',
      expired: false,
      daysOpen: 4,
    })
    // closed by hand ("不用管"): no message, only a reason
    expect(deriveLoop({ ...open, closedAt: '2026-06-07T00:00:00.000Z', closedReason: 'dropped' }, '2026-06-10')).toMatchObject({ state: 'dropped', daysOpen: 6 })
    // a close event with no reason recorded is still closed
    expect(deriveLoop({ ...open, closedMessageId: 7, closedAt: '2026-06-05 09:00' }, '2026-06-10').state).toBe('done')
  })

  it('expires 14 days past dueAt, or 90 days after opening when there is no dueAt', () => {
    expect(deriveLoop({ ...open, dueAt: '2026-06-01' }, '2026-06-15').expired).toBe(false)
    expect(deriveLoop({ ...open, dueAt: '2026-06-01' }, '2026-06-16').expired).toBe(true)
    expect(deriveLoop(open, '2026-08-30').expired).toBe(false)
    expect(deriveLoop(open, '2026-08-31').expired).toBe(true)
    // a closed loop is never "expired", however old it is
    expect(deriveLoop({ ...open, closedMessageId: 1, closedReason: 'done', closedAt: '2026-06-02 08:00' }, '2027-01-01').expired).toBe(false)
    // a partial dueAt means the last day it can stand for
    expect(dueDay('2026-02')).toBe('2026-02-28')
    expect(dueDay('2026')).toBe('2026-12-31')
    expect(deriveLoop({ ...open, dueAt: '2026-06' }, '2026-07-14').expired).toBe(false)
    expect(deriveLoop({ ...open, dueAt: '2026-06' }, '2026-07-15').expired).toBe(true)
  })

  it('daysOpen is never negative', () => {
    expect(deriveLoop(open, '2026-05-01').daysOpen).toBe(0)
  })
})

describe('review of loops and segments', () => {
  let db: Db
  let dispose: () => Promise<void>
  let uid: string
  let w: World
  let iw: InteractionWorld
  let api: ReturnType<typeof client>

  beforeAll(async () => {
    const t = await createTestDb()
    db = t.db
    dispose = t.dispose
  })
  afterAll(async () => dispose?.())
  beforeEach(async () => {
    uid = (await createTestUser(db, `l${Math.random()}@xiaoli.test`)).id
    w = await seedWorld(db, uid)
    iw = await seedInteraction(db, uid, w)
    api = client(db, uid)
  })

  const loopRow = (id: number) => db.select().from(loops).where(owned(loops, uid, eq(loops.id, id))).get()
  const logs = async (targetType: string, targetId: number) =>
    (await db.select().from(reviewLog).where(owned(reviewLog, uid, eq(reviewLog.targetId, targetId)))).filter((r) => r.targetType === targetType)

  it('accept confirms the loop, writes a review_log row and returns the derived DTO', async () => {
    const r = await api.post(`/api/review/loop/${iw.question.id}`, { action: 'accept' })
    expect(r.status).toBe(200)
    expect(r.body.item).toMatchObject({
      id: iw.question.id,
      personId: w.b.id,
      kind: 'question',
      direction: 'theirs',
      status: 'confirmed',
      state: 'open',
      evidenceCount: 1,
    })
    // derived at read time, so only the shape is asserted here; the rules themselves are covered above
    expect(typeof r.body.item.daysOpen).toBe('number')
    expect(r.body.item.daysOpen).toBeGreaterThanOrEqual(0)
    expect(typeof r.body.item.expired).toBe('boolean')
    expect((await loopRow(iw.question.id))!.status).toBe('confirmed')
    expect(await logs('loop', iw.question.id)).toMatchObject([{ action: 'accept', after: { status: 'confirmed' } }])
  })

  it('a closed loop reports state done and is not expired', async () => {
    const r = await api.post(`/api/review/loop/${iw.closed.id}`, { action: 'accept' })
    expect(r.body.item).toMatchObject({ state: 'done', closedReason: 'done', expired: false })
  })

  it('reject marks it rejected; accepting again flips it back', async () => {
    expect((await api.post(`/api/review/loop/${iw.plan.id}`, { action: 'reject' })).body.item.status).toBe('rejected')
    expect((await loopRow(iw.plan.id))!.status).toBe('rejected')
    expect((await api.post(`/api/review/loop/${iw.plan.id}`, { action: 'accept' })).body.item.status).toBe('confirmed')
  })

  it('edit rewrites text/dueAt/kind/direction and confirms, with the old values in review_log', async () => {
    const res = await applyReview(db, uid, { type: 'loop', id: iw.plan.id }, 'edit', {
      text: '  约好十月三号一起去爬山  ',
      dueAt: '2026-10-03',
      kind: 'plan',
      direction: 'mine',
    })
    expect(res.item).toMatchObject({ text: '约好十月三号一起去爬山', dueAt: '2026-10-03', direction: 'mine', status: 'confirmed' })
    const row = (await loopRow(iw.plan.id))!
    expect(row).toMatchObject({ text: '约好十月三号一起去爬山', textNorm: '约好十月三号一起去爬山', dueAt: '2026-10-03', direction: 'mine' })
    expect(await logs('loop', iw.plan.id)).toMatchObject([
      { action: 'edit', before: { text: '约好十月一起去爬山', dueAt: '2026-10-01', direction: 'mutual' }, after: { dueAt: '2026-10-03' } },
    ])
    // clearing the due date is a real edit, not "nothing to change"
    await applyReview(db, uid, { type: 'loop', id: iw.plan.id }, 'edit', { dueAt: null })
    expect((await loopRow(iw.plan.id))!.dueAt).toBeNull()
    await expect(applyReview(db, uid, { type: 'loop', id: iw.plan.id }, 'edit', {})).rejects.toMatchObject({ status: 400 })
  })

  it('edit over HTTP carries the loop patch through the route validator', async () => {
    const r = await api.post(`/api/review/loop/${iw.question.id}`, {
      action: 'edit',
      patch: { text: '她问你国庆有没有空', kind: 'promise', direction: 'mine' },
    })
    expect(r.status).toBe(200)
    expect(r.body.item).toMatchObject({ text: '她问你国庆有没有空', kind: 'promise', direction: 'mine', status: 'confirmed', state: 'open' })
    expect(await loopRow(iw.question.id)).toMatchObject({ text: '她问你国庆有没有空', textNorm: '她问你国庆有没有空', kind: 'promise' })
    // null clears the due date; an empty patch is still 400
    expect((await api.post(`/api/review/loop/${iw.plan.id}`, { action: 'edit', patch: { dueAt: null } })).status).toBe(200)
    expect((await loopRow(iw.plan.id))!.dueAt).toBeNull()
    expect((await api.post(`/api/review/loop/${iw.plan.id}`, { action: 'edit', patch: {} })).status).toBe(400)
    // supersede stays claims-only
    expect((await api.post(`/api/review/loop/${iw.plan.id}`, { action: 'supersede' })).status).toBe(400)
  })

  it('delete removes the loop and its evidence and keeps the before snapshot in review_log', async () => {
    const r = await api.post(`/api/review/loop/${iw.question.id}`, { action: 'delete' })
    expect(r.status).toBe(200)
    expect(r.body.item.id).toBe(iw.question.id)
    expect(await loopRow(iw.question.id)).toBeUndefined()
    expect((await db.select().from(evidence).where(owned(evidence, uid, eq(evidence.targetType, 'loop'), eq(evidence.targetId, iw.question.id)))).length).toBe(0)
    expect(await logs('loop', iw.question.id)).toMatchObject([{ action: 'delete', before: { text: '她问你国庆有没有空，你没回' }, after: null }])
  })

  it('bulk accept works for loops and reports segments as not reviewable', async () => {
    const r = await api.post('/api/review/bulk', {
      items: [
        { type: 'loop', id: iw.question.id },
        { type: 'loop', id: iw.plan.id },
        { type: 'segment', id: iw.segment.id },
      ],
      action: 'accept',
    })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ updated: 2, failed: [{ type: 'segment', id: iw.segment.id, code: 'validation_failed' }] })
    expect((await loopRow(iw.question.id))!.status).toBe('confirmed')
  })

  it('a segment is a log, not an assertion: every review action on it is a 400', async () => {
    for (const action of ['accept', 'reject', 'edit', 'delete'] as const) {
      const r = await api.post(`/api/review/segment/${iw.segment.id}`, { action, ...(action === 'edit' ? { patch: { summary: '改一下' } } : {}) })
      expect(r.status, action).toBe(400)
    }
    // and nothing happened to it
    expect((await db.select().from(conversationSegments).where(owned(conversationSegments, uid, eq(conversationSegments.id, iw.segment.id)))).length).toBe(1)
  })

  it('GET /api/evidence/loop/:id returns the original message', async () => {
    const r = await api.get(`/api/evidence/loop/${iw.question.id}`)
    expect(r.status).toBe(200)
    expect(r.body.target).toEqual({ type: 'loop', id: iw.question.id })
    expect(r.body.items.length).toBe(1)
    expect(r.body.items[0].messages.some((m: { isEvidence: boolean }) => m.isEvidence)).toBe(true)
  })

  it('the import review has a 未结事项 group per person that counts but never joins 可信度高', async () => {
    const r = await api.get(`/api/imports/${w.imp.id}/review`)
    expect(r.status).toBe(200)
    const sectionOf = (personId: number) => r.body.sections.find((s: { person: { id: number } }) => s.person.id === personId)
    expect(sectionOf(w.b.id).loops.map((x: { type: string; item: { id: number } }) => [x.type, x.item.id])).toEqual([
      ['loop', iw.question.id],
      ['loop', iw.closed.id],
    ])
    expect(sectionOf(w.a.id).loops.map((x: { item: { id: number } }) => x.item.id)).toEqual([iw.plan.id])
    // loops have no confidence, so they are never proposed for "确认所有可信度高的条目" (DECISIONS A6)
    expect(r.body.highConfidence.every((h: { type: string }) => h.type === 'claim')).toBe(true)
    // they do count: the section's newCount includes them and allHandled stays false while one is proposed
    const before = sectionOf(w.a.id).newCount
    expect(r.body.allHandled).toBe(false)
    await api.post(`/api/review/loop/${iw.plan.id}`, { action: 'accept' })
    const after = await api.get(`/api/imports/${w.imp.id}/review`)
    expect(after.body.sections.find((s: { person: { id: number } }) => s.person.id === w.a.id).newCount).toBe(before)
    // handling every remaining item (loops included) flips allHandled
    const ids = after.body.sections.flatMap((s: { newClaims: []; changes: []; aliasesAndRelations: []; dates: []; events: []; loops: [] }) =>
      [...s.newClaims, ...s.changes, ...s.aliasesAndRelations, ...s.dates, ...s.events, ...s.loops].map((x: { type: string; item: { id: number } }) => ({
        type: x.type,
        id: x.item.id,
      })),
    )
    await api.post('/api/review/bulk', { items: ids, action: 'accept' })
    expect((await api.get(`/api/imports/${w.imp.id}/review`)).body.allHandled).toBe(true)
  })

  it('merge moves loops and folds segment_participants, summing message_count on a collision', async () => {
    const r = await api.post(`/api/people/${w.b.id}/merge`, { intoId: w.a.id })
    expect(r.status).toBe(200)
    expect(r.body.moved).toMatchObject({ loop: 2, segment: 1 })
    expect((await db.select().from(loops).where(owned(loops, uid, eq(loops.personId, w.b.id)))).length).toBe(0)
    expect((await db.select().from(loops).where(owned(loops, uid, eq(loops.personId, w.a.id)))).length).toBe(3)
    const parts = await db.select().from(segmentParticipants).where(owned(segmentParticipants, uid, eq(segmentParticipants.segmentId, iw.segment.id)))
    expect(parts.length).toBe(1)
    expect(parts[0]).toMatchObject({ personId: w.a.id, messageCount: 5 }) // 2 (周以宁) + 3 (陈嘉树)
    expect(await logs('loop', iw.question.id)).toMatchObject([{ action: 'merge', after: { personId: w.a.id } }])
  })

  it('merge into a person who is not in the segment just moves the row', async () => {
    const r = await api.post(`/api/people/${w.b.id}/merge`, { intoId: w.c.id })
    expect(r.status).toBe(200)
    const parts = await db.select().from(segmentParticipants).where(owned(segmentParticipants, uid, eq(segmentParticipants.segmentId, iw.segment.id)))
    expect(parts.map((p) => [p.personId, p.messageCount]).sort()).toEqual(
      [
        [w.a.id, 2],
        [w.c.id, 3],
      ].sort(),
    )
  })

  it('two accounts: another user cannot read, review or merge away my loops and segments', async () => {
    const bob = await createTestUser(db, `lb${Math.random()}@xiaoli.test`)
    const bw = await seedWorld(db, bob.id, 'bob')
    const bi = await seedInteraction(db, bob.id, bw)
    const asBob = client(db, bob.id)

    for (const url of [`/api/review/loop/${iw.question.id}`, `/api/review/loop/${iw.plan.id}`]) {
      expect((await asBob.post(url, { action: 'accept' })).status).toBe(404)
    }
    expect((await asBob.get(`/api/evidence/loop/${iw.question.id}`)).status).toBe(404)
    expect((await asBob.get(`/api/imports/${w.imp.id}/review`)).status).toBe(404)
    expect((await asBob.post(`/api/people/${w.b.id}/merge`, { intoId: bw.a.id })).status).toBe(404)
    await expect(applyReview(db, bob.id, { type: 'loop', id: iw.plan.id }, 'edit', { text: '别人的' })).rejects.toMatchObject({ status: 404 })
    // alice's rows are untouched, bob's own review still only sees his own
    expect((await loopRow(iw.question.id))!.status).toBe('proposed')
    const bobReview = await asBob.get(`/api/imports/${bw.imp.id}/review`)
    const bobLoopIds = bobReview.body.sections.flatMap((s: { loops: { item: { id: number } }[] }) => s.loops.map((x) => x.item.id))
    expect(bobLoopIds.sort()).toEqual([bi.question.id, bi.plan.id, bi.closed.id].sort())
    // and bob's merge only folds his own participants
    await asBob.post(`/api/people/${bw.b.id}/merge`, { intoId: bw.a.id })
    expect(
      (await db.select().from(segmentParticipants).where(owned(segmentParticipants, uid, eq(segmentParticipants.segmentId, iw.segment.id)))).length,
    ).toBe(2)
    expect((await db.select().from(persons).where(owned(persons, uid, eq(persons.id, w.b.id)))).at(0)!.mergedIntoId).toBeNull()
  })
})
