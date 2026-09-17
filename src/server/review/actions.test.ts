import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { todayInTz } from '@/lib/time'
import { claimMentions, claims, evidence, handles, imports, messages, owned, reviewLog, type Db } from '@/server/db'
import { createTestDb, createTestUser } from '~/tests/helpers/test-db'
import { client, seedWorld, type World } from './test-fixtures'

describe('review actions: POST /api/review/:type/:id and /api/review/bulk', () => {
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
    uid = (await createTestUser(db, `u${Math.random()}@xiaoli.test`)).id
    w = await seedWorld(db, uid)
    api = client(db, uid)
  })

  const claimRow = (id: number) => db.select().from(claims).where(owned(claims, uid, eq(claims.id, id))).get()
  const logs = (targetType: string, targetId: number) =>
    db.select().from(reviewLog).where(owned(reviewLog, uid, and(eq(reviewLog.targetType, targetType as 'claim'), eq(reviewLog.targetId, targetId))))

  it('accept confirms and supersedes the replaced claim (supersede on confirm), with reviewLog rows', async () => {
    const r = await api.post(`/api/review/claim/${w.newWork.id}`, { action: 'accept' })
    expect(r.status).toBe(200)
    expect(r.body.item).toMatchObject({ id: w.newWork.id, status: 'confirmed', evidenceCount: 3 })
    expect(r.body.superseded).toHaveLength(1)
    expect(r.body.superseded[0]).toMatchObject({ id: w.oldWork.id, status: 'superseded', statusReason: 'superseded', supersededByClaimId: w.newWork.id })
    expect((await logs('claim', w.newWork.id)).map((l) => l.action)).toEqual(['accept'])
    const oldLogs = await logs('claim', w.oldWork.id)
    expect(oldLogs.map((l) => l.action)).toEqual(['supersede'])
    expect(oldLogs[0].before).toEqual({ status: 'confirmed' })
    // idempotent: accepting again changes nothing and writes no log
    await api.post(`/api/review/claim/${w.newWork.id}`, { action: 'accept' })
    expect(await logs('claim', w.newWork.id)).toHaveLength(1)
  })

  it('reject of an accepted replacement restores the claim it had superseded', async () => {
    await api.post(`/api/review/claim/${w.newWork.id}`, { action: 'accept' })
    const r = await api.post(`/api/review/claim/${w.newWork.id}`, { action: 'reject' })
    expect(r.body.item.status).toBe('rejected')
    expect(await claimRow(w.oldWork.id)).toMatchObject({ status: 'confirmed', statusReason: null, supersededByClaimId: null })
    expect((await logs('claim', w.newWork.id)).map((l) => l.action)).toEqual(['accept', 'reject'])
  })

  it('reject of a proposed item; superseded items are read-only (409)', async () => {
    const r = await api.post(`/api/review/relation/${w.rel.id}`, { action: 'reject' })
    expect(r.body.item).toMatchObject({ status: 'rejected', from: { id: w.b.id, label: '陈嘉树' }, to: { id: w.a.id } })
    await api.post(`/api/review/claim/${w.newWork.id}`, { action: 'accept' })
    const conflict = await api.post(`/api/review/claim/${w.oldWork.id}`, { action: 'accept' })
    expect(conflict.status).toBe(409)
    expect(conflict.body.error.code).toBe('conflict')
  })

  it('edit of a proposed claim updates in place and confirms; reviewLog keeps before', async () => {
    const r = await api.post(`/api/review/claim/${w.b2.id}`, { action: 'edit', patch: { statement: '在读博士，常和周以宁讨论', category: 'education' } })
    expect(r.status).toBe(200)
    expect(r.body.item).toMatchObject({ id: w.b2.id, statement: '在读博士，常和周以宁讨论', status: 'confirmed' })
    expect(r.body.item.mentions).toEqual([{ id: w.a.id, label: '周以宁' }])
    const [log] = await logs('claim', w.b2.id)
    expect(log.action).toBe('edit')
    expect(log.before).toMatchObject({ statement: '在读研究生', status: 'proposed' })
    // statement_norm is NFKC: the full-width comma folds to ','
    expect((await claimRow(w.b2.id))!.statementNorm).toBe('在读博士,常和周以宁讨论')
  })

  it('edit of a proposed replacement confirms it and supersedes the old claim', async () => {
    const r = await api.post(`/api/review/claim/${w.newWork.id}`, { action: 'edit', patch: { statement: '在杭州一家动画公司做制片' } })
    expect(r.body.item.status).toBe('confirmed')
    expect(r.body.superseded?.[0]?.id).toBe(w.oldWork.id)
  })

  it('edit of a confirmed claim creates a new confirmed row, the original goes to history (edited), evidence copied', async () => {
    await api.post(`/api/review/claim/${w.newWork.id}`, { action: 'accept' })
    const r = await api.post(`/api/review/claim/${w.newWork.id}`, { action: 'edit', patch: { statement: '在杭州做动画制片' } })
    expect(r.status).toBe(200)
    const newId = r.body.item.id
    expect(newId).not.toBe(w.newWork.id)
    expect(r.body.item).toMatchObject({ statement: '在杭州做动画制片', status: 'confirmed', supersedesClaimId: w.newWork.id, evidenceCount: 3, importId: w.imp.id })
    expect(r.body.superseded[0]).toMatchObject({ id: w.newWork.id, status: 'superseded', statusReason: 'edited', supersededByClaimId: newId })
    // chain: old → newWork → edited
    expect(await claimRow(w.oldWork.id)).toMatchObject({ status: 'superseded', supersededByClaimId: w.newWork.id })
  })

  it('edit without changes → 400; edit of handle/relation/event/date', async () => {
    expect((await api.post(`/api/review/claim/${w.b1.id}`, { action: 'edit', patch: {} })).status).toBe(400)
    const h = await api.post(`/api/review/handle/${w.hBmention.id}`, { action: 'edit', patch: { value: '嘉树哥' } })
    expect(h.body.item).toMatchObject({ value: '嘉树哥', status: 'confirmed', chatTitle: '测试群x', evidenceCount: 1 })
    const clash = await api.post(`/api/review/handle/${w.hBmention.id}`, { action: 'edit', patch: { value: '嘉树哥' } })
    expect(clash.status).toBe(200) // same row, same value → no clash
    const rel = await api.post(`/api/review/relation/${w.rel.id}`, { action: 'edit', patch: { type: 'colleague', label: '同事' } })
    expect(rel.body.item).toMatchObject({ type: 'colleague', label: '同事', status: 'confirmed' })
    const evt = await api.post(`/api/review/event/${w.evt.id}`, { action: 'edit', patch: { summary: '一起去爬了黄山', place: '黄山' } })
    expect(evt.body.item).toMatchObject({ summary: '一起去爬了黄山', place: '黄山', status: 'confirmed' })
    expect(evt.body.item.participants.map((p: { id: number }) => p.id).sort()).toEqual([w.a.id, w.b.id].sort())
    const bad = await api.post(`/api/review/date/${w.date.id}`, { action: 'edit', patch: { month: 2, day: 30 } })
    expect(bad.status).toBe(400)
    const d = await api.post(`/api/review/date/${w.date.id}`, { action: 'edit', patch: { month: 8, day: 15, calendar: 'lunar' } })
    expect(d.body.item).toMatchObject({ month: 8, day: 15, calendar: 'lunar', status: 'confirmed' })
    expect(d.body.item.next.lunarLabel).toBe('农历八月十五')
    expect((await logs('date', w.date.id)).map((l) => l.action)).toEqual(['edit'])
  })

  it('handle edit into an existing value in the same scope → 409', async () => {
    const r = await api.post(`/api/review/handle/${w.hBmention.id}`, { action: 'edit', patch: { value: '以宁' } })
    expect(r.status).toBe(200) // different kind (mentioned vs display_group) → allowed
    await db.insert(handles).values({ ownerId: uid, personId: w.b.id, kind: 'mentioned', value: '阿树', valueNorm: '阿树', chatId: w.group.id, status: 'confirmed', importId: null, sourceKind: 'ai', createdAt: 'x', updatedAt: 'x' })
    const clash = await api.post(`/api/review/handle/${w.hBmention.id}`, { action: 'edit', patch: { value: '阿树' } })
    expect(clash.status).toBe(409)
  })

  it('supersede ("已过时") without replacement sets validTo today; with replacement creates a manual confirmed claim', async () => {
    const plain = await api.post(`/api/review/claim/${w.manual.id}`, { action: 'supersede' })
    expect(plain.status).toBe(200)
    expect(plain.body.item).toMatchObject({ status: 'superseded', statusReason: 'outdated', validTo: todayInTz(), supersededByClaimId: null })
    expect(plain.body.created).toBeUndefined()

    await api.post(`/api/review/claim/${w.newWork.id}`, { action: 'accept' })
    const r = await api.post(`/api/review/claim/${w.newWork.id}`, { action: 'supersede', replacement: { statement: '已经离开杭州，回苏州了' } })
    expect(r.body.created).toMatchObject({ status: 'confirmed', sourceKind: 'manual', confidence: null, supersedesClaimId: w.newWork.id, category: 'work', evidenceCount: 0 })
    expect(r.body.item).toMatchObject({ status: 'superseded', statusReason: 'outdated', supersededByClaimId: r.body.created.id })
    // supersede chain oldWork → newWork → replacement
    expect(await claimRow(w.oldWork.id)).toMatchObject({ supersededByClaimId: w.newWork.id })
    expect((await logs('claim', w.newWork.id)).map((l) => l.action)).toEqual(['accept', 'supersede'])
    // only confirmed claims can be outdated; non-claims are a validation error
    expect((await api.post(`/api/review/claim/${w.b1.id}`, { action: 'supersede' })).status).toBe(409)
    expect((await api.post(`/api/review/date/${w.date.id}`, { action: 'supersede' })).status).toBe(400)
  })

  it('delete is a hard delete of item + evidence + mentions, logged with before; restores a claim it superseded', async () => {
    await api.post(`/api/review/claim/${w.newWork.id}`, { action: 'edit', patch: { statement: '和周以宁一起在杭州做制片' } })
    const r = await api.post(`/api/review/claim/${w.newWork.id}`, { action: 'delete' })
    expect(r.status).toBe(200)
    expect(r.body.item.id).toBe(w.newWork.id)
    expect(await claimRow(w.newWork.id)).toBeUndefined()
    expect(await db.select().from(evidence).where(owned(evidence, uid, eq(evidence.targetType, 'claim'), eq(evidence.targetId, w.newWork.id)))).toEqual([])
    expect(await db.select().from(claimMentions).where(owned(claimMentions, uid, eq(claimMentions.claimId, w.newWork.id)))).toEqual([])
    expect(await claimRow(w.oldWork.id)).toMatchObject({ status: 'confirmed', supersededByClaimId: null, statusReason: null })
    const del = (await logs('claim', w.newWork.id)).find((l) => l.action === 'delete')!
    expect(del.before).toMatchObject({ statement: '和周以宁一起在杭州做制片' })
    expect((await api.post(`/api/review/claim/${w.newWork.id}`, { action: 'accept' })).status).toBe(404)
  })

  it('delete of a handle unlinks its messages; delete of an event removes participants', async () => {
    expect((await api.post(`/api/review/handle/${w.hB.id}`, { action: 'delete' })).status).toBe(200)
    const ms = await db.select().from(messages).where(owned(messages, uid, eq(messages.id, w.g[0].id)))
    expect(ms[0].senderHandleId).toBeNull()
    expect(ms[0].senderName).toBe('嘉树')
    expect((await api.post(`/api/review/event/${w.evt.id}`, { action: 'delete' })).status).toBe(200)
  })

  it('bulk accept: updates found items, reports missing ones, supersedes, writes logs; import becomes done when nothing is proposed', async () => {
    const r = await api.post('/api/review/bulk', {
      action: 'accept',
      items: [
        { type: 'claim', id: w.newWork.id },
        { type: 'claim', id: w.b1.id },
        { type: 'claim', id: 999999 },
        { type: 'handle', id: w.hBmention.id },
      ],
    })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ updated: 3, failed: [{ type: 'claim', id: 999999, code: 'not_found' }] })
    expect(await claimRow(w.oldWork.id)).toMatchObject({ status: 'superseded' })
    expect((await logs('handle', w.hBmention.id)).map((l) => l.action)).toEqual(['accept'])
    const imp = () => db.select().from(imports).where(owned(imports, uid, eq(imports.id, w.imp.id))).get()
    expect((await imp())!.status).toBe('reviewing')
    const rest = await api.post('/api/review/bulk', {
      action: 'reject',
      items: [
        { type: 'claim', id: w.b2.id },
        { type: 'claim', id: w.bSensitive.id },
        { type: 'claim', id: w.bMixed.id },
        { type: 'relation', id: w.rel.id },
        { type: 'event', id: w.evt.id },
        { type: 'date', id: w.date.id },
      ],
    })
    expect(rest.body.updated).toBe(6)
    expect((await imp())!.status).toBe('done')
    // a superseded claim in a bulk request is reported, not thrown
    const again = await api.post('/api/review/bulk', { action: 'accept', items: [{ type: 'claim', id: w.oldWork.id }] })
    expect(again.body).toEqual({ updated: 0, failed: [{ type: 'claim', id: w.oldWork.id, code: 'conflict' }] })
  })

  it('validation: unknown type, bad action, empty bulk → 400', async () => {
    expect((await api.post(`/api/review/person/${w.a.id}`, { action: 'accept' })).status).toBe(400)
    expect((await api.post(`/api/review/claim/${w.b1.id}`, { action: 'merge' })).status).toBe(400)
    expect((await api.post('/api/review/bulk', { action: 'accept', items: [] })).status).toBe(400)
  })
})
