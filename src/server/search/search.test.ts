// Integration tests for search + people index against an in-memory D1 (synthetic data only).
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PeopleIndexResponse, SearchResponse } from '@/contracts'
import { sortKey } from '@/lib/pinyin'
import { claims, handles, owned, persons, withOwner, type Db } from '@/server/db'
import { createTestApp, createTestDb, createTestUser } from '~/tests/helpers/test-db'
import { listPeopleIndex, searchAll, type InteractionSearchFn } from './index'

const NOW = '2026-09-15T08:00:00.000Z'

/** Stands in for `searchInteraction`, which is the interaction module's to implement. */
const fakeInteraction: InteractionSearchFn = async (_db, _ownerId, q) => [
  { kind: 'segment', id: 501, person: null, chatId: 9, chatTitle: '装修群', at: '2026-08-12 21:04', text: `聊了${q}的排期`, href: '/chats/9?at=77', highlights: [[2, 2 + q.length]] },
]
const norm = (s: string) => s.normalize('NFKC').toLowerCase().trim()

describe('search (D1 integration)', () => {
  let db: Db
  let dispose: () => Promise<void>
  let a: string
  let b: string
  const ids: Record<string, number> = {}

  async function person(owner: string, key: string, label: string, extra: Partial<typeof persons.$inferInsert> = {}) {
    const [row] = await db
      .insert(persons)
      .values(withOwner<typeof persons>(owner, { label, labelSort: sortKey(label), isSelf: false, pinned: false, ...extra }, NOW))
      .returning()
    ids[key] = row.id
    return row.id
  }
  async function handle(owner: string, personId: number, kind: 'mentioned' | 'real_name' | 'address_term', value: string, status: 'confirmed' | 'proposed' | 'rejected' = 'confirmed') {
    await db.insert(handles).values(
      withOwner<typeof handles>(owner, { personId, kind, value, valueNorm: norm(value), chatId: null, status, importId: null, sourceKind: 'ai' }, NOW),
    )
  }
  async function claim(owner: string, key: string, personId: number, statement: string, status: 'confirmed' | 'proposed' | 'rejected' | 'superseded' = 'confirmed') {
    const [row] = await db
      .insert(claims)
      .values(
        withOwner<typeof claims>(owner, {
          personId,
          statement,
          statementNorm: norm(statement),
          category: 'other',
          learnedAt: NOW,
          statusChangedAt: NOW,
          confidence: 0.9,
          sensitive: false,
          status,
          sourceKind: 'ai',
        }, NOW),
      )
      .returning()
    ids[key] = row.id
  }

  beforeAll(async () => {
    const t = await createTestDb()
    db = t.db
    dispose = t.dispose
    a = (await createTestUser(db, 'search-a@xiaoli.test')).id
    b = (await createTestUser(db, 'search-b@xiaoli.test')).id

    await person(a, 'self', '我', { isSelf: true })
    const lin = await person(a, 'lin', '林知夏', { lastMessageAt: '2026-09-01 10:00' })
    const linYu = await person(a, 'linYu', '林小雨', { pinned: true })
    const zhou = await person(a, 'zhou', '周明远')
    const merged = await person(a, 'merged', '林知夏（旧）')
    await db.update(persons).set({ mergedIntoId: lin }).where(owned(persons, a, eq(persons.id, merged)))
    await person(a, 'nora', 'Nora Chen')
    await person(a, 'cat', '🐱 橘子妈妈')

    await handle(a, zhou, 'mentioned', '远哥')
    await handle(a, zhou, 'address_term', '周老板', 'proposed')
    await handle(a, lin, 'mentioned', 'Linda')
    await handle(a, lin, 'mentioned', '林知夏') // alias equal to label adds nothing
    await handle(a, linYu, 'address_term', '雨姐', 'rejected')
    await handle(a, merged, 'mentioned', '夏夏')

    await claim(a, 'teapot', lin, '收藏了一整套景德镇青花茶具')
    await claim(a, 'linHz', lin, '在杭州做设计')
    await claim(a, 'proposedHz', lin, '在杭州读高中', 'proposed')
    await claim(a, 'rejectedHz', zhou, '住在杭州', 'rejected')
    await claim(a, 'zhouHz', zhou, '去杭州出差了很久，经常在杭州和上海之间往返')
    await claim(a, 'mergedHz', merged, '喜欢杭州')
    await claim(a, 'fullwidth', zhou, '在ＡＢＣ公司上班')
    await claim(a, 'selfHz', ids.self, '在杭州工作')

    // Account B: same labels and statements (seed2-style overlap)
    const bLin = await person(b, 'bLin', '林知夏')
    await handle(b, bLin, 'mentioned', '远哥')
    await claim(b, 'bHz', bLin, '在杭州读大学')
    await person(b, 'bSelf', '我', { isSelf: true })
  })
  afterAll(async () => dispose?.())

  it('alias-only match returns the person with matchedAlias', async () => {
    const r = await searchAll(db, a, '远哥')
    expect(r.people).toEqual([{ person: { id: ids.zhou, label: '周明远' }, matchedAlias: '远哥' }])
    const proposedAlias = await searchAll(db, a, '周老板')
    expect(proposedAlias.people[0]).toEqual({ person: { id: ids.zhou, label: '周明远' }, matchedAlias: '周老板' })
  })

  it('label match wins over alias; merged, self and other owners are excluded', async () => {
    const r = await searchAll(db, a, '林知夏')
    expect(r.people.map((p) => p.person.id)).toEqual([ids.lin])
    expect(r.people[0].matchedAlias).toBeNull()
    expect((await searchAll(db, a, '夏夏')).people).toEqual([]) // alias of merged person
    expect((await searchAll(db, a, '我')).people).toEqual([])
    expect((await searchAll(db, a, '雨姐')).people).toEqual([]) // rejected handle
  })

  it('ranks exact > prefix > contains, pinned breaks ties', async () => {
    const r = await searchAll(db, a, '林')
    expect(r.people.map((p) => p.person.id)).toEqual([ids.linYu, ids.lin])
    const latin = await searchAll(db, a, 'lin')
    // "Linda" alias prefix (70) beats pinyin full prefix (62) of 林小雨 (pinned)
    expect(latin.people.map((p) => p.person.id)).toEqual([ids.lin, ids.linYu])
    expect(latin.people[0].matchedAlias).toBe('Linda')
  })

  it('matches pinyin initials and full pinyin for Latin queries', async () => {
    expect((await searchAll(db, a, 'lzx')).people.map((p) => p.person.id)).toEqual([ids.lin])
    expect((await searchAll(db, a, 'LinZhi')).people.map((p) => p.person.id)).toEqual([ids.lin])
    expect((await searchAll(db, a, 'zmy')).people.map((p) => p.person.id)).toEqual([ids.zhou])
    expect((await searchAll(db, a, 'jzmm')).people.map((p) => p.person.id)).toEqual([ids.cat])
    expect((await searchAll(db, a, 'nora')).people.map((p) => p.person.id)).toEqual([ids.nora])
  })

  it('claims: confirmed only, not merged persons, owner-scoped, with highlight ranges', async () => {
    const r = await searchAll(db, a, '杭州')
    const got = r.claims.map((c) => c.claimId).sort()
    expect(got).toEqual([ids.linHz, ids.zhouHz, ids.selfHz].sort())
    const zhouHit = r.claims.find((c) => c.claimId === ids.zhouHz)!
    expect(zhouHit.person).toEqual({ id: ids.zhou, label: '周明远' })
    expect(zhouHit.highlights).toEqual([[1, 3], [12, 14]])
    for (const c of r.claims) for (const [s, e] of c.highlights) expect(c.statement.slice(s, e)).toBe('杭州')
    // shorter statements first
    expect(r.claims[r.claims.length - 1].claimId).toBe(ids.zhouHz)
    const rb = await searchAll(db, b, '杭州')
    expect(rb.claims.map((c) => c.claimId)).toEqual([ids.bHz])
  })

  it('claims: full-width text matches half-width query; a term naming a person scopes the other terms to them', async () => {
    const fw = await searchAll(db, a, 'abc')
    expect(fw.claims).toEqual([{ person: { id: ids.zhou, label: '周明远' }, claimId: ids.fullwidth, statement: '在ＡＢＣ公司上班', highlights: [[1, 4]] }])
    const multi = await searchAll(db, a, '周明远 杭州')
    expect(multi.claims.map((c) => c.claimId)).toEqual([ids.zhouHz])
    const teapot = await searchAll(db, a, '林知夏 茶具')
    expect(teapot.claims).toEqual([{ person: { id: ids.lin, label: '林知夏' }, claimId: ids.teapot, statement: '收藏了一整套景德镇青花茶具', highlights: [[11, 13]] }])
    const both = await searchAll(db, a, '在 杭州')
    expect(both.claims.map((c) => c.claimId).sort()).toEqual([ids.linHz, ids.zhouHz, ids.selfHz].sort())
    // other owners' persons never scope: B's alias 远哥 does not pull in A's claims and vice versa
    expect((await searchAll(db, b, '远哥 杭州')).claims.map((c) => c.claimId)).toEqual([ids.bHz])
  })

  it('types and limit are honoured; LIKE wildcards are literal', async () => {
    expect((await searchAll(db, a, '杭州', { types: 'people' })).claims).toEqual([])
    expect((await searchAll(db, a, '远哥', { types: 'claims' })).people).toEqual([])
    const only = await searchAll(db, a, '杭州', { types: 'interaction', interaction: fakeInteraction })
    expect([only.people, only.claims]).toEqual([[], []])
    expect(only.interaction).toHaveLength(1)
    expect((await searchAll(db, a, '杭州', { types: 'people', interaction: fakeInteraction })).interaction).toEqual([])
    expect((await searchAll(db, a, '杭州', { limit: 1 })).claims).toHaveLength(1)
    const wild = await searchAll(db, a, '%')
    expect(wild.people).toEqual([])
    expect(wild.claims).toEqual([])
    expect((await searchAll(db, a, '_')).claims).toEqual([])
  })

  // The 来往 group is produced by `@/server/interaction` (ARCHITECTURE §1.17); search passes it through as the last group.
  it('来往 hits are passed through, and a failing interaction module still leaves people and claims', async () => {
    const ok = await searchAll(db, a, '杭州', { interaction: fakeInteraction })
    expect(ok.interaction.map((h) => h.id)).toEqual([501])
    expect(ok.people.length + ok.claims.length).toBeGreaterThan(0)
    const down = await searchAll(db, a, '杭州', {
      interaction: async () => {
        throw new Error('not_implemented')
      },
    })
    expect(down.interaction).toEqual([])
    expect(down.claims.map((c) => c.claimId)).toEqual(ok.claims.map((c) => c.claimId))
    expect((await searchAll(db, a, '   ', { interaction: fakeInteraction })).interaction).toEqual([])
  })

  it('people index groups by letter, # last, excludes self/merged, per owner', async () => {
    const idx = await listPeopleIndex(db, a)
    expect(idx.total).toBe(5)
    expect(idx.groups.map((g) => g.letter)).toEqual(['L', 'N', 'Z', '#'])
    expect(idx.groups[0].people.map((p) => p.label)).toEqual(['林小雨', '林知夏'])
    expect(idx.groups[0].people[0].pinned).toBe(true)
    expect(idx.groups[3].people.map((p) => p.label)).toEqual(['🐱 橘子妈妈'])
    const idxB = await listPeopleIndex(db, b)
    expect(idxB).toEqual({ total: 1, groups: [{ letter: 'L', people: [{ id: ids.bLin, label: '林知夏', pinned: false }] }] })
  })

  it('routes: auth, validation, owner isolation through the Hono app', async () => {
    const appA = createTestApp({ db, userId: a })
    const appB = createTestApp({ db, userId: b })
    const anon = createTestApp({ db, userId: null })

    const resA = await appA.request(`/api/search?q=${encodeURIComponent('远哥')}&types=all&limit=5`)
    expect(resA.status).toBe(200)
    const bodyA = (await resA.json()) as SearchResponse
    expect(bodyA.q).toBe('远哥')
    expect(bodyA.people.map((p) => p.person.id)).toEqual([ids.zhou])

    const bodyB = (await (await appB.request(`/api/search?q=${encodeURIComponent('远哥')}`)).json()) as SearchResponse
    expect(bodyB.people.map((p) => p.person.id)).toEqual([ids.bLin])

    expect((await anon.request('/api/search?q=abc')).status).toBe(401)
    expect((await appA.request('/api/search?q=')).status).toBe(400)
    expect((await appA.request(`/api/search?q=${'x'.repeat(101)}`)).status).toBe(400)
    expect((await appA.request('/api/search?q=a&types=nope')).status).toBe(400)

    const idx = await appB.request('/api/people?index=pinyin')
    expect(idx.status).toBe(200)
    expect(((await idx.json()) as PeopleIndexResponse).total).toBe(1)
    expect((await anon.request('/api/people?index=pinyin')).status).toBe(401)
  })
})
