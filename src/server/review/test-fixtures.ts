// Synthetic test world for review tests (no real data). Inserts only.
import { eq } from 'drizzle-orm'
import {
  chats,
  claims,
  conversationSegments,
  eventParticipants,
  events,
  evidence,
  extractionJobs,
  handles,
  importantDates,
  imports,
  loops,
  messages,
  owned,
  persons,
  relations,
  segmentParticipants,
  withOwner,
  withOwnerLink,
  type Db,
} from '@/server/db'
import { createTestApp } from '~/tests/helpers/test-db'

const EMPTY_STATS = { byKind: {}, bySender: {}, images: { count: 0, bytes: 0 }, videos: { count: 0, bytes: 0 } }

export async function seedWorld(db: Db, ownerId: string, tag = 'x') {
  const ins = async <T extends { id: number }>(q: Promise<T[]>): Promise<T> => (await q)[0]
  const group = await ins(db.insert(chats).values(withOwner<typeof chats>(ownerId, { title: `测试群${tag}`, kind: 'group', note: null })).returning())
  const priv = await ins(db.insert(chats).values(withOwner<typeof chats>(ownerId, { title: `私聊${tag}`, kind: 'private', note: null })).returning())
  const imp = await ins(
    db
      .insert(imports)
      .values(withOwner<typeof imports>(ownerId, { chatId: group.id, fileName: `f-${tag}.zip`, fileSha256: `sha-${tag}-${Math.random()}`, exportedAt: null, parserVersion: 't', status: 'reviewing', messageCount: 10, newMessageCount: 10, dateFrom: null, dateTo: null, stats: EMPTY_STATS, error: null }))
      .returning(),
  )
  const person = (label: string, extra: Partial<typeof persons.$inferInsert> = {}) =>
    ins(db.insert(persons).values(withOwner<typeof persons>(ownerId, { label, labelSort: label, isSelf: false, pinned: false, mergedIntoId: null, importId: null, ...extra })).returning())
  const self = await person('我', { isSelf: true })
  const a = await person('周以宁')
  const b = await person('陈嘉树', { importId: imp.id })
  const c = await person('顾清禾')

  const handle = (personId: number | null, kind: typeof handles.$inferInsert.kind, value: string, chatId: number | null, extra: Partial<typeof handles.$inferInsert> = {}) =>
    ins(db.insert(handles).values(withOwner<typeof handles>(ownerId, { personId, kind, value, valueNorm: value.toLowerCase(), chatId, status: 'confirmed', importId: null, sourceKind: 'manual', ...extra })).returning())
  const hSelf = await handle(self.id, 'display_group', '我的微信名', group.id)
  const hA = await handle(a.id, 'display_group', '以宁', group.id)
  const hB = await handle(b.id, 'display_group', '嘉树', group.id)
  const hAp = await handle(a.id, 'display_private', '周以宁备注', priv.id)
  const hBmention = await handle(b.id, 'mentioned', '树哥', group.id, { status: 'proposed', importId: imp.id, sourceKind: 'ai' })

  const msg = (chatId: number, i: number, h: { id: number; value: string }, body: string, kind: typeof messages.$inferInsert.kind = 'text', meta: typeof messages.$inferInsert.meta = null) =>
    ins(
      db
        .insert(messages)
        .values(withOwner<typeof messages>(ownerId, { chatId, firstImportId: imp.id, senderHandleId: h.id, senderName: h.value, sentAt: `2026-09-0${1 + (i % 8)} 1${i % 10}:0${i % 10}`, seq: i * 1024, kind, body, meta, fingerprint: `fp-${chatId}-${i}` }))
        .returning(),
    )
  const g: { id: number }[] = []
  const senders = [hA, hB, hSelf]
  for (let i = 1; i <= 10; i++) g.push(await msg(group.id, i, senders[i % 3], `群消息${i}`))
  const p: { id: number }[] = []
  p.push(await msg(priv.id, 1, hAp, '我换工作了'))
  p.push(await msg(priv.id, 2, hAp, '[语音] 14"', 'voice', { durationSec: 14 }))
  p.push(await msg(priv.id, 3, hSelf, '[转账] 朋友已确认收款', 'transfer', { transferState: '朋友已确认收款' }))
  p.push(await msg(priv.id, 4, hAp, '[微信红包] 恭喜发财', 'red_packet', { greeting: '恭喜发财' }))
  p.push(await msg(priv.id, 5, hAp, '现在在杭州做制片'))

  const claim = (personId: number, statement: string, extra: Partial<typeof claims.$inferInsert> = {}) =>
    ins(
      db
        .insert(claims)
        .values(withOwner<typeof claims>(ownerId, { personId, statement, statementNorm: statement, category: 'work', validFrom: null, validTo: null, learnedAt: '2026-09-01T00:00:00.000Z', confidence: 0.9, sensitive: false, status: 'proposed', statusReason: null, statusChangedAt: '2026-09-01T00:00:00.000Z', supersedesClaimId: null, supersededByClaimId: null, importId: imp.id, jobId: null, sourceKind: 'ai', ...extra }))
        .returning(),
    )
  const oldWork = await claim(a.id, '在苏州做会计', { status: 'confirmed', importId: null })
  const newWork = await claim(a.id, '在杭州做制片', { supersedesClaimId: oldWork.id, confidence: 0.94 })
  const b1 = await claim(b.id, '喜欢打羽毛球', { category: 'preference', confidence: 0.95 })
  const b2 = await claim(b.id, '在读研究生', { category: 'education', confidence: 0.5 })
  const bSensitive = await claim(b.id, '提供过收货地址', { category: 'other', confidence: 0.99, sensitive: true })
  const bMixed = await claim(b.id, '和周以宁是同事', { category: 'work', confidence: 0.85 })
  const manual = await claim(a.id, '养了一只猫', { status: 'confirmed', importId: null, sourceKind: 'manual', confidence: null, category: 'preference' })

  const ev = (targetType: typeof evidence.$inferInsert.targetType, targetId: number, messageId: number) =>
    db.insert(evidence).values(withOwnerLink<typeof evidence>(ownerId, { targetType, targetId, messageId }))
  await ev('claim', newWork.id, g[2].id) // group seq 3 (sender hA? i=3 → hSelf)
  await ev('claim', newWork.id, p[4].id) // private seq 5
  await ev('claim', newWork.id, p[3].id) // private seq 4 (adjacent → merged segment)
  await ev('claim', oldWork.id, p[0].id)
  await ev('claim', b1.id, g[0].id) // i=1 → senders[1] = hB
  await ev('claim', b2.id, g[3].id) // i=4 → hB
  await ev('claim', bSensitive.id, g[6].id) // i=7 → hB
  await ev('claim', bMixed.id, g[0].id)
  await ev('claim', bMixed.id, g[1].id) // i=2 → hSelf  → mixed senders
  await ev('handle', hBmention.id, g[3].id)

  const rel = await ins(db.insert(relations).values(withOwner<typeof relations>(ownerId, { fromPersonId: b.id, toPersonId: a.id, type: 'friend', label: '朋友', status: 'proposed', importId: imp.id, sourceKind: 'ai' })).returning())
  await ev('relation', rel.id, g[4].id)
  const evt = await ins(db.insert(events).values(withOwner<typeof events>(ownerId, { summary: '一起去爬山', happenedAt: '2026-08', place: null, status: 'proposed', importId: imp.id, sourceKind: 'ai' })).returning())
  await db.insert(eventParticipants).values([withOwnerLink<typeof eventParticipants>(ownerId, { eventId: evt.id, personId: a.id }), withOwnerLink<typeof eventParticipants>(ownerId, { eventId: evt.id, personId: b.id })])
  await ev('event', evt.id, g[5].id)
  const date = await ins(db.insert(importantDates).values(withOwner<typeof importantDates>(ownerId, { personId: b.id, kind: 'birthday', month: 12, day: 3, year: null, calendar: 'solar', isLeapMonth: false, label: null, status: 'proposed', importId: imp.id, sourceKind: 'ai' })).returning())
  await ev('date', date.id, g[7].id)
  await db.insert(extractionJobs).values([
    withOwner<typeof extractionJobs>(ownerId, { importId: imp.id, windowStartSeq: 0, windowEndSeq: 5, focusStartSeq: 0, focusEndSeq: 5, status: 'done', attempts: 1 }),
    withOwner<typeof extractionJobs>(ownerId, { importId: imp.id, windowStartSeq: 5, windowEndSeq: 10, focusStartSeq: 5, focusEndSeq: 10, status: 'failed', attempts: 3 }),
  ])

  return { group, priv, imp, self, a, b, c, hSelf, hA, hB, hAp, hBmention, g, p, oldWork, newWork, b1, b2, bSensitive, bMixed, manual, rel, evt, date }
}

export type World = Awaited<ReturnType<typeof seedWorld>>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any

export function client(db: Db, userId: string) {
  const app = createTestApp({ db, userId })
  const call = async (method: string, url: string, body?: unknown): Promise<{ status: number; body: Json }> => {
    const res = await app.request(url, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, body: await res.json() }
  }
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, body: unknown = {}) => call('POST', url, body),
  }
}

/**
 * Interaction layer on top of `seedWorld` (SPEC §7 交互层): one segment over the first five group messages with two
 * participants, and three loops on 陈嘉树 / 周以宁 — one open question, one plan with a due date, one already closed
 * by a later message.
 */
export async function seedInteraction(db: Db, ownerId: string, w: World) {
  const ins = async <T extends { id: number }>(q: Promise<T[]>): Promise<T> => (await q)[0]
  const msg = async (id: number) => (await db.select().from(messages).where(owned(messages, ownerId, eq(messages.id, id))).get())!
  const first = await msg(w.g[0].id)
  const fifth = await msg(w.g[4].id)
  const last = await msg(w.g[9].id)

  const segment = await ins(
    db
      .insert(conversationSegments)
      .values(
        withOwner<typeof conversationSegments>(ownerId, {
          chatId: w.group.id,
          startSeq: first.seq,
          endSeq: fifth.seq,
          startedAt: first.sentAt,
          endedAt: fifth.sentAt,
          messageCount: 5,
          summary: '聊了搬家和孩子择校',
          summaryNorm: '聊了搬家和孩子择校',
          topics: JSON.stringify(['搬家', '择校']),
          hidden: false,
          importId: w.imp.id,
          jobId: null,
          sourceKind: 'ai',
        }),
      )
      .returning(),
  )
  await db.insert(segmentParticipants).values([
    withOwnerLink<typeof segmentParticipants>(ownerId, { segmentId: segment.id, personId: w.a.id, messageCount: 2 }),
    withOwnerLink<typeof segmentParticipants>(ownerId, { segmentId: segment.id, personId: w.b.id, messageCount: 3 }),
  ])

  const loop = (personId: number, text: string, extra: Partial<typeof loops.$inferInsert> = {}) =>
    ins(
      db
        .insert(loops)
        .values(
          withOwner<typeof loops>(ownerId, {
            personId,
            direction: 'theirs',
            kind: 'question',
            text,
            textNorm: text,
            dueAt: null,
            openedMessageId: first.id,
            openedAt: first.sentAt,
            closedMessageId: null,
            closedAt: null,
            closedReason: null,
            status: 'proposed',
            importId: w.imp.id,
            jobId: null,
            sourceKind: 'ai',
            ...extra,
          }),
        )
        .returning(),
    )
  const question = await loop(w.b.id, '她问你国庆有没有空，你没回')
  const plan = await loop(w.a.id, '约好十月一起去爬山', { kind: 'plan', direction: 'mutual', dueAt: '2026-10-01' })
  const closed = await loop(w.b.id, '你答应帮她看简历', {
    kind: 'promise',
    direction: 'mine',
    closedMessageId: last.id,
    closedAt: last.sentAt,
    closedReason: 'done',
  })

  const ev = (targetType: typeof evidence.$inferInsert.targetType, targetId: number, messageId: number) =>
    db.insert(evidence).values(withOwnerLink<typeof evidence>(ownerId, { targetType, targetId, messageId }))
  await ev('loop', question.id, first.id)
  await ev('loop', plan.id, w.g[1].id)
  await ev('loop', closed.id, first.id)
  await ev('segment', segment.id, first.id)

  return { segment, question, plan, closed }
}

export type InteractionWorld = Awaited<ReturnType<typeof seedInteraction>>
