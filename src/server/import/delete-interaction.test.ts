// Delete-import, interaction layer (SPEC §7 删除语义, ARCHITECTURE §11 step 7, milestone M7).
// A segment whose span is emptied goes; one that only loses part of its messages is recomputed; and every loop the
// deleted import had closed is open again, because the sentence that closed it is gone.
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  chats,
  conversationSegments,
  evidence,
  handles,
  importMessages,
  imports,
  loops,
  messages,
  owned,
  persons,
  segmentParticipants,
  withOwner,
  withOwnerLink,
  type Db,
} from '@/server/db'
import { createTestDb, createTestUser } from '~/tests/helpers/test-db'
import { deleteImport } from './delete'

const EMPTY_STATS = { byKind: {}, bySender: {}, images: { count: 0, bytes: 0 }, videos: { count: 0, bytes: 0 } }
const ins = async <T extends { id: number }>(q: Promise<T[]>): Promise<T> => (await q)[0]

/**
 * Two imports of one chat, no overlap: A brings messages 1–4, B brings 5–6.
 *  - segFull   spans only B's messages and has no evidence at all → the span empties, so it goes.
 *  - segPart   spans 3–6, evidence on a surviving message and on one of B's → kept, recomputed.
 *  - segEvid   spans only A's messages but every evidence row sits on a B message → goes (§11 step 7).
 *  - loopClosed was opened by A and closed by B → reopened.
 *  - loopOnlyB has evidence only on B messages → deleted like any derived item.
 *  - loopMixed has evidence on both → kept, the B evidence row detached.
 */
async function seed(db: Db, ownerId: string, tag: string) {
  const chat = await ins(db.insert(chats).values(withOwner<typeof chats>(ownerId, { title: `聊天${tag}`, kind: 'group', note: null })).returning())
  const imp = (name: string) =>
    ins(
      db
        .insert(imports)
        .values(
          withOwner<typeof imports>(ownerId, {
            chatId: chat.id,
            fileName: `${name}.zip`,
            fileSha256: `sha-${tag}-${name}-${Math.random()}`,
            exportedAt: null,
            parserVersion: 't',
            status: 'done',
            messageCount: 3,
            newMessageCount: 3,
            dateFrom: null,
            dateTo: null,
            stats: EMPTY_STATS,
            error: null,
          }),
        )
        .returning(),
    )
  const a = await imp('a')
  const b = await imp('b')

  const person = (label: string) =>
    ins(db.insert(persons).values(withOwner<typeof persons>(ownerId, { label, labelSort: label, isSelf: false, pinned: false, mergedIntoId: null, importId: null })).returning())
  const p1 = await person(`甲${tag}`)
  const p2 = await person(`乙${tag}`)
  const handle = (personId: number, value: string) =>
    ins(
      db
        .insert(handles)
        .values(withOwner<typeof handles>(ownerId, { personId, kind: 'display_group', value, valueNorm: value, chatId: chat.id, status: 'confirmed', importId: null, sourceKind: 'manual' }))
        .returning(),
    )
  const h1 = await handle(p1.id, `甲${tag}名`)
  const h2 = await handle(p2.id, `乙${tag}名`)

  const msg = async (n: number, h: { id: number; value: string }, importId: number) => {
    const m = await ins(
      db
        .insert(messages)
        .values(
          withOwner<typeof messages>(ownerId, {
            chatId: chat.id,
            firstImportId: importId,
            senderHandleId: h.id,
            senderName: h.value,
            sentAt: `2026-09-0${n} 10:0${n}`,
            seq: n * 1024,
            kind: 'text',
            body: `消息${n}`,
            meta: null,
            fingerprint: `fp-${tag}-${n}`,
          }),
        )
        .returning(),
    )
    await db.insert(importMessages).values(withOwnerLink<typeof importMessages>(ownerId, { importId, messageId: m.id }))
    return m
  }
  const m1 = await msg(1, h1, a.id)
  const m2 = await msg(2, h2, a.id)
  const m3 = await msg(3, h1, a.id)
  const m4 = await msg(4, h1, a.id)
  const m5 = await msg(5, h2, b.id)
  const m6 = await msg(6, h2, b.id)

  const seg = (startSeq: number, endSeq: number, startedAt: string, endedAt: string, messageCount: number, summary: string, importId: number) =>
    ins(
      db
        .insert(conversationSegments)
        .values({
          ownerId,
          createdAt: '2026-09-10T00:00:00.000Z',
          updatedAt: '2026-09-10T00:00:00.000Z',
          chatId: chat.id,
          startSeq,
          endSeq,
          startedAt,
          endedAt,
          messageCount,
          summary,
          summaryNorm: summary,
          topics: '[]',
          hidden: false,
          importId,
          jobId: null,
          sourceKind: 'ai',
        })
        .returning(),
    )
  const segFull = await seg(m5.seq, m6.seq, m5.sentAt, m6.sentAt, 2, '只在第二份记录里的一段', b.id)
  const segPart = await seg(m3.seq, m6.seq, m3.sentAt, m6.sentAt, 4, '跨两份记录的一段', a.id)
  const segEvid = await seg(m1.seq, m4.seq, m1.sentAt, m4.sentAt, 4, '证据全在第二份记录里的一段', a.id)

  const part = (segmentId: number, personId: number, messageCount: number) =>
    db.insert(segmentParticipants).values({ ownerId, createdAt: '2026-09-10T00:00:00.000Z', segmentId, personId, messageCount })
  await part(segFull.id, p2.id, 2)
  await part(segPart.id, p1.id, 2)
  await part(segPart.id, p2.id, 2)
  await part(segEvid.id, p1.id, 3)
  await part(segEvid.id, p2.id, 1)

  const loop = (personId: number, text: string, importId: number, extra: Partial<typeof loops.$inferInsert> = {}) =>
    ins(
      db
        .insert(loops)
        .values({
          ownerId,
          createdAt: '2026-09-10T00:00:00.000Z',
          updatedAt: '2026-09-10T00:00:00.000Z',
          personId,
          direction: 'mine',
          kind: 'promise',
          text,
          textNorm: text,
          dueAt: null,
          openedMessageId: m1.id,
          openedAt: m1.sentAt,
          closedMessageId: null,
          closedAt: null,
          closedReason: null,
          status: 'confirmed',
          importId,
          jobId: null,
          sourceKind: 'ai',
          ...extra,
        })
        .returning(),
    )
  const loopClosed = await loop(p1.id, '你答应帮她看简历', a.id, { closedMessageId: m5.id, closedAt: m5.sentAt, closedReason: 'done' })
  const loopOnlyB = await loop(p2.id, '只在第二份记录里的承诺', b.id, { openedMessageId: m5.id, openedAt: m5.sentAt })
  const loopMixed = await loop(p1.id, '两份记录都有证据的承诺', a.id)

  const ev = (targetType: 'loop' | 'segment', targetId: number, messageId: number) =>
    db.insert(evidence).values(withOwnerLink<typeof evidence>(ownerId, { targetType, targetId, messageId }))
  await ev('loop', loopClosed.id, m1.id)
  await ev('loop', loopOnlyB.id, m5.id)
  await ev('loop', loopMixed.id, m1.id)
  await ev('loop', loopMixed.id, m5.id)
  await ev('segment', segPart.id, m3.id)
  await ev('segment', segPart.id, m5.id)
  await ev('segment', segEvid.id, m5.id)

  return { chat, a, b, p1, p2, m1, m2, m3, m4, m5, m6, segFull, segPart, segEvid, loopClosed, loopOnlyB, loopMixed }
}

type Seed = Awaited<ReturnType<typeof seed>>

describe('deleteImport: interaction layer (SPEC §7 删除语义)', () => {
  let db: Db
  let r2: R2Bucket
  let dispose: () => Promise<void>
  let uid: string
  let w: Seed

  beforeAll(async () => {
    const t = await createTestDb()
    db = t.db
    r2 = t.r2
    dispose = t.dispose
  })
  afterAll(async () => dispose?.())
  beforeEach(async () => {
    uid = (await createTestUser(db, `d${Math.random()}@xiaoli.test`)).id
    w = await seed(db, uid, `t${Math.random().toString(36).slice(2, 6)}`)
  })

  const loopRow = (ownerId: string, id: number) => db.select().from(loops).where(owned(loops, ownerId, eq(loops.id, id))).get()
  const segRow = (ownerId: string, id: number) => db.select().from(conversationSegments).where(owned(conversationSegments, ownerId, eq(conversationSegments.id, id))).get()
  const partsOf = (ownerId: string, segmentId: number) =>
    db.select().from(segmentParticipants).where(owned(segmentParticipants, ownerId, eq(segmentParticipants.segmentId, segmentId)))
  const evOf = (ownerId: string, targetType: 'loop' | 'segment', targetId: number) =>
    db.select().from(evidence).where(owned(evidence, ownerId, eq(evidence.targetType, targetType), eq(evidence.targetId, targetId)))

  it('reopens every loop the deleted import had closed (M7)', async () => {
    expect(await loopRow(uid, w.loopClosed.id)).toMatchObject({ closedMessageId: w.m5.id, closedReason: 'done' })
    await deleteImport(db, r2, uid, w.b.id)
    expect(await loopRow(uid, w.loopClosed.id)).toMatchObject({ closedMessageId: null, closedAt: null, closedReason: null })
  })

  it('a loop closed by hand is left alone, and a loop closed by an import that stays is left alone', async () => {
    const byHand = await loopRow(uid, w.loopMixed.id)
    await db
      .update(loops)
      .set({ closedMessageId: null, closedAt: '2026-09-11T08:00:00.000Z', closedReason: 'dropped' })
      .where(owned(loops, uid, eq(loops.id, byHand!.id)))
    await deleteImport(db, r2, uid, w.b.id)
    expect(await loopRow(uid, w.loopMixed.id)).toMatchObject({ closedMessageId: null, closedAt: '2026-09-11T08:00:00.000Z', closedReason: 'dropped' })
  })

  it('loops follow the normal derived-item rule: only-M goes, mixed keeps its surviving evidence', async () => {
    const res = await deleteImport(db, r2, uid, w.b.id)
    expect(res.deletedItems.loop).toBe(1)
    expect(await loopRow(uid, w.loopOnlyB.id)).toBeUndefined()
    expect(await evOf(uid, 'loop', w.loopOnlyB.id)).toEqual([])
    expect(await loopRow(uid, w.loopMixed.id)).toBeDefined()
    expect((await evOf(uid, 'loop', w.loopMixed.id)).map((e) => e.messageId)).toEqual([w.m1.id])
  })

  it('a segment that loses only part of its messages is kept with message_count / started_at / ended_at recomputed', async () => {
    await deleteImport(db, r2, uid, w.b.id)
    expect(await segRow(uid, w.segPart.id)).toMatchObject({
      messageCount: 2,
      startedAt: w.m3.sentAt,
      endedAt: w.m4.sentAt,
      summary: '跨两份记录的一段',
    })
    // the evidence that pointed at a deleted message is gone, the rest stays
    expect((await evOf(uid, 'segment', w.segPart.id)).map((e) => e.messageId)).toEqual([w.m3.id])
  })

  it('a segment whose span is emptied is deleted with its participants and evidence', async () => {
    const res = await deleteImport(db, r2, uid, w.b.id)
    expect(await segRow(uid, w.segFull.id)).toBeUndefined()
    expect(await partsOf(uid, w.segFull.id)).toEqual([])
    // segFull (span emptied) + segEvid (every evidence message in M)
    expect(res.deletedItems.segment).toBe(2)
    expect(await segRow(uid, w.segEvid.id)).toBeUndefined()
    expect(await partsOf(uid, w.segEvid.id)).toEqual([])
    expect(await evOf(uid, 'segment', w.segEvid.id)).toEqual([])
  })

  it('drops segment_participants for persons with no message left in the segment, and recounts the rest', async () => {
    await deleteImport(db, r2, uid, w.b.id)
    const parts = await partsOf(uid, w.segPart.id)
    expect(parts.map((p) => [p.personId, p.messageCount])).toEqual([[w.p1.id, 2]])
    // 乙 only ever spoke in the deleted messages, so they are not a participant of that conversation any more
    expect(parts.some((p) => p.personId === w.p2.id)).toBe(false)
  })

  it('deleting the first import instead leaves the second one coherent', async () => {
    await deleteImport(db, r2, uid, w.a.id)
    // segPart now only holds B's messages
    expect(await segRow(uid, w.segPart.id)).toMatchObject({ messageCount: 2, startedAt: w.m5.sentAt, endedAt: w.m6.sentAt })
    // segEvid spanned only A's messages → empty now
    expect(await segRow(uid, w.segEvid.id)).toBeUndefined()
    expect(await segRow(uid, w.segFull.id)).toMatchObject({ messageCount: 2 })
    // the loop was closed by a message of B, which is still here
    expect(await loopRow(uid, w.loopClosed.id)).toBeUndefined() // opened + evidenced only by A
    expect(await loopRow(uid, w.loopOnlyB.id)).toMatchObject({ closedMessageId: null })
  })

  it('two accounts: deleting my import never touches another account s loops or segments', async () => {
    const bob = await createTestUser(db, `db${Math.random()}@xiaoli.test`)
    const bw = await seed(db, bob.id, `b${Math.random().toString(36).slice(2, 6)}`)

    await expect(deleteImport(db, r2, bob.id, w.b.id)).rejects.toMatchObject({ status: 404 })
    await deleteImport(db, r2, uid, w.b.id)

    expect(await loopRow(bob.id, bw.loopClosed.id)).toMatchObject({ closedMessageId: bw.m5.id, closedReason: 'done' })
    expect(await loopRow(bob.id, bw.loopOnlyB.id)).toBeDefined()
    expect(await segRow(bob.id, bw.segFull.id)).toMatchObject({ messageCount: 2 })
    expect(await segRow(bob.id, bw.segPart.id)).toMatchObject({ messageCount: 4, startedAt: bw.m3.sentAt, endedAt: bw.m6.sentAt })
    expect((await partsOf(bob.id, bw.segPart.id)).length).toBe(2)
    expect((await evOf(bob.id, 'segment', bw.segEvid.id)).length).toBe(1)
    expect((await db.select().from(messages).where(owned(messages, bob.id, eq(messages.chatId, bw.chat.id)))).length).toBe(6)
  })
})
