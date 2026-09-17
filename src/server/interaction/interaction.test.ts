import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ImportInteractionResponse, InteractionResponse, LoopDTO, SegmentDTO } from '@/contracts'
import { todayInTz } from '@/lib/time'
import {
  chats,
  conversationSegments,
  evidence,
  handles,
  imports,
  loops,
  messages,
  persons,
  segmentParticipants,
  withOwner,
  type Db,
} from '@/server/db'
import { createTestApp, createTestDb, createTestUser } from '~/tests/helpers/test-db'
import { getImportInteraction, getPersonInteraction } from './read'
import { searchInteraction } from './search'
import { getUpcomingPlans } from './upcoming'
import { closeLoop, patchSegment, reopenLoop } from './write'

// Synthetic world (fictional names only).
const STATS = { byKind: {}, bySender: {}, images: { count: 0, bytes: 0 }, videos: { count: 0, bytes: 0 } }
const NOW = '2026-09-01T00:00:00.000Z'
const stamp = (ownerId: string) => ({ ownerId, createdAt: NOW, updatedAt: NOW })

let db: Db
let dispose: () => Promise<void>
let owner: { id: string }
let other: { id: string }
let world: Awaited<ReturnType<typeof buildWorld>>

function dayOffset(days: number): string {
  const [y, m, d] = todayInTz().split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return t.toISOString().slice(0, 10)
}

async function buildWorld(ownerId: string, tag: string) {
  const one = async <T>(q: Promise<T[]>) => (await q)[0]
  const priv = await one(db.insert(chats).values({ ...stamp(ownerId), title: `私聊-${tag}`, kind: 'private', note: null }).returning())
  const group = await one(db.insert(chats).values({ ...stamp(ownerId), title: `群-${tag}`, kind: 'group', note: null }).returning())
  const mkImport = (chatId: number, sha: string) =>
    one(
      db
        .insert(imports)
        .values({ ...stamp(ownerId), chatId, fileName: `${sha}.zip`, fileSha256: sha, exportedAt: null, parserVersion: 't', status: 'reviewing', messageCount: 10, newMessageCount: 10, dateFrom: null, dateTo: null, stats: STATS, error: null })
        .returning(),
    )
  const impA = await mkImport(priv.id, `sha-a-${tag}`)
  const impB = await mkImport(priv.id, `sha-b-${tag}`)

  const person = (label: string, isSelf = false) =>
    one(db.insert(persons).values({ ...stamp(ownerId), label, labelSort: label, isSelf, pinned: false, mergedIntoId: null, importId: null, avatarR2Key: null, lastMessageAt: null }).returning())
  const self = await person('我', true)
  const her = await person(`林知夏-${tag}`)
  const him = await person(`许嘉禾-${tag}`)

  const handle = (personId: number, value: string, chatId: number) =>
    one(db.insert(handles).values({ ...stamp(ownerId), personId, kind: 'display_private', value, valueNorm: value, chatId, status: 'confirmed', importId: null, sourceKind: 'manual' }).returning())
  const hSelf = await handle(self.id, `我是小丽-${tag}`, priv.id)
  const hHer = await handle(her.id, `夏夏-${tag}`, priv.id)

  const msg = (chatId: number, seq: number, h: { id: number; value: string }, sentAt: string, importId: number) =>
    one(
      db
        .insert(messages)
        .values({ ...stamp(ownerId), chatId, firstImportId: importId, senderHandleId: h.id, senderName: h.value, sentAt, seq, kind: 'text', body: '消息', meta: null, fingerprint: `fp-${tag}-${chatId}-${seq}` })
        .returning(),
    )

  const segment = async (
    chatId: number,
    startSeq: number,
    startedAt: string,
    endedAt: string,
    summary: string,
    opts: { importId?: number; topics?: string[]; participants?: number[]; messageCount?: number; hidden?: boolean } = {},
  ) => {
    const row = await one(
      db
        .insert(conversationSegments)
        .values({
          ...stamp(ownerId),
          chatId,
          startSeq,
          endSeq: startSeq + 512,
          startedAt,
          endedAt,
          messageCount: opts.messageCount ?? 12,
          summary,
          summaryNorm: summary.toLowerCase(),
          topics: JSON.stringify(opts.topics ?? []),
          hidden: opts.hidden ?? false,
          importId: opts.importId ?? null,
          jobId: null,
          sourceKind: 'ai',
        })
        .returning(),
    )
    for (const p of opts.participants ?? [self.id, her.id]) {
      await db.insert(segmentParticipants).values({ ownerId, createdAt: NOW, segmentId: row.id, personId: p, messageCount: 6 })
    }
    return row
  }

  // private chat: five conversations, the last two 2.5 h apart so they merge into one
  const days = ['2026-08-16', '2026-08-26', '2026-09-01', '2026-09-09', '2026-09-13']
  let seq = 1024
  let anyMessageId = 0
  const segs: { id: number }[] = []
  for (const [i, d] of days.entries()) {
    const starter = i % 2 === 0 ? hHer : hSelf
    const m = await msg(priv.id, seq, starter, `${d} 10:00`, impA.id)
    anyMessageId ||= m.id
    segs.push(await segment(priv.id, seq, `${d} 10:00`, `${d} 11:00`, `${d} 聊了搬家`, { importId: impA.id, topics: ['搬家', '孩子择校'] }))
    seq += 1024
  }
  // second import fills a later slot in the same day as the last conversation (2 h gap → same conversation)
  await msg(priv.id, seq, hSelf, '2026-09-13 13:00', impB.id)
  const drifted = await segment(priv.id, seq, '2026-09-13 13:00', '2026-09-13 13:30', '2026-09-13 接着聊装修排期', { importId: impB.id, topics: ['装修'] })
  seq += 1024

  // group chat conversation (participants include him)
  await msg(group.id, seq, hHer, '2026-09-10 20:00', impA.id)
  const groupSeg = await segment(group.id, seq, '2026-09-10 20:00', '2026-09-10 21:00', '群里约了周末看展', { importId: impA.id, topics: ['看展'], participants: [self.id, her.id, him.id] })

  const mkLoop = ({ text, ...opts }: Partial<typeof loops.$inferInsert> & { text: string }) =>
    one(
      db
        .insert(loops)
        .values({
          ...stamp(ownerId),
          personId: her.id,
          direction: 'mine',
          kind: 'promise',
          text,
          textNorm: text.toLowerCase(),
          dueAt: null,
          openedMessageId: null,
          openedAt: '2026-09-01 10:00',
          closedMessageId: null,
          closedAt: null,
          closedReason: null,
          status: 'confirmed',
          importId: impA.id,
          jobId: null,
          sourceKind: 'ai',
          ...opts,
        })
        .returning(),
    )
  const openLoop = await mkLoop({ text: '你答应帮她看简历' })
  const proposedLoop = await mkLoop({ text: '她问你国庆有没有空', direction: 'theirs', kind: 'question', status: 'proposed', openedAt: '2026-09-09 21:00' })
  const expiredLoop = await mkLoop({ text: '你答应把老照片扫描给她', openedAt: '2026-01-05 09:00' })
  const doneLoop = await mkLoop({ text: '你答应寄茶叶', closedMessageId: null, closedReason: 'done', closedAt: '2026-09-10 12:00' })
  const rejectedLoop = await mkLoop({ text: '这条是误抽的', status: 'rejected' })
  const planLoop = await mkLoop({ text: '一起去看陶瓷展', kind: 'plan', direction: 'mutual', dueAt: dayOffset(9) })
  const farPlan = await mkLoop({ text: '明年春天回汉中', kind: 'plan', direction: 'mutual', dueAt: dayOffset(200) })
  const pastPlan = await mkLoop({ text: '上个月就该去的展', kind: 'plan', direction: 'mutual', dueAt: dayOffset(-40) })

  await db.insert(evidence).values({ ownerId, createdAt: NOW, targetType: 'loop', targetId: openLoop.id, messageId: anyMessageId }).onConflictDoNothing()

  return { priv, group, impA, impB, self, her, him, segs, drifted, groupSeg, openLoop, proposedLoop, expiredLoop, doneLoop, rejectedLoop, planLoop, farPlan, pastPlan }
}

beforeAll(async () => {
  const t = await createTestDb()
  db = t.db
  dispose = t.dispose
  owner = await createTestUser(db, 'seed@xiaoli.test')
  other = await createTestUser(db, 'seed2@xiaoli.test')
  world = await buildWorld(owner.id, 'a')
  await buildWorld(other.id, 'b')
})
afterAll(async () => {
  await dispose()
})

describe('getPersonInteraction', () => {
  it('groups segments into conversations, newest first, and pages the timeline', async () => {
    const r = await getPersonInteraction(db, owner.id, world.her.id)
    expect(r.conversations[0].startedAt).toBe('2026-09-13 10:00')
    // boundary drift: the second import's segment joined the 9-13 conversation instead of starting a new one
    expect(r.conversations[0].segments.map((s) => s.summary)).toEqual(['2026-09-13 聊了搬家', '2026-09-13 接着聊装修排期'])
    expect(r.conversations[0].messageCount).toBe(24)
    expect(r.conversations[0].topics).toEqual(['搬家', '孩子择校', '装修'])
    expect(r.conversations).toHaveLength(5)
    expect(r.hasMore).toBe(true)

    const all = await getPersonInteraction(db, owner.id, world.her.id, { timeline: 'all' })
    expect(all.conversations).toHaveLength(6) // 5 private + 1 group
    expect(all.hasMore).toBe(false)
    expect(all.conversations.some((c) => c.chatKind === 'group')).toBe(true)
  })

  it('links each segment to its first message and its participants', async () => {
    const r = await getPersonInteraction(db, owner.id, world.her.id)
    const s: SegmentDTO = r.conversations[0].segments[0]
    expect(s.firstMessageId).not.toBeNull()
    const m = await db.select().from(messages).where(eq(messages.id, s.firstMessageId!)).get()
    expect(m?.seq).toBe(s.startSeq)
    expect(s.participants.map((p) => p.id).sort()).toEqual([world.self.id, world.her.id].sort())
  })

  it('derives the rhythm and never stores it', async () => {
    const r = await getPersonInteraction(db, owner.id, world.her.id)
    expect(r.rhythm.conversationCount).toBe(6)
    expect(r.rhythm.lastAt).toBe('2026-09-13 13:30')
    expect(r.rhythm.medianGapDays).not.toBeNull()
    // private conversations only: 3 started by her, 2 by me (the group one does not count)
    expect(r.rhythm.initiatedByMe).toBe(2)
    expect(r.rhythm.initiatedByThem).toBe(3)
    expect(r.rhythm.privateOnly).toBe(false)
    expect(Object.keys(conversationSegments)).not.toContain('rhythm')
  })

  it('splits loops by their close event, oldest first, and drops rejected ones', async () => {
    const r = await getPersonInteraction(db, owner.id, world.her.id)
    const open = r.loops.map((l) => l.text)
    // oldest first; expired rows keep their place in that order (SPEC §9.5: never reordered)
    expect(open).toEqual(['你答应把老照片扫描给她', '你答应帮她看简历', '一起去看陶瓷展', '明年春天回汉中', '上个月就该去的展', '她问你国庆有没有空'])
    expect(r.loops.every((l) => l.state === 'open')).toBe(true)
    expect(r.loops.find((l) => l.text === '你答应把老照片扫描给她')!.expired).toBe(true)
    expect(r.loops.find((l) => l.text === '你答应帮她看简历')!.evidenceCount).toBe(1)
    expect(r.closed.map((l) => l.text)).toEqual(['你答应寄茶叶'])
    expect(r.closed[0].state).toBe('done')
    expect(open).not.toContain('这条是误抽的')
  })

  it('reports nothing for a person with no interaction, and 404s for a stranger id', async () => {
    const r = await getPersonInteraction(db, owner.id, world.him.id, { timeline: 'all' })
    expect(r.loops).toEqual([])
    expect(r.conversations).toHaveLength(1) // the group conversation he spoke in
    expect(r.rhythm.medianGapDays).toBeNull()
    await expect(getPersonInteraction(db, owner.id, 99_999_999)).rejects.toMatchObject({ status: 404 })
  })

  it('never crosses accounts', async () => {
    await expect(getPersonInteraction(db, other.id, world.her.id)).rejects.toMatchObject({ status: 404 })
    const mine = await getPersonInteraction(db, owner.id, world.her.id, { timeline: 'all' })
    const theirsSameId = await getPersonInteraction(db, other.id, world.her.id + 1).catch(() => null)
    expect(mine.conversations.every((c) => c.chatTitle.endsWith('-a'))).toBe(true)
    if (theirsSameId) expect(theirsSameId.conversations.every((c) => c.chatTitle.endsWith('-b'))).toBe(true)
  })
})

describe('getImportInteraction', () => {
  it('returns whole conversations the import touched, newest first', async () => {
    const r: ImportInteractionResponse = await getImportInteraction(db, owner.id, world.impB.id)
    expect(r.conversations).toHaveLength(1)
    // the conversation carries the older import's segment too — that is what "the same conversation" means
    expect(r.conversations[0].segments.map((s) => s.importId)).toEqual([world.impA.id, world.impB.id])
  })

  it('is empty when the import produced no segments, and owner-scoped', async () => {
    const empty = await db
      .insert(imports)
      .values({ ...stamp(owner.id), chatId: world.priv.id, fileName: 'x.zip', fileSha256: 'sha-empty', exportedAt: null, parserVersion: 't', status: 'reviewing', messageCount: 0, newMessageCount: 0, dateFrom: null, dateTo: null, stats: STATS, error: null })
      .returning()
    expect((await getImportInteraction(db, owner.id, empty[0].id)).conversations).toEqual([])
    await expect(getImportInteraction(db, other.id, world.impB.id)).rejects.toMatchObject({ status: 404 })
  })
})

describe('write side', () => {
  it('closing confirms, leaves closedMessageId null, and reopening undoes it', async () => {
    const closed: LoopDTO = await closeLoop(db, owner.id, world.proposedLoop.id, 'done')
    expect(closed.state).toBe('done')
    expect(closed.status).toBe('confirmed')
    expect(closed.closedMessageId).toBeNull()
    expect(closed.closedAt).not.toBeNull()

    const reopened = await reopenLoop(db, owner.id, world.proposedLoop.id)
    expect(reopened.state).toBe('open')
    expect(reopened.closedAt).toBeNull()
    expect(reopened.closedReason).toBeNull()
    expect(reopened.status).toBe('confirmed') // confirming is not undone by reopening
    await db.update(loops).set({ status: 'proposed' }).where(eq(loops.id, world.proposedLoop.id))
  })

  it('"不用管" is a close too', async () => {
    const dropped = await closeLoop(db, owner.id, world.expiredLoop.id, 'dropped')
    expect(dropped.state).toBe('dropped')
    expect(dropped.expired).toBe(false)
    await reopenLoop(db, owner.id, world.expiredLoop.id)
  })

  it('rejects another account and unknown ids', async () => {
    await expect(closeLoop(db, other.id, world.openLoop.id, 'done')).rejects.toMatchObject({ status: 404 })
    await expect(reopenLoop(db, other.id, world.openLoop.id)).rejects.toMatchObject({ status: 404 })
    await expect(patchSegment(db, other.id, world.drifted.id, { hidden: true })).rejects.toMatchObject({ status: 404 })
  })

  it('editing a summary makes the segment manual; hiding keeps it out of the person timeline', async () => {
    const edited = await patchSegment(db, owner.id, world.drifted.id, { summary: '接着聊装修排期和预算' })
    expect(edited.summary).toBe('接着聊装修排期和预算')
    expect(edited.sourceKind).toBe('manual')

    await patchSegment(db, owner.id, world.drifted.id, { hidden: true })
    const r = await getPersonInteraction(db, owner.id, world.her.id)
    expect(r.conversations[0].segments.map((s) => s.id)).not.toContain(world.drifted.id)
    // the conversation itself is unchanged: hiding a summary does not rewrite what happened
    expect(r.conversations[0].messageCount).toBe(24)
    // the import page still shows it so hiding can be undone
    const imp = await getImportInteraction(db, owner.id, world.impB.id)
    expect(imp.conversations[0].segments.find((s) => s.id === world.drifted.id)?.hidden).toBe(true)
    await patchSegment(db, owner.id, world.drifted.id, { hidden: false })
  })
})

describe('getUpcomingPlans', () => {
  it('returns only open, dated plans inside the window, in date order', async () => {
    const plans = await getUpcomingPlans(db, owner.id, 30)
    expect(plans.map((p) => p.label)).toEqual(['一起去看陶瓷展'])
    expect(plans[0].days).toBe(9)
    expect(plans[0].person.id).toBe(world.her.id)
    // the other account has its own identical world and sees only its own rows
    const theirs = await getUpcomingPlans(db, other.id, 30)
    expect(theirs.every((p) => p.person.label.endsWith('-b'))).toBe(true)
    expect(plans.every((p) => p.person.label.endsWith('-a'))).toBe(true)

    const wide = await getUpcomingPlans(db, owner.id, 365)
    expect(wide.map((p) => p.label)).toEqual(['一起去看陶瓷展', '明年春天回汉中'])
  })

  it('a closed plan leaves the list', async () => {
    await closeLoop(db, owner.id, world.planLoop.id, 'done')
    expect(await getUpcomingPlans(db, owner.id, 30)).toHaveLength(0)
    await reopenLoop(db, owner.id, world.planLoop.id)
    expect(await getUpcomingPlans(db, owner.id, 30)).toHaveLength(1)
  })
})

describe('searchInteraction', () => {
  it('matches segment summaries, topic words and loop text, newest first', async () => {
    const hits = await searchInteraction(db, owner.id, '装修', 20)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].kind).toBe('segment')
    expect(hits[0].href).toMatch(/^\/chats\/\d+\?at=\d+$/)
    expect(hits[0].highlights.length).toBeGreaterThan(0)

    const loopHits = await searchInteraction(db, owner.id, '简历', 20)
    expect(loopHits.map((h) => h.kind)).toEqual(['loop'])
    expect(loopHits[0].href).toBe(`/p/${world.her.id}#loop-${world.openLoop.id}`)
    expect(loopHits[0].person?.id).toBe(world.her.id)
  })

  it('finds a topic word that is not in the summary', async () => {
    const hits = await searchInteraction(db, owner.id, '孩子择校', 20)
    expect(hits.every((h) => h.kind === 'segment')).toBe(true)
    expect(hits.length).toBeGreaterThan(0)
  })

  it('is empty for another account and for a blank query', async () => {
    // the other account has an identical world: it sees only its own rows, never ours
    const theirs = await searchInteraction(db, other.id, '简历', 20)
    expect(theirs.every((h) => h.person?.label.endsWith('-b'))).toBe(true)
    expect(theirs.some((h) => h.person?.id === world.her.id)).toBe(false)
    expect(await searchInteraction(db, owner.id, '   ', 20)).toEqual([])
  })
})

describe('routes', () => {
  it('serves the five interaction routes and rejects another account', async () => {
    const app = createTestApp({ db, userId: owner.id })
    const r = await app.request(`/api/people/${world.her.id}/interaction?timeline=2`)
    expect(r.status).toBe(200)
    const body = (await r.json()) as InteractionResponse
    expect(body.conversations).toHaveLength(2)
    expect(body.hasMore).toBe(true)

    expect((await app.request(`/api/imports/${world.impB.id}/interaction`)).status).toBe(200)

    const close = await app.request(`/api/loops/${world.openLoop.id}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'done' }),
    })
    expect(close.status).toBe(200)
    expect(((await close.json()) as { loop: LoopDTO }).loop.state).toBe('done')

    const reopen = await app.request(`/api/loops/${world.openLoop.id}/reopen`, { method: 'POST' })
    expect(reopen.status).toBe(200)

    const patch = await app.request(`/api/segments/${world.segs[0].id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ summary: '改写过的摘要' }),
    })
    expect(patch.status).toBe(200)
    expect(((await patch.json()) as { segment: SegmentDTO }).segment.summary).toBe('改写过的摘要')

    const bad = await app.request(`/api/segments/${world.segs[0].id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(bad.status).toBe(400)

    const stranger = createTestApp({ db, userId: other.id })
    expect((await stranger.request(`/api/people/${world.her.id}/interaction`)).status).toBe(404)
    expect((await stranger.request(`/api/loops/${world.openLoop.id}/reopen`, { method: 'POST' })).status).toBe(404)
    expect((await stranger.request(`/api/segments/${world.segs[0].id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hidden: true }) })).status).toBe(404)

    const anon = createTestApp({ db, userId: null })
    expect((await anon.request(`/api/people/${world.her.id}/interaction`)).status).toBe(401)
  })
})
