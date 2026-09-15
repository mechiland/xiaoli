import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProfileResponse } from '@/contracts'
import {
  chats,
  claimMentions,
  claims,
  eventParticipants,
  events,
  evidence,
  handles,
  importantDates,
  imports,
  messages,
  owned,
  persons,
  relations,
  reviewLog,
  withOwner,
  withOwnerLink,
  type Db,
} from '@/server/db'
import { createTestApp, createTestDb, createTestUser } from '@/tests/helpers/test-db'
import { relationToMeValue } from '../profile'

// Synthetic world (fictional names only).
const STATS = { byKind: {}, bySender: {}, images: { count: 0, bytes: 0 }, videos: { count: 0, bytes: 0 } }
const T0 = '2026-09-01T00:00:00.000Z'

async function world(db: Db, ownerId: string) {
  const one = async <T>(q: Promise<T[]>) => (await q)[0]
  const priv = await one(db.insert(chats).values(withOwner<typeof chats>(ownerId, { title: '私聊甲', kind: 'private', note: null })).returning())
  const group = await one(db.insert(chats).values(withOwner<typeof chats>(ownerId, { title: '同学群', kind: 'group', note: null })).returning())
  const imp = await one(
    db
      .insert(imports)
      .values(withOwner<typeof imports>(ownerId, { chatId: priv.id, fileName: 'a.zip', fileSha256: `sha-${Math.random()}`, exportedAt: null, parserVersion: 't', status: 'reviewing', messageCount: 5, newMessageCount: 5, dateFrom: null, dateTo: null, stats: STATS, error: null }))
      .returning(),
  )
  const person = (label: string, extra: Partial<typeof persons.$inferInsert> = {}) =>
    one(db.insert(persons).values(withOwner<typeof persons>(ownerId, { label, labelSort: label, isSelf: false, pinned: false, mergedIntoId: null, importId: null, ...extra })).returning())
  const self = await person('我', { isSelf: true })
  const a = await person('周以宁')
  const b = await person('陈嘉树')
  const merged = await person('以宁旧', { mergedIntoId: a.id })
  const mergedTwice = await person('以宁更旧', { mergedIntoId: merged.id })

  const handle = (personId: number, kind: typeof handles.$inferInsert.kind, value: string, chatId: number | null, extra: Partial<typeof handles.$inferInsert> = {}) =>
    one(db.insert(handles).values(withOwner<typeof handles>(ownerId, { personId, kind, value, valueNorm: value, chatId, status: 'confirmed', importId: null, sourceKind: 'manual', ...extra })).returning())
  const hSelf = await handle(self.id, 'display_private', '我是小丽', priv.id)
  const hA = await handle(a.id, 'display_private', '以宁', priv.id)
  const hAg = await handle(a.id, 'display_group', '宁宁', group.id)
  const hAterm = await handle(a.id, 'address_term', '宁姐', group.id, { status: 'proposed', importId: imp.id, sourceKind: 'ai' })
  await handle(a.id, 'real_name', '周小宁', null, { status: 'rejected' })
  const hB = await handle(b.id, 'display_group', '嘉树', group.id)

  const msg = (chatId: number, seq: number, h: { id: number; value: string }, sentAt: string, body = '消息') =>
    one(db.insert(messages).values(withOwner<typeof messages>(ownerId, { chatId, firstImportId: imp.id, senderHandleId: h.id, senderName: h.value, sentAt, seq: seq * 1024, kind: 'text', body, meta: null, fingerprint: `fp${chatId}-${seq}` })).returning())
  const m1 = await msg(priv.id, 1, hA, '2026-08-01 10:00', '我在杭州做制片')
  const m2 = await msg(priv.id, 2, hSelf, '2026-08-02 10:00')
  await msg(priv.id, 3, hA, '2026-08-03 10:00')
  const g1 = await msg(group.id, 1, hAg, '2026-08-05 09:00')
  await msg(group.id, 2, hB, '2026-08-06 09:00')
  await msg(group.id, 3, hB, '2026-08-07 09:00')

  const claim = (personId: number, statement: string, extra: Partial<typeof claims.$inferInsert> = {}) =>
    one(
      db
        .insert(claims)
        .values(withOwner<typeof claims>(ownerId, { personId, statement, statementNorm: statement, category: 'work', validFrom: null, validTo: null, learnedAt: T0, confidence: 0.9, sensitive: false, status: 'confirmed', statusReason: null, statusChangedAt: T0, supersedesClaimId: null, supersededByClaimId: null, importId: imp.id, jobId: null, sourceKind: 'ai', ...extra }))
        .returning(),
    )
  const oldWork = await claim(a.id, '在苏州做会计', { status: 'superseded', statusReason: 'superseded', validFrom: '2020', statusChangedAt: '2026-08-10T00:00:00.000Z' })
  const work = await claim(a.id, '在杭州做制片', { validFrom: '2024-05', supersedesClaimId: oldWork.id })
  const outdated = await claim(a.id, '住在苏州', { category: 'location', status: 'superseded', statusReason: 'outdated', validTo: '2026-08-01', statusChangedAt: '2026-08-20T00:00:00.000Z' })
  const city = await claim(a.id, '现在住在杭州', { category: 'location' })
  const proposed = await claim(a.id, '喜欢爬山', { category: 'preference', status: 'proposed' })
  await claim(a.id, '是个素食者', { category: 'preference', status: 'rejected' })
  const mentionClaim = await claim(a.id, '和陈嘉树是大学同学', { category: 'education' })
  const bClaim = await claim(b.id, '在读研究生', { category: 'education' })
  await db.insert(claimMentions).values(withOwnerLink<typeof claimMentions>(ownerId, { claimId: mentionClaim.id, personId: b.id }))
  await db.insert(claimMentions).values(withOwnerLink<typeof claimMentions>(ownerId, { claimId: bClaim.id, personId: a.id }))
  await db.update(claims).set({ supersededByClaimId: work.id }).where(owned(claims, ownerId, eq(claims.id, oldWork.id)))

  const rel = (fromPersonId: number, toPersonId: number, type: string, label: string | null, status: 'confirmed' | 'proposed' = 'confirmed') =>
    one(db.insert(relations).values(withOwner<typeof relations>(ownerId, { fromPersonId, toPersonId, type, label, status, importId: imp.id, sourceKind: 'ai' })).returning())
  const relMe = await rel(a.id, self.id, 'friend', '老同学')
  const relB = await rel(b.id, a.id, 'classmate', null, 'proposed')

  const date = (personId: number, kind: string, month: number, day: number, calendar: 'solar' | 'lunar', status: 'confirmed' | 'proposed' = 'confirmed') =>
    one(db.insert(importantDates).values(withOwner<typeof importantDates>(ownerId, { personId, kind, month, day, year: null, calendar, isLeapMonth: false, label: null, status, importId: imp.id, sourceKind: 'ai' })).returning())
  const birthday = await date(a.id, 'birthday', 8, 15, 'lunar')
  const anniversary = await date(a.id, 'anniversary', 3, 1, 'solar', 'proposed')

  const ev = await one(db.insert(events).values(withOwner<typeof events>(ownerId, { summary: '一起去爬了黄山', happenedAt: '2025-10', place: null, status: 'confirmed', importId: imp.id, sourceKind: 'ai' })).returning())
  const evSolo = await one(db.insert(events).values(withOwner<typeof events>(ownerId, { summary: '搬家到杭州', happenedAt: '2024-04', place: '杭州', status: 'confirmed', importId: imp.id, sourceKind: 'ai' })).returning())
  await db.insert(eventParticipants).values([
    withOwnerLink<typeof eventParticipants>(ownerId, { eventId: ev.id, personId: a.id }),
    withOwnerLink<typeof eventParticipants>(ownerId, { eventId: ev.id, personId: b.id }),
    withOwnerLink<typeof eventParticipants>(ownerId, { eventId: evSolo.id, personId: a.id }),
  ])
  const evRow = (targetType: typeof evidence.$inferInsert.targetType, targetId: number, messageId: number) =>
    withOwnerLink<typeof evidence>(ownerId, { targetType, targetId, messageId })
  await db.insert(evidence).values([
    evRow('claim', work.id, m1.id),
    evRow('claim', work.id, m2.id),
    evRow('claim', city.id, m1.id),
    evRow('handle', hAterm.id, g1.id),
    evRow('relation', relMe.id, m1.id),
    evRow('date', birthday.id, m1.id),
    evRow('event', ev.id, g1.id),
    evRow('event', evSolo.id, m1.id),
    evRow('claim', bClaim.id, g1.id),
  ])
  return { priv, group, imp, self, a, b, merged, mergedTwice, hA, hAg, hAterm, hB, work, city, oldWork, outdated, proposed, mentionClaim, bClaim, relMe, relB, birthday, anniversary, ev, evSolo }
}

function client(db: Db, userId: string) {
  const app = createTestApp({ db, userId })
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    return { status: res.status, body: (await res.json()) as any } // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  return {
    get: (p: string) => call('GET', p),
    patch: (p: string, b: unknown) => call('PATCH', p, b),
    delete: (p: string) => call('DELETE', p),
  }
}

describe('person routes', () => {
  let db: Db
  let dispose: () => Promise<void>
  beforeAll(async () => {
    const t = await createTestDb()
    db = t.db
    dispose = t.dispose
  })
  afterAll(async () => dispose?.())

  it('GET /api/people/:id aggregates aliases, infobox, sections, relations, events and history', async () => {
    const uid = (await createTestUser(db, `u${Math.random()}@xiaoli.test`)).id
    const w = await world(db, uid)
    const r = await client(db, uid).get(`/api/people/${w.a.id}`)
    expect(r.status).toBe(200)
    const p = r.body as ProfileResponse

    expect(p.person).toMatchObject({ id: w.a.id, label: '周以宁', isSelf: false })
    // aliases: live handles only (rejected dropped), grouped in kind order
    expect(p.aliases.map((g) => g.kind)).toEqual(['display_private', 'display_group', 'address_term'])
    expect(p.aliases.find((g) => g.kind === 'display_group')!.items[0]).toMatchObject({ value: '宁宁', chatTitle: '同学群' })
    expect(p.aliases.find((g) => g.kind === 'address_term')!.items[0]).toMatchObject({ status: 'proposed', evidenceCount: 1 })

    // infobox derived from claims/dates/relations/messages
    expect(p.infobox.relationToMe).toEqual({ value: '老同学', relationId: w.relMe.id })
    expect(p.infobox.work).toEqual({ value: '在杭州做制片', claimId: w.work.id })
    expect(p.infobox.city).toEqual({ value: '现在住在杭州', claimId: w.city.id })
    expect(p.infobox.school).toEqual({ value: '和陈嘉树是大学同学', claimId: w.mentionClaim.id })
    expect(p.infobox.birthday).toMatchObject({ id: w.birthday.id, calendar: 'lunar', evidenceCount: 1 })
    expect(p.infobox.birthday!.next).not.toBeNull()
    expect(p.infobox.birthday!.next!.lunarLabel).toBe('农历八月十五')
    expect(p.infobox.otherDates.map((d) => d.id)).toEqual([w.anniversary.id])
    // private chat: all messages of the chat; group chat: this person's own messages
    expect(p.infobox.chats).toEqual([
      { chat: { id: w.group.id, title: '同学群', kind: 'group' }, messageCount: 1, lastMessageAt: '2026-08-05 09:00' },
      { chat: { id: w.priv.id, title: '私聊甲', kind: 'private' }, messageCount: 3, lastMessageAt: '2026-08-03 10:00' },
    ])
    expect(p.infobox.lastContactAt).toBe('2026-08-05 09:00')

    // sections in SPEC order, confirmed + proposed, rejected hidden
    expect(p.sections.map((s) => s.category)).toEqual(['work', 'location', 'education', 'preference'])
    expect(p.sections.find((s) => s.category === 'preference')!.claims.map((c) => c.statement)).toEqual(['喜欢爬山'])
    const work = p.sections[0].claims[0]
    expect(work).toMatchObject({ id: w.work.id, evidenceCount: 2, validFrom: '2024-05' })
    expect(p.sections.find((s) => s.category === 'education')!.claims[0].mentions).toEqual([{ id: w.b.id, label: '陈嘉树' }])

    // relations both directions, events reverse-chronological with participants, history newest first
    expect(p.relations.map((x) => x.id)).toEqual([w.relMe.id, w.relB.id])
    expect(p.relations[1]).toMatchObject({ from: { id: w.b.id, label: '陈嘉树' }, to: { id: w.a.id }, status: 'proposed' })
    expect(p.events.map((e) => e.id)).toEqual([w.ev.id, w.evSolo.id])
    expect(p.events[0].participants.map((x) => x.id).sort()).toEqual([w.a.id, w.b.id].sort())
    expect(p.history.map((c) => [c.id, c.statusReason])).toEqual([
      [w.outdated.id, 'outdated'],
      [w.oldWork.id, 'superseded'],
    ])
  })

  it('merged ids answer { redirectTo } with the surviving person, following chains', async () => {
    const uid = (await createTestUser(db, `u${Math.random()}@xiaoli.test`)).id
    const w = await world(db, uid)
    const api = client(db, uid)
    expect((await api.get(`/api/people/${w.merged.id}`)).body).toEqual({ redirectTo: w.a.id })
    expect((await api.get(`/api/people/${w.mergedTwice.id}`)).body).toEqual({ redirectTo: w.a.id })
    expect((await api.get('/api/people/999999')).status).toBe(404)
    expect((await api.patch(`/api/people/${w.merged.id}`, { pinned: true })).status).toBe(409)
  })

  it('owner isolation: another account gets 404 for GET, PATCH and DELETE', async () => {
    const uidA = (await createTestUser(db, `a${Math.random()}@xiaoli.test`)).id
    const uidB = (await createTestUser(db, `b${Math.random()}@xiaoli.test`)).id
    const w = await world(db, uidA)
    const other = client(db, uidB)
    expect((await other.get(`/api/people/${w.a.id}`)).status).toBe(404)
    expect((await other.patch(`/api/people/${w.a.id}`, { pinned: true })).status).toBe(404)
    expect((await other.delete(`/api/people/${w.a.id}`)).status).toBe(404)
    expect((await client(db, uidA).get(`/api/people/${w.a.id}`)).status).toBe(200)
  })

  it('PATCH updates label (with pinyin sort key) and pinned; validates', async () => {
    const uid = (await createTestUser(db, `u${Math.random()}@xiaoli.test`)).id
    const w = await world(db, uid)
    const api = client(db, uid)
    const r = await api.patch(`/api/people/${w.b.id}`, { label: ' 王小丽 ', pinned: true })
    expect(r.status).toBe(200)
    expect(r.body.person).toMatchObject({ id: w.b.id, label: '王小丽', pinned: true })
    const row = await db.select().from(persons).where(owned(persons, uid, eq(persons.id, w.b.id))).get()
    expect(row!.labelSort).toBe('wang xiao li')
    expect((await api.patch(`/api/people/${w.b.id}`, {})).status).toBe(400)
    expect((await api.patch(`/api/people/${w.b.id}`, { label: '' })).status).toBe(400)
    expect((await api.patch(`/api/people/${w.b.id}`, { color: 'red' })).status).toBe(400)
  })

  it('DELETE follows §11: items + evidence gone, messages kept with sender cleared, shared events survive, merged persons deleted', async () => {
    const uid = (await createTestUser(db, `u${Math.random()}@xiaoli.test`)).id
    const w = await world(db, uid)
    const logBefore = (await db.select().from(reviewLog).where(owned(reviewLog, uid))).length
    const r = await client(db, uid).delete(`/api/people/${w.a.id}`)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ deleted: true })

    const byOwner = async <T>(q: Promise<T[]>) => (await q).length
    expect(await byOwner(db.select().from(persons).where(owned(persons, uid, eq(persons.id, w.a.id))))).toBe(0)
    expect(await byOwner(db.select().from(persons).where(owned(persons, uid, eq(persons.id, w.merged.id))))).toBe(0)
    expect(await byOwner(db.select().from(persons).where(owned(persons, uid, eq(persons.id, w.mergedTwice.id))))).toBe(0)
    expect(await byOwner(db.select().from(handles).where(owned(handles, uid, eq(handles.personId, w.a.id))))).toBe(0)
    expect(await byOwner(db.select().from(claims).where(owned(claims, uid, eq(claims.personId, w.a.id))))).toBe(0)
    expect(await byOwner(db.select().from(importantDates).where(owned(importantDates, uid, eq(importantDates.personId, w.a.id))))).toBe(0)
    expect(await byOwner(db.select().from(relations).where(owned(relations, uid)))).toBe(0)

    // messages stay, sender handle cleared for the deleted handles only
    const msgs = await db.select().from(messages).where(owned(messages, uid))
    expect(msgs).toHaveLength(6)
    expect(msgs.filter((m) => m.senderName === '以宁' || m.senderName === '宁宁').every((m) => m.senderHandleId === null)).toBe(true)
    expect(msgs.filter((m) => m.senderName === '嘉树').every((m) => m.senderHandleId === w.hB.id)).toBe(true)

    // evidence of deleted items gone; B's claim evidence kept; mentions of A removed from B's claim
    const ev = await db.select().from(evidence).where(owned(evidence, uid))
    expect(ev.map((e) => [e.targetType, e.targetId])).toEqual(expect.arrayContaining([['claim', w.bClaim.id]]))
    expect(ev.some((e) => e.targetType === 'event' && e.targetId === w.evSolo.id)).toBe(false)
    expect(ev.some((e) => e.targetType === 'event' && e.targetId === w.ev.id)).toBe(true)
    expect(await byOwner(db.select().from(claimMentions).where(owned(claimMentions, uid)))).toBe(0)

    // the shared event keeps B; A's solo event is deleted
    expect(await byOwner(db.select().from(events).where(owned(events, uid, eq(events.id, w.evSolo.id))))).toBe(0)
    const parts = await db.select().from(eventParticipants).where(owned(eventParticipants, uid, eq(eventParticipants.eventId, w.ev.id)))
    expect(parts.map((p) => p.personId)).toEqual([w.b.id])

    // reviewLog kept; import had proposed items only on A → now done
    expect((await db.select().from(reviewLog).where(owned(reviewLog, uid))).length).toBeGreaterThanOrEqual(logBefore)
    expect((await db.select().from(imports).where(owned(imports, uid, eq(imports.id, w.imp.id))).get())!.status).toBe('done')
  })

  it('DELETE self → 409; unknown → 404', async () => {
    const uid = (await createTestUser(db, `u${Math.random()}@xiaoli.test`)).id
    const w = await world(db, uid)
    const api = client(db, uid)
    expect((await api.delete(`/api/people/${w.self.id}`)).status).toBe(409)
    expect((await api.delete('/api/people/987654')).status).toBe(404)
  })

  it('relationToMeValue reads the relation from the person side', () => {
    expect(relationToMeValue({ fromPersonId: 1, toPersonId: 9, type: 'parent', label: '妈妈' }, 1)).toBe('妈妈')
    expect(relationToMeValue({ fromPersonId: 9, toPersonId: 1, type: 'parent', label: '妈妈' }, 1)).toBe('子女')
    expect(relationToMeValue({ fromPersonId: 9, toPersonId: 1, type: 'friend', label: null }, 1)).toBe('朋友')
    expect(relationToMeValue({ fromPersonId: 1, toPersonId: 9, type: 'colleague', label: null }, 1)).toBe('同事')
  })
})
