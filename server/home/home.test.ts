// Integration tests for home data against an in-memory D1 (synthetic data only).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HomeResponseSchema, type ImportStats } from '@/contracts'
import { sortKey } from '@/lib/pinyin'
import { chats, claims, importantDates, imports, persons, updateUserSettings, withOwner, type Db } from '@/server/db'
import { createTestApp, createTestDb, createTestUser } from '@/tests/helpers/test-db'
import { getHome, getHomeBlocks } from './index'

const TODAY = '2026-09-15'
const at = (minute: number) => new Date(Date.UTC(2026, 8, 10, 0, minute)).toISOString()
const STATS: ImportStats = { byKind: {}, bySender: {}, images: { count: 0, bytes: 0 }, videos: { count: 0, bytes: 0 } }

describe('home (D1 integration)', () => {
  let db: Db
  let dispose: () => Promise<void>
  let a: string
  let b: string
  let empty: string
  const id: Record<string, number> = {}

  async function person(owner: string, key: string, label: string, extra: Partial<typeof persons.$inferInsert> = {}) {
    const [row] = await db
      .insert(persons)
      .values(withOwner<typeof persons>(owner, { label, labelSort: sortKey(label), isSelf: false, pinned: false, ...extra }, at(0)))
      .returning()
    id[key] = row.id
    return row.id
  }
  async function imp(owner: string, key: string, minute: number, status: 'done' | 'reviewing' | 'mapping', chatId: number | null) {
    const [row] = await db
      .insert(imports)
      .values(
        withOwner<typeof imports>(
          owner,
          { chatId, fileName: `${key}.zip`, fileSha256: `sha-${owner}-${key}`, exportedAt: null, parserVersion: 't', status, messageCount: 1, newMessageCount: 1, dateFrom: '2026-03-02 10:00', dateTo: '2026-09-10 18:00', stats: STATS, error: null },
          at(minute),
        ),
      )
      .returning()
    id[key] = row.id
    return row.id
  }
  async function claim(owner: string, key: string, personId: number, importId: number | null, minute: number, status: 'confirmed' | 'proposed' = 'confirmed') {
    const [row] = await db
      .insert(claims)
      .values(
        withOwner<typeof claims>(
          owner,
          { personId, statement: `statement ${key}`, statementNorm: `statement ${key}`, category: 'work', learnedAt: at(minute), statusChangedAt: at(minute), confidence: 0.9, sensitive: false, status, importId, sourceKind: 'ai' },
          at(minute),
        ),
      )
      .returning()
    id[key] = row.id
  }
  async function date(owner: string, personId: number, month: number, day: number, extra: Partial<typeof importantDates.$inferInsert> = {}) {
    const [row] = await db
      .insert(importantDates)
      .values(
        withOwner<typeof importantDates>(owner, { personId, kind: 'birthday', month, day, year: null, calendar: 'solar', isLeapMonth: false, label: null, status: 'confirmed', importId: null, sourceKind: 'ai', ...extra }, at(0)),
      )
      .returning()
    return row.id
  }

  beforeAll(async () => {
    const t = await createTestDb()
    db = t.db
    dispose = t.dispose
    a = (await createTestUser(db, 'home-a@xiaoli.test')).id
    b = (await createTestUser(db, 'home-b@xiaoli.test')).id
    empty = (await createTestUser(db, 'home-empty@xiaoli.test')).id

    const [chat] = await db.insert(chats).values(withOwner<typeof chats>(a, { title: '装修群', kind: 'group', note: null }, at(0))).returning()
    await person(a, 'self', '我', { isSelf: true })
    await person(a, 'lin', '林知夏', { pinned: true })
    await person(a, 'deng', '邓一帆')
    await person(a, 'merged', '林夏夏', { pinned: true, mergedIntoId: id.lin })
    await person(a, 'xu', '许嘉禾')

    // 7 imports: old1..old5 done, recent reviewing, newest mapping (excluded everywhere)
    for (let i = 1; i <= 5; i++) await imp(a, `old${i}`, i, 'done', chat.id)
    await imp(a, 'recent', 10, 'reviewing', chat.id)
    await imp(a, 'mapping', 20, 'mapping', null)

    await claim(a, 'oldest', id.xu, id.old1, 1) // import old1 is not among the last 5 non-mapping imports
    await claim(a, 'linOld', id.lin, id.old3, 3)
    await claim(a, 'linNew', id.lin, id.recent, 12)
    await claim(a, 'dengNew', id.deng, id.recent, 11)
    await claim(a, 'dengProposed', id.deng, id.recent, 30, 'proposed')
    await claim(a, 'selfClaim', id.self, id.recent, 40)
    await claim(a, 'mergedClaim', id.merged, id.recent, 50)

    id.linBirthday = await date(a, id.lin, 9, 18)
    await date(a, id.deng, 9, 20, { status: 'proposed' })
    await date(a, id.merged, 9, 16)
    await date(a, id.self, 9, 16)
    await date(a, id.xu, 12, 1)
    id.xuAnniv = await date(a, id.xu, 10, 1, { kind: 'memorial', label: '外婆的忌日' })

    const bLin = await person(b, 'bLin', '林知夏', { pinned: true })
    await date(b, bLin, 9, 16)
    await imp(b, 'bImport', 5, 'done', null)
  })
  afterAll(async () => dispose?.())

  it('assembles every block for the owner only', async () => {
    const home = await getHome(db, a, { today: TODAY })
    expect(home.isEmpty).toBe(false)
    expect(home.needsOnboarding).toBe(true)
    expect(home.upcoming).toEqual([
      { person: { id: id.lin, label: '林知夏' }, dateId: id.linBirthday, label: '生日', solar: '2026-09-18', lunarLabel: null, days: 3 },
      { person: { id: id.xu, label: '许嘉禾' }, dateId: id.xuAnniv, label: '外婆的忌日', solar: '2026-10-01', lunarLabel: null, days: 16 },
    ])
    expect(home.recentlyUpdated).toEqual([
      { person: { id: id.lin, label: '林知夏' }, latest: { id: id.linNew, statement: 'statement linNew', category: 'work' } },
      { person: { id: id.deng, label: '邓一帆' }, latest: { id: id.dengNew, statement: 'statement dengNew', category: 'work' } },
    ])
    expect(home.pinned).toEqual([{ id: id.lin, label: '林知夏' }])
    expect(home.index.total).toBe(3)
    expect(home.index.groups.map((g) => g.letter)).toEqual(['D', 'L', 'X'])
    expect(home.recentImports.map((r) => r.id)).toEqual([id.recent, id.old5, id.old4, id.old3, id.old2])
    expect(home.recentImports[0]).toMatchObject({ chatTitle: '装修群', dateFrom: '2026-03-02 10:00', status: 'reviewing' })
    expect(() => HomeResponseSchema.parse(home)).not.toThrow()
  })

  it('isolates owners', async () => {
    const home = await getHome(db, b, { today: TODAY })
    expect(home.index.total).toBe(1)
    expect(home.index.groups[0].people[0].id).toBe(id.bLin)
    expect(home.upcoming.map((u) => u.person.id)).toEqual([id.bLin])
    expect(home.recentImports.map((r) => r.id)).toEqual([id.bImport])
    expect(home.recentImports[0].chatTitle).toBeNull()
    expect(home.recentlyUpdated).toEqual([])
  })

  it('empty account: isEmpty until content exists; onboarding flag follows settings', async () => {
    let home = await getHome(db, empty, { today: TODAY })
    expect(home).toMatchObject({ isEmpty: true, needsOnboarding: true, upcoming: [], recentlyUpdated: [], pinned: [], recentImports: [] })
    await updateUserSettings(db, empty, { onboarded: true })
    home = await getHome(db, empty, { today: TODAY })
    expect(home.needsOnboarding).toBe(false)
    await imp(empty, 'onlyMapping', 1, 'mapping', null)
    expect((await getHome(db, empty, { today: TODAY })).isEmpty).toBe(true)
  })

  it('a failing block leaves the others intact', async () => {
    const r = await getHomeBlocks(db, a, { today: TODAY, fail: ['upcoming', 'index'] })
    expect(r.failed).toEqual(['upcoming', 'index'])
    expect(r.blocks.upcoming).toBeNull()
    expect(r.blocks.index).toBeNull()
    expect(r.blocks.pinned).toEqual([{ id: id.lin, label: '林知夏' }])
    expect(r.blocks.recentImports).toHaveLength(5)
    expect(r.isEmpty).toBe(false) // unknown index → never the empty state
    const ok = await getHomeBlocks(db, a, { today: TODAY })
    expect(ok.failed).toEqual([])
    expect(ok.today).toBe(TODAY)
  })

  it('GET /api/home answers the contract for the signed-in user', async () => {
    const app = createTestApp({ db, userId: a })
    const res = await app.request('/api/home')
    expect(res.status).toBe(200)
    const body = HomeResponseSchema.parse(await res.json())
    expect(body.index.total).toBe(3)
    const anon = await createTestApp({ db, userId: null }).request('/api/home')
    expect(anon.status).toBe(401)
  })
})
