import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, createTestUser } from '@/tests/helpers/test-db'
import { ApiError } from '@/server/errors'
import { chats, getOwnedOr404, getUserSettings, owned, updateUserSettings, withOwner, type Db } from '@/server/db'

describe('owner scoping helpers', () => {
  let db: Db
  let dispose: () => Promise<void>
  let alice: { id: string }
  let bob: { id: string }
  let aliceChatId: number

  beforeAll(async () => {
    const t = await createTestDb()
    db = t.db
    dispose = t.dispose
    alice = await createTestUser(db, 'alice@xiaoli.test')
    bob = await createTestUser(db, 'bob@xiaoli.test')
    const [row] = await db
      .insert(chats)
      .values(withOwner<typeof chats>(alice.id, { title: '合成群聊', kind: 'group', note: null }))
      .returning()
    aliceChatId = row.id
    await db.insert(chats).values(withOwner<typeof chats>(bob.id, { title: '合成群聊', kind: 'group', note: null }))
  })
  afterAll(async () => dispose?.())

  it('withOwner stamps ownerId and equal ISO timestamps', () => {
    const row = withOwner<typeof chats>('u1', { title: 't', kind: 'private', note: null }, '2026-09-15T08:00:00.000Z')
    expect(row).toMatchObject({ ownerId: 'u1', createdAt: '2026-09-15T08:00:00.000Z', updatedAt: '2026-09-15T08:00:00.000Z' })
  })

  it('owned() only returns the owner’s rows', async () => {
    const aliceRows = await db.select().from(chats).where(owned(chats, alice.id))
    const bobRows = await db.select().from(chats).where(owned(chats, bob.id))
    expect(aliceRows).toHaveLength(1)
    expect(bobRows).toHaveLength(1)
    expect(aliceRows[0].id).not.toBe(bobRows[0].id)
    const combined = await db.select().from(chats).where(owned(chats, bob.id, eq(chats.id, aliceChatId)))
    expect(combined).toHaveLength(0)
  })

  it('owned() refuses an empty ownerId', () => {
    expect(() => owned(chats, '')).toThrow()
  })

  it('getOwnedOr404 returns own row and 404s for another owner or missing id', async () => {
    await expect(getOwnedOr404(db, chats, alice.id, aliceChatId)).resolves.toMatchObject({ id: aliceChatId, ownerId: alice.id })
    const cross = await getOwnedOr404(db, chats, bob.id, aliceChatId).catch((e) => e)
    expect(cross).toBeInstanceOf(ApiError)
    expect(cross).toMatchObject({ status: 404, code: 'not_found' })
    await expect(getOwnedOr404(db, chats, alice.id, 999_999)).rejects.toMatchObject({ status: 404 })
  })

  it('settings default without a row, extractModel stays null, per-owner isolation', async () => {
    expect(await getUserSettings(db, alice.id)).toEqual({
      selfDisplayNames: [],
      extractModel: null,
      highConfidenceThreshold: 0.8,
      onboardedAt: null,
    })
    const s = await updateUserSettings(db, alice.id, { selfDisplayNames: ['合成名 ', '合成名'], onboarded: true })
    expect(s.selfDisplayNames).toEqual(['合成名'])
    expect(s.onboardedAt).not.toBeNull()
    expect(s.extractModel).toBeNull()
    const again = await updateUserSettings(db, alice.id, { extractModel: 'deepseek-v4-pro' })
    expect(again.onboardedAt).toBe(s.onboardedAt)
    expect((await updateUserSettings(db, alice.id, { extractModel: null })).extractModel).toBeNull()
    expect((await getUserSettings(db, bob.id)).selfDisplayNames).toEqual([])
  })
})
