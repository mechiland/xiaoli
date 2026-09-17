import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HomeResponseSchema, type LoopKind } from '@/contracts'
import { importantDates, loops, persons, withOwner, type Db } from '@/server/db'
import { closeLoop, reopenLoop } from '@/server/interaction'
import { createTestDb, createTestUser } from '~/tests/helpers/test-db'
import { getHome } from './queries'

const TODAY = '2026-12-27'
const NOW = '2026-12-26T08:00:00.000Z'

describe('dated matters on the home page', () => {
  let db: Db
  let dispose: () => Promise<void>
  let ownerId: string
  let requestId: number

  beforeAll(async () => {
    const test = await createTestDb()
    db = test.db
    dispose = test.dispose
    ownerId = (await createTestUser(db, 'tasks@xiaoli.test')).id
    const otherId = (await createTestUser(db, 'other-tasks@xiaoli.test')).id
    const [teacher] = await db.insert(persons).values(withOwner<typeof persons>(ownerId, { label: '郑老师', labelSort: 'zheng', pinned: true }, NOW)).returning()
    const [other] = await db.insert(persons).values(withOwner<typeof persons>(otherId, { label: '别人的老师', labelSort: 'bie' }, NOW)).returning()
    await db.insert(importantDates).values(withOwner<typeof importantDates>(ownerId, { personId: teacher.id, kind: 'birthday', calendar: 'solar', month: 1, day: 2, status: 'confirmed', sourceKind: 'manual' }, NOW))
    const add = async (kind: LoopKind, text: string, dueAt: string | null, extra: Partial<typeof loops.$inferInsert> = {}) => {
      const [row] = await db.insert(loops).values(withOwner<typeof loops>(ownerId, {
        personId: teacher.id, kind, direction: 'mine', text, textNorm: text, dueAt, openedAt: '2026-12-26 16:00', status: 'confirmed', sourceKind: 'manual', ...extra,
      }, NOW)).returning()
      return row.id
    }
    requestId = await add('request', '提交孩子的观察报告', '2026-12-28', { status: 'proposed' })
    await add('promise', '发简历', '2027-01-03')
    await add('question', '回复参加人数', '2027-01-26')
    await add('plan', '参加家长会', '2027-01-04')
    await add('request', '本月交回执', '2026-12')
    await add('request', '过期', '2026-12-26')
    await add('request', '31天后', '2027-01-27')
    await add('request', '未定日期', null)
    await add('request', '只有年份', '2027')
    await add('request', '已完成', '2026-12-28', { closedReason: 'done', closedAt: NOW })
    await add('request', '不再有效', '2026-12-28', { status: 'superseded' })
    await add('request', '已拒绝', '2026-12-28', { status: 'rejected' })
    await add('request', '其他用户的事情', '2026-12-28', { ownerId: otherId, personId: other.id })
  })
  afterAll(async () => dispose?.())

  it('mixes birthdays with all dated action types using the same supplied today across the year boundary', async () => {
    const home = await getHome(db, ownerId, { today: TODAY })
    expect(HomeResponseSchema.safeParse(home).success).toBe(true)
    expect(home.upcoming.map((row) => [row.label, row.days])).toEqual([
      ['提交孩子的观察报告', 1], ['本月交回执', 4], ['生日', 6], ['发简历', 7], ['参加家长会', 8], ['回复参加人数', 30],
    ])
    expect(home.upcoming[0]).toMatchObject({ kind: 'loop', loopKind: 'request', direction: 'mine', status: 'proposed' })
    expect(home.upcoming[1].dueAt).toBe('2026-12')
  })

  it('a completed request disappears and undo restores the same item', async () => {
    await closeLoop(db, ownerId, requestId, 'done')
    expect((await getHome(db, ownerId, { today: TODAY })).upcoming.some((row) => row.loopId === requestId)).toBe(false)
    await reopenLoop(db, ownerId, requestId)
    expect((await getHome(db, ownerId, { today: TODAY })).upcoming.find((row) => row.loopId === requestId)).toMatchObject({ label: '提交孩子的观察报告', status: 'confirmed' })
  })
})
