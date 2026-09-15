import { readFileSync } from 'node:fs'
import path from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CreateImportRequest, ParsedExport } from '@/contracts'
import { parseExportZip } from '@/lib/wechat-export'
import {
  attachments,
  chats,
  claims,
  evidence,
  extractionJobs,
  handles,
  importMessages,
  imports,
  messages,
  persons,
  updateUserSettings,
  withOwner,
  withOwnerLink,
  type Db,
} from '@/server/db'
import { d1Store } from '@/server/extract'
import { createTestApp, createTestDb, createTestUser } from '@/tests/helpers/test-db'
import { stagedPayloadKey } from './staging'

// Uses extract's real createJobsForImport (the seam: it requires the import's chat to be linked before jobs are planned).

const FIXTURES = path.resolve(__dirname, '..', '..', 'fixtures', 'synthetic')
const PRIVATE_1 = '聊天记录_20260405_223012.zip'
const PRIVATE_2 = '聊天记录_20260914_211545.zip'
const GROUP = '聊天记录_20260910_183020.zip'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json()

async function parsed(name: string): Promise<ParsedExport> {
  return parseExportZip(new Uint8Array(readFileSync(path.join(FIXTURES, name))), { fileName: name })
}

function createBody(p: ParsedExport, selected?: string[]): CreateImportRequest {
  return {
    fileName: p.fileName,
    sha256: p.sha256,
    exportedAt: p.exportedAt,
    parserVersion: p.parserVersion,
    messages: p.messages,
    media: p.media,
    selectedAttachments: selected ?? p.media.filter((m) => m.kind === 'image').map((m) => m.name),
  }
}

describe('import routes', () => {
  let db: Db
  let r2: R2Bucket
  let dispose: () => Promise<void>
  let alice: { id: string }
  let bob: { id: string }
  let asUserA: ReturnType<typeof createTestApp>
  let asBob: ReturnType<typeof createTestApp>
  let p1: ParsedExport
  let p2: ParsedExport
  let group: ParsedExport

  const call = (app: ReturnType<typeof createTestApp>, method: string, url: string, body?: unknown) =>
    app.request(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  beforeAll(async () => {
    const t = await createTestDb()
    db = t.db
    r2 = t.r2
    dispose = t.dispose
    alice = await createTestUser(db, 'alice@xiaoli.test')
    bob = await createTestUser(db, 'bob@xiaoli.test')
    asUserA = createTestApp({ db, r2, userId: alice.id })
    asBob = createTestApp({ db, r2, userId: bob.id })
    ;[p1, p2, group] = await Promise.all([parsed(PRIVATE_1), parsed(PRIVATE_2), parsed(GROUP)])
    await updateUserSettings(db, alice.id, { selfDisplayNames: ['小满'] })
  })
  afterAll(async () => dispose?.())

  let import1 = 0
  let jobs1 = 0
  let chat1 = 0
  let yizhou = 0

  it('POST /api/imports stages the payload in R2 and writes no message rows (F6)', async () => {
    expect(await json(await call(asUserA, 'POST', '/api/imports/check', { sha256: p1.sha256 }))).toEqual({ duplicate: false })

    const res = await call(asUserA, 'POST', '/api/imports', createBody(p1))
    expect(res.status).toBe(201)
    const body = await json(res)
    import1 = body.import.id
    expect(body.import).toMatchObject({ status: 'mapping', chatId: null, messageCount: 207, dateFrom: p1.dateFrom, dateTo: p1.dateTo })
    expect(body.import.stats.bySender).toEqual({ 一舟: 113, 小满: 94 })
    expect(body.suggestions.preselectKind).toBe('private')
    expect(body.suggestions.chats).toEqual([])
    const bySender = Object.fromEntries(body.suggestions.senders.map((s: { senderName: string }) => [s.senderName, s]))
    expect(bySender['小满'].suggested).toEqual({ self: true })
    expect(bySender['一舟'].suggested).toBeNull()

    const staged = await r2.get(stagedPayloadKey(alice.id, import1))
    expect(staged).not.toBeNull()
    expect(JSON.parse(await staged!.text())).toMatchObject({ formatVersion: 1, importId: import1 })
    expect((await db.select().from(messages).where(eq(messages.ownerId, alice.id))).length).toBe(0)
    expect((await db.select().from(attachments).where(eq(attachments.ownerId, alice.id))).length).toBe(0)
  })

  it('PUT attachment before mapping → 409', async () => {
    const name = p1.media.find((m) => m.kind === 'image')!.name
    const res = await asUserA.request(`/api/imports/${import1}/attachments/${encodeURIComponent(name)}`, { method: 'PUT', body: new Uint8Array([1, 2, 3]) })
    expect(res.status).toBe(409)
  })

  it('mapping inserts messages, links, attachment rows and jobs, then deletes the staged payload (F6)', async () => {
    const res = await call(asUserA, 'POST', `/api/imports/${import1}/mapping`, {
      chat: { new: { title: '一舟', kind: 'private' } },
      senders: [
        { senderName: '小满', target: { self: true } },
        { senderName: '一舟', target: { newPerson: { label: '一舟' } } },
      ],
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    chat1 = body.chat.id
    expect(body.newMessageCount).toBe(207)
    expect(body.jobsCreated).toBeGreaterThan(0)
    jobs1 = body.jobsCreated
    expect(body.import).toMatchObject({ status: 'extracting', chatId: chat1, newMessageCount: 207 })
    expect(body.chat).toMatchObject({ title: '一舟', kind: 'private', messageCount: 207, lastMessageAt: p1.dateTo })

    const rows = await db.select().from(messages).where(and(eq(messages.ownerId, alice.id), eq(messages.chatId, chat1))).orderBy(messages.seq)
    expect(rows.map((m) => m.fingerprint)).toEqual(p1.messages.map((m) => m.fingerprint))
    expect(rows.every((m) => m.firstImportId === import1 && m.senderHandleId !== null)).toBe(true)
    expect((await db.select().from(importMessages).where(eq(importMessages.importId, import1))).length).toBe(207)

    const atts = await db.select().from(attachments).where(eq(attachments.ownerId, alice.id))
    const withName = p1.messages.filter((m) => m.attachmentName !== null)
    expect(atts.length).toBe(p1.messages.filter((m) => m.attachmentName !== null || ['image', 'video', 'file'].includes(m.kind)).length)
    for (const a of atts.filter((x) => x.fileName)) {
      const media = p1.media.find((m) => m.name === a.fileName)!
      expect(a.selected).toBe(media.kind === 'image')
      expect(a.kind).toBe(media.kind)
      expect(a.r2Key).toBeNull()
    }
    expect(atts.filter((a) => a.fileName).length).toBe(withName.length)

    const people = await db.select().from(persons).where(eq(persons.ownerId, alice.id))
    expect(people.map((p) => [p.label, p.isSelf]).sort()).toEqual([
      ['一舟', false],
      ['小满', true],
    ])
    yizhou = people.find((p) => p.label === '一舟')!.id
    const hs = await db.select().from(handles).where(eq(handles.ownerId, alice.id))
    expect(hs.every((h) => h.kind === 'display_private' && h.status === 'confirmed' && h.chatId === chat1)).toBe(true)
    expect(await r2.get(stagedPayloadKey(alice.id, import1))).toBeNull()
    expect((await db.select().from(extractionJobs).where(eq(extractionJobs.importId, import1))).length).toBe(jobs1)
  })

  it('mapping twice → 409; same file again → check duplicate + POST 409 with importId (F4)', async () => {
    const again = await call(asUserA, 'POST', `/api/imports/${import1}/mapping`, {
      chat: { existingChatId: chat1 },
      senders: [{ senderName: '小满', target: { self: true } }],
    })
    expect(again.status).toBe(409)
    expect(await json(await call(asUserA, 'POST', '/api/imports/check', { sha256: p1.sha256 }))).toEqual({ duplicate: true, importId: import1 })
    const dup = await call(asUserA, 'POST', '/api/imports', createBody(p1))
    expect(dup.status).toBe(409)
    expect((await json(dup)).error).toMatchObject({ code: 'duplicate_import', details: { importId: import1 } })
  })

  it('GET detail + PUT attachments: pending names, upload, idempotent, unknown name 404', async () => {
    let detail = await json(await call(asUserA, 'GET', `/api/imports/${import1}`))
    const images = p1.media.filter((m) => m.kind === 'image').map((m) => m.name)
    expect(detail.uploads).toEqual({ selected: images.length, uploaded: 0, pendingNames: expect.arrayContaining(images) })
    expect(detail.progress).toEqual({ total: jobs1, done: 0, failed: 0, pending: jobs1, running: 0 })
    expect(detail.chat.id).toBe(chat1)
    expect(detail.persons.map((p: { label: string }) => p.label).sort()).toEqual(['一舟', '小满'])

    // an image on a message only this export contains (the last 32 are shared with the second export)
    const name = p1.messages.find((m) => m.kind === 'image' && m.attachmentName && m.idx < p1.messages.length - 32)!.attachmentName!
    const url = `/api/imports/${import1}/attachments/${encodeURIComponent(name)}`
    const put = await asUserA.request(url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array([9, 8, 7, 6]) })
    expect(put.status).toBe(200)
    const att = (await json(put)).attachment
    expect(att).toMatchObject({ fileName: name, uploaded: true, byteSize: 4, mime: 'image/jpeg', url: `/api/attachments/${att.id}` })
    const row = await db.select().from(attachments).where(eq(attachments.id, att.id)).get()
    expect(row!.r2Key).toMatch(new RegExp(`^u/${alice.id}/att/${import1}/[0-9a-f]{64}-`))
    expect(new Uint8Array(await (await r2.get(row!.r2Key!))!.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7, 6]))

    const again = await asUserA.request(url, { method: 'PUT', body: new Uint8Array([1]) })
    expect(again.status).toBe(200)
    expect((await json(again)).attachment.byteSize).toBe(4)

    const video = p1.media.find((m) => m.kind === 'video')!.name
    expect((await asUserA.request(`/api/imports/${import1}/attachments/${encodeURIComponent(video)}`, { method: 'PUT', body: new Uint8Array([1]) })).status).toBe(404)
    expect((await asUserA.request(`/api/imports/${import1}/attachments/nope.jpg`, { method: 'PUT', body: new Uint8Array([1]) })).status).toBe(404)

    detail = await json(await call(asUserA, 'GET', `/api/imports/${import1}`))
    expect(detail.uploads.uploaded).toBe(1)
    expect(detail.uploads.pendingNames).not.toContain(name)
  })

  let import2 = 0
  it('partial-overlap export into the same chat: recommendation, 32 reused, no duplicate messages', async () => {
    const created = await json(await call(asUserA, 'POST', '/api/imports', createBody(p2)))
    import2 = created.import.id
    expect(created.suggestions.chats[0]).toMatchObject({ id: chat1, score: 1, matchReason: '『一舟』在这个聊天里出现过' })
    const s = Object.fromEntries(created.suggestions.senders.map((x: { senderName: string }) => [x.senderName, x]))
    expect(s['一舟'].suggested).toEqual({ personId: yizhou, label: '一舟', reason: '在『一舟』中也叫这个名字' })

    const list = await json(await call(asUserA, 'GET', `/api/chats?senders=${encodeURIComponent('一舟,小满')}`))
    expect(list.chats[0]).toMatchObject({ id: chat1, score: 1 })

    const res = await call(asUserA, 'POST', `/api/imports/${import2}/mapping`, {
      chat: { existingChatId: chat1 },
      senders: [
        { senderName: '小满', target: { self: true } },
        { senderName: '一舟', target: { personId: yizhou } },
      ],
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.newMessageCount).toBe(p2.messages.length - 32)
    expect(body.chat.messageCount).toBe(207 + p2.messages.length - 32)

    const rows = await db.select().from(messages).where(eq(messages.chatId, chat1)).orderBy(messages.seq)
    expect(rows.map((m) => m.fingerprint)).toEqual([...p1.messages, ...p2.messages.slice(32)].map((m) => m.fingerprint))
    expect((await db.select().from(importMessages).where(eq(importMessages.importId, import2))).length).toBe(p2.messages.length)
    expect((await db.select().from(persons).where(eq(persons.ownerId, alice.id))).length).toBe(2)
    expect((await db.select().from(handles).where(eq(handles.ownerId, alice.id))).length).toBe(2)
  })

  it('a stale mapping import never blocks: check says no duplicate, POST replaces it (F4)', async () => {
    const first = await json(await call(asUserA, 'POST', '/api/imports', createBody(group)))
    expect(first.suggestions.preselectKind).toBe('group')
    // the group shares only me (小满) with the private chat: no recommendation
    expect(first.suggestions.chats).toEqual([])
    expect(await json(await call(asUserA, 'POST', '/api/imports/check', { sha256: group.sha256 }))).toEqual({ duplicate: false })
    const second = await call(asUserA, 'POST', '/api/imports', createBody(group))
    expect(second.status).toBe(201)
    const replaced = await json(second)
    expect(replaced.import.id).not.toBe(first.import.id)
    expect((await call(asUserA, 'GET', `/api/imports/${first.import.id}`)).status).toBe(404)
    expect(await r2.get(stagedPayloadKey(alice.id, first.import.id))).toBeNull()

    // missing staged payload → 409, import stays in mapping
    await r2.delete(stagedPayloadKey(alice.id, replaced.import.id))
    const senders = group.senders.map((x) => ({ senderName: x.name, target: { newPerson: { label: x.name } } }))
    const m = await call(asUserA, 'POST', `/api/imports/${replaced.import.id}/mapping`, { chat: { new: { title: '家长群', kind: 'group' } }, senders })
    expect(m.status).toBe(409)
    expect((await json(m)).error.message).toBe('请重新选择这份文件')

    // abandoned at step 2: DELETE removes the row
    const del = await call(asUserA, 'DELETE', `/api/imports/${replaced.import.id}`)
    expect(del.status).toBe(200)
    expect(await json(del)).toMatchObject({ deletedMessages: 0, reassignedMessages: 0, deletedPersons: 0 })
    expect((await call(asUserA, 'GET', `/api/imports/${replaced.import.id}`)).status).toBe(404)
  })

  it('mapping rejects an incomplete sender list and rolls back nothing half-done', async () => {
    const created = await json(await call(asUserA, 'POST', '/api/imports', createBody(group)))
    const res = await call(asUserA, 'POST', `/api/imports/${created.import.id}/mapping`, {
      chat: { new: { title: '家长群', kind: 'group' } },
      senders: [{ senderName: 'Amy', target: { newPerson: { label: 'Amy' } } }],
    })
    expect(res.status).toBe(400)
    expect((await json(await call(asUserA, 'GET', `/api/imports/${created.import.id}`))).import.status).toBe('mapping')
    expect((await db.select().from(chats).where(eq(chats.ownerId, alice.id))).length).toBe(1)
    await call(asUserA, 'DELETE', `/api/imports/${created.import.id}`)
  })

  it('owner isolation: every id route answers 404 to another account (F3)', async () => {
    const name = p1.media.find((m) => m.kind === 'image')!.name
    for (const [method, url, body] of [
      ['GET', `/api/imports/${import1}`, undefined],
      ['DELETE', `/api/imports/${import1}`, undefined],
      ['POST', `/api/imports/${import2}/mapping`, { chat: { existingChatId: chat1 }, senders: [{ senderName: '小满', target: { self: true } }] }],
    ] as const) {
      const res = await call(asBob, method, url, body)
      expect(res.status, `${method} ${url}`).toBe(404)
    }
    expect((await asBob.request(`/api/imports/${import1}/attachments/${encodeURIComponent(name)}`, { method: 'PUT', body: new Uint8Array([1]) })).status).toBe(404)
    expect((await json(await call(asBob, 'GET', '/api/chats'))).chats).toEqual([])
    expect(await json(await call(asBob, 'POST', '/api/imports/check', { sha256: p1.sha256 }))).toEqual({ duplicate: false })

    // bob importing the same file is independent of alice's copy, and gets no suggestions from alice's data
    const res = await call(asBob, 'POST', '/api/imports', createBody(p2))
    expect(res.status).toBe(201)
    const b = await json(res)
    expect(b.suggestions.chats).toEqual([])
    expect(b.suggestions.senders.every((s: { suggested: unknown }) => s.suggested === null)).toBe(true)
    expect((await call(asUserA, 'GET', `/api/imports/${b.import.id}`)).status).toBe(404)
    expect((await call(asUserA, 'DELETE', `/api/imports/${b.import.id}`)).status).toBe(404)
  })

  it('delete semantics: reassign shared messages, delete items evidenced only by M, detach the rest, restore superseded', async () => {
    const now = new Date().toISOString()
    const chatMsgs = await db.select().from(messages).where(eq(messages.chatId, chat1)).orderBy(messages.seq)
    const onlyFirst = chatMsgs.filter((m) => m.firstImportId === import1).slice(0, 10) // first 175 are import1-only
    const shared = chatMsgs[200] // one of the 32 shared messages
    const onlySecond = chatMsgs.at(-1)!
    expect(shared.firstImportId).toBe(import1)
    expect(onlySecond.firstImportId).toBe(import2)

    const claim = (statement: string, importId: number, status: 'proposed' | 'confirmed' | 'superseded' = 'proposed') =>
      withOwner<typeof claims>(alice.id, {
        personId: yizhou, statement, statementNorm: statement, category: 'work', learnedAt: now, confidence: 0.9, sensitive: false,
        status, statusChangedAt: now, importId, sourceKind: 'ai',
      })
    const [old] = await db.insert(claims).values(claim('旧说法', import1, 'superseded')).returning()
    const [onlyM] = await db.insert(claims).values({ ...claim('只在第一次导入里', import1), supersedesClaimId: old.id }).returning()
    await db.update(claims).set({ supersededByClaimId: onlyM.id, statusReason: 'superseded' }).where(eq(claims.id, old.id))
    const [mixed] = await db.insert(claims).values(claim('两次导入都有证据', import1)).returning()
    const [onShared] = await db.insert(claims).values(claim('证据在重叠消息上', import1)).returning()
    const ev = (targetId: number, messageId: number) => withOwnerLink<typeof evidence>(alice.id, { targetType: 'claim', targetId, messageId })
    await db.insert(evidence).values([
      ev(old.id, onlySecond.id),
      ev(onlyM.id, onlyFirst[0].id),
      ev(onlyM.id, onlyFirst[1].id),
      ev(mixed.id, onlyFirst[2].id),
      ev(mixed.id, onlySecond.id),
      ev(onShared.id, shared.id),
    ])
    const upload = await db.select().from(attachments).where(and(eq(attachments.ownerId, alice.id), sql`${attachments.r2Key} is not null`)).get()

    const res = await call(asUserA, 'DELETE', `/api/imports/${import1}`)
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({
      deletedMessages: 207 - 32,
      reassignedMessages: 32,
      deletedItems: { handle: 0, relation: 0, claim: 1, event: 0, date: 0 },
      detachedEvidence: 1,
      deletedPersons: 0,
    })

    expect((await call(asUserA, 'GET', `/api/imports/${import1}`)).status).toBe(404)
    const left = await db.select().from(messages).where(eq(messages.chatId, chat1)).orderBy(messages.seq)
    expect(left.map((m) => m.fingerprint)).toEqual(p2.messages.map((m) => m.fingerprint))
    expect(left.every((m) => m.firstImportId === import2)).toBe(true)
    expect(await db.select().from(claims).where(eq(claims.id, onlyM.id)).get()).toBeUndefined()
    expect(await db.select().from(claims).where(eq(claims.id, old.id)).get()).toMatchObject({ status: 'confirmed', supersededByClaimId: null, statusReason: null })
    expect((await db.select().from(evidence).where(eq(evidence.targetId, mixed.id))).map((e) => e.messageId)).toEqual([onlySecond.id])
    expect((await db.select().from(evidence).where(eq(evidence.targetId, onShared.id))).map((e) => e.messageId)).toEqual([shared.id])
    expect((await db.select().from(importMessages).where(eq(importMessages.importId, import1))).length).toBe(0)
    expect((await db.select().from(extractionJobs).where(eq(extractionJobs.importId, import1))).length).toBe(0)
    expect(await db.select().from(imports).where(eq(imports.id, import1)).get()).toBeUndefined()
    // the uploaded attachment belonged to an import1-only message → row and R2 object gone
    expect(upload).toBeDefined()
    expect(await r2.get(upload!.r2Key!)).toBeNull()
    // the chat, both persons and their handles survive (import2 still uses them)
    expect((await db.select().from(chats).where(eq(chats.id, chat1))).length).toBe(1)
    expect((await db.select().from(persons).where(eq(persons.ownerId, alice.id))).length).toBe(2)
    const person = await db.select().from(persons).where(eq(persons.id, yizhou)).get()
    expect(person!.lastMessageAt).toBe(p2.messages.filter((m) => m.senderName === '一舟').at(-1)!.sentAt)
  })

  it('prepending an older export into a gap that is too small rescales existing seqs in D1', async () => {
    const carol = await createTestUser(db, 'carol@xiaoli.test')
    const asCarol = createTestApp({ db, r2, userId: carol.id })
    const senders = [
      { senderName: '小满', target: { self: true } },
      { senderName: '一舟', target: { newPerson: { label: '一舟' } } },
    ]
    const newer = await json(await call(asCarol, 'POST', '/api/imports', createBody(p2, [])))
    const chat = (await json(await call(asCarol, 'POST', `/api/imports/${newer.import.id}/mapping`, { chat: { new: { title: '一舟', kind: 'private' } }, senders }))).chat.id

    // squeeze the stored seqs to 1..n so the gap before the first message is (0, 1)
    await db.update(messages).set({ seq: sql`-${messages.seq}` }).where(eq(messages.chatId, chat))
    const neg = await db.select({ id: messages.id }).from(messages).where(eq(messages.chatId, chat)).orderBy(sql`${messages.seq} desc`)
    for (const [k, m] of neg.entries()) await db.update(messages).set({ seq: k + 1 }).where(eq(messages.id, m.id))

    const older = await json(await call(asCarol, 'POST', '/api/imports', createBody(p1, [])))
    const personId = (await db.select().from(persons).where(and(eq(persons.ownerId, carol.id), eq(persons.label, '一舟'))).get())!.id
    const res = await call(asCarol, 'POST', `/api/imports/${older.import.id}/mapping`, {
      chat: { existingChatId: chat },
      senders: [senders[0], { senderName: '一舟', target: { personId } }],
    })
    expect(res.status).toBe(200)
    expect((await json(res)).newMessageCount).toBe(p1.messages.length - 32)

    const rows = await db.select().from(messages).where(eq(messages.chatId, chat)).orderBy(messages.seq)
    expect(rows.map((m) => m.fingerprint)).toEqual([...p1.messages, ...p2.messages.slice(32)].map((m) => m.fingerprint))
    expect(rows.every((m) => m.seq > 0)).toBe(true)
    // the stored ones were renumbered to rank × unit (175 prepends → unit = 256 × 1024)
    const stored = rows.filter((m) => m.firstImportId === newer.import.id)
    expect(stored.map((m) => m.seq)).toEqual(stored.map((_, k) => (k + 1) * 262_144))
  })

  it('a renumber keeps the pending job windows of the chat’s earlier import on exactly the same messages', async () => {
    const dave = await createTestUser(db, 'dave@xiaoli.test')
    const asDave = createTestApp({ db, r2, userId: dave.id })
    const newer = await json(await call(asDave, 'POST', '/api/imports', createBody(p2, [])))
    const mapped = await json(
      await call(asDave, 'POST', `/api/imports/${newer.import.id}/mapping`, {
        chat: { new: { title: '一舟', kind: 'private' } },
        senders: [
          { senderName: '小满', target: { self: true } },
          { senderName: '一舟', target: { newPerson: { label: '一舟' } } },
        ],
      }),
    )
    const chatId = mapped.chat.id
    const store = d1Store(db, dave.id)
    const windowIds = async () => {
      const jobs = await db.select().from(extractionJobs).where(eq(extractionJobs.importId, newer.import.id)).orderBy(extractionJobs.id)
      return Promise.all(
        jobs.map(async (j) => {
          const w = await store.loadWindow({ importId: j.importId, jobId: j.id, windowIndex: 0, startSeq: j.windowStartSeq, endSeq: j.windowEndSeq, focusStartSeq: j.focusStartSeq, focusEndSeq: j.focusEndSeq })
          const focus = await db
            .select({ id: messages.id })
            .from(messages)
            .where(and(eq(messages.chatId, chatId), sql`${messages.seq} between ${j.focusStartSeq} and ${j.focusEndSeq}`))
            .orderBy(messages.seq)
          return { window: [...w.seqMap.values()], focus: focus.map((m) => m.id) }
        }),
      )
    }
    const before = await windowIds()
    expect(before.length).toBeGreaterThan(0)
    expect(before.every((w) => w.window.length > 0 && w.focus.length > 0)).toBe(true)

    // an older export of 1,500 messages, all earlier than the stored ones → more than a 1024 gap can hold
    const older = Array.from({ length: 1500 }, (_, k) => {
      const src = p1.messages[k % p1.messages.length]
      const sentAt = `2025-01-${String(1 + Math.floor(k / 60)).padStart(2, '0')} ${String(Math.floor((k % 60) / 3)).padStart(2, '0')}:${String(k % 60).padStart(2, '0')}`
      return { ...src, idx: k, sentAt, attachmentName: null, fingerprint: `older-${k}` }
    })
    const olderBody = { ...createBody(p1, []), sha256: 'd'.repeat(64), messages: older }
    const created = await json(await call(asDave, 'POST', '/api/imports', olderBody))
    const personId = (await db.select().from(persons).where(and(eq(persons.ownerId, dave.id), eq(persons.label, '一舟'))).get())!.id
    const res = await call(asDave, 'POST', `/api/imports/${created.import.id}/mapping`, {
      chat: { existingChatId: chatId },
      senders: [
        { senderName: '小满', target: { self: true } },
        { senderName: '一舟', target: { personId } },
      ],
    })
    expect(res.status).toBe(200)
    expect((await json(res)).newMessageCount).toBe(1500)

    const rows = await db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(messages.seq)
    const stored = rows.filter((m) => m.firstImportId === newer.import.id)
    expect(stored[0].seq).toBeGreaterThan(1024) // renumbered, not left in place
    expect(stored.map((m) => m.seq)).toEqual(stored.map((_, k) => (k + 1) * stored[0].seq))
    expect(rows.every((m) => Number.isSafeInteger(m.seq) && m.seq <= 2 ** 52)).toBe(true)
    expect(rows.slice(0, 1500).every((m) => m.firstImportId === created.import.id)).toBe(true)
    expect(await windowIds()).toEqual(before)
  })

  it('deleting import A and then import B (B reused A’s person) leaves only the self person', async () => {
    const erin = await createTestUser(db, 'erin@xiaoli.test')
    await updateUserSettings(db, erin.id, { selfDisplayNames: ['小满'] })
    const asErin = createTestApp({ db, r2, userId: erin.id })
    const a = await json(await call(asErin, 'POST', '/api/imports', createBody(p1, [])))
    const ma = await json(
      await call(asErin, 'POST', `/api/imports/${a.import.id}/mapping`, {
        chat: { new: { title: '一舟', kind: 'private' } },
        senders: [
          { senderName: '小满', target: { self: true } },
          { senderName: '一舟', target: { newPerson: { label: '一舟' } } },
        ],
      }),
    )
    const personId = (await db.select().from(persons).where(and(eq(persons.ownerId, erin.id), eq(persons.label, '一舟'))).get())!.id
    const b = await json(await call(asErin, 'POST', '/api/imports', createBody(p2, [])))
    expect(
      (
        await call(asErin, 'POST', `/api/imports/${b.import.id}/mapping`, {
          chat: { existingChatId: ma.chat.id },
          senders: [
            { senderName: '小满', target: { self: true } },
            { senderName: '一舟', target: { personId } },
          ],
        })
      ).status,
    ).toBe(200)

    const dA = await json(await call(asErin, 'DELETE', `/api/imports/${a.import.id}`))
    expect(dA.deletedPersons).toBe(0)
    // the person and its display handle now belong to B, the import that still uses them
    expect((await db.select().from(persons).where(eq(persons.id, personId)).get())!.importId).toBe(b.import.id)
    expect((await db.select().from(handles).where(and(eq(handles.ownerId, erin.id), eq(handles.personId, personId)))).map((h) => h.importId)).toEqual([b.import.id])

    const dB = await json(await call(asErin, 'DELETE', `/api/imports/${b.import.id}`))
    expect(dB.deletedPersons).toBe(1)
    const left = await db.select().from(persons).where(eq(persons.ownerId, erin.id))
    expect(left.map((p) => p.isSelf)).toEqual([true])
    expect((await db.select().from(handles).where(eq(handles.ownerId, erin.id))).length).toBe(0)
    expect((await db.select().from(messages).where(eq(messages.ownerId, erin.id))).length).toBe(0)
    expect((await db.select().from(chats).where(eq(chats.ownerId, erin.id))).length).toBe(0)
  })

  it('deleting the last import of a chat removes the chat, its handles and the persons it created', async () => {
    // a group import of its own: persons created by it, chat created by it
    const created = await json(await call(asUserA, 'POST', '/api/imports', createBody(group, [])))
    const senders = group.senders.map((x) => ({ senderName: x.name, target: x.name === '小满' ? { self: true } : { newPerson: { label: x.name } } }))
    const mapped = await json(await call(asUserA, 'POST', `/api/imports/${created.import.id}/mapping`, { chat: { new: { title: '家长群', kind: 'group' } }, senders }))
    const groupChat = mapped.chat.id
    const before = (await db.select().from(persons).where(eq(persons.ownerId, alice.id))).length
    expect(before).toBe(2 + group.senders.length - 1)

    const res = await json(await call(asUserA, 'DELETE', `/api/imports/${created.import.id}`))
    expect(res).toMatchObject({ deletedMessages: group.messages.length, reassignedMessages: 0, deletedPersons: group.senders.length - 1 })
    expect(res.deletedItems.handle).toBe(group.senders.length)
    expect(await db.select().from(chats).where(eq(chats.id, groupChat)).get()).toBeUndefined()
    expect((await db.select().from(handles).where(eq(handles.chatId, groupChat))).length).toBe(0)
    expect((await db.select().from(persons).where(eq(persons.ownerId, alice.id))).length).toBe(2)
    // self person is never deleted and still has its private-chat handle
    expect(await db.select().from(persons).where(and(eq(persons.ownerId, alice.id), eq(persons.isSelf, true))).get()).toBeDefined()
  })
})
