import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ChatDetailResponse, ChatMessagesResponse, MessageKind } from '@/contracts'
import { attachments, chats, handles, imports, messages, persons, withOwner, type Db } from '@/server/db'
import { createTestApp, createTestDb, createTestUser } from '~/tests/helpers/test-db'

// Chat routes on an in-memory D1/R2: windows, paging both ways, sender resolution, participants, imports, attachments,
// owner isolation (ARCHITECTURE §1.11, §10 F3).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json()
const N = 250
const time = (i: number) => {
  const m = 8 * 60 + i // one message per minute from 08:00
  return `2026-03-01 ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

async function insertChunked<T>(db: Db, rows: T[], make: (part: T[]) => unknown) {
  const stmts = []
  for (let i = 0; i < rows.length; i += 6) stmts.push(make(rows.slice(i, i + 6)))
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50) as never)
}

describe('chat routes', () => {
  let env: Awaited<ReturnType<typeof createTestDb>>
  let asUserA: ReturnType<typeof createTestApp>
  let asBob: ReturnType<typeof createTestApp>
  const ids: Record<string, number> = {}
  const msgIds: number[] = []

  beforeAll(async () => {
    env = await createTestDb()
    const { db, r2 } = env
    const alice = await createTestUser(db, 'alice-chat@example.test')
    const bob = await createTestUser(db, 'bob-chat@example.test')
    asUserA = createTestApp({ db, r2, userId: alice.id })
    asBob = createTestApp({ db, r2, userId: bob.id })

    const [chat] = await db.insert(chats).values(withOwner<typeof chats>(alice.id, { title: '测试群', kind: 'group', note: null })).returning()
    ids.chat = chat.id
    const [empty] = await db.insert(chats).values(withOwner<typeof chats>(alice.id, { title: '空聊天', kind: 'private', note: null })).returning()
    ids.empty = empty.id
    const [bobChat] = await db.insert(chats).values(withOwner<typeof chats>(bob.id, { title: 'Bob 的聊天', kind: 'private', note: null })).returning()
    ids.bobChat = bobChat.id

    const [self] = await db.insert(persons).values(withOwner<typeof persons>(alice.id, { label: '我', isSelf: true, pinned: false, mergedIntoId: null, labelSort: 'wo' })).returning()
    const [amy] = await db.insert(persons).values(withOwner<typeof persons>(alice.id, { label: '艾米', isSelf: false, pinned: false, mergedIntoId: null, labelSort: 'ai' })).returning()
    const [amyOld] = await db.insert(persons).values(withOwner<typeof persons>(alice.id, { label: '艾米（旧）', isSelf: false, pinned: false, mergedIntoId: amy.id, labelSort: 'ai' })).returning()
    ids.self = self.id
    ids.amy = amy.id
    ids.amyOld = amyOld.id
    const handle = (personId: number | null, value: string) =>
      withOwner<typeof handles>(alice.id, { personId, kind: 'display_group' as const, value, valueNorm: value, chatId: chat.id, status: 'confirmed' as const, importId: null, sourceKind: 'manual' as const })
    const [hSelf] = await db.insert(handles).values(handle(self.id, '小丽')).returning()
    const [hAmy] = await db.insert(handles).values(handle(amy.id, 'Amy')).returning()
    const [hOld] = await db.insert(handles).values(handle(amyOld.id, '艾米老号')).returning()
    const [hLoose] = await db.insert(handles).values(handle(null, '路人甲')).returning()

    const senders = [
      { h: hSelf.id, name: '小丽' },
      { h: hAmy.id, name: 'Amy' },
      { h: hOld.id, name: '艾米老号' },
      { h: hLoose.id, name: '路人甲' },
    ]
    const rows = Array.from({ length: N }, (_, i) => {
      const s = senders[i % 4]
      const kind: MessageKind = i === 10 || i === 11 || i === 12 ? 'image' : 'text'
      return withOwner<typeof messages>(alice.id, {
        chatId: chat.id,
        firstImportId: null,
        senderHandleId: s.h,
        senderName: s.name,
        sentAt: time(i),
        seq: (i + 1) * 1024,
        kind,
        body: kind === 'image' ? `[图片] img_${i}.jpg` : `第 ${i} 条`,
        meta: null,
        fingerprint: `fp${i}`,
      })
    })
    await insertChunked(db, rows, (part) => db.insert(messages).values(part))
    const inserted = await db.select({ id: messages.id, seq: messages.seq }).from(messages).orderBy(messages.seq)
    msgIds.push(...inserted.map((m) => m.id))
    const [bobMsg] = await db
      .insert(messages)
      .values(withOwner<typeof messages>(bob.id, { chatId: bobChat.id, firstImportId: null, senderHandleId: null, senderName: 'Bob', sentAt: time(0), seq: 1024, kind: 'text', body: 'hi', meta: null, fingerprint: 'b' }))
      .returning()
    ids.bobMsg = bobMsg.id

    const key = `u/${alice.id}/att/1/abc-img_10.jpg`
    await r2.put(key, new Uint8Array([137, 80, 78, 71]), { httpMetadata: { contentType: 'image/png' } })
    const att = (messageId: number, over: Partial<typeof attachments.$inferInsert>) =>
      withOwner<typeof attachments>(alice.id, { messageId, kind: 'image' as const, fileName: 'x.jpg', selected: true, r2Key: null, byteSize: null, mime: null, ...over })
    const [up] = await db.insert(attachments).values(att(msgIds[10], { r2Key: key, byteSize: 4, mime: 'image/png' })).returning()
    const [html] = await db.insert(attachments).values(att(msgIds[11], { r2Key: key, byteSize: 4, mime: 'text/html' })).returning()
    const [pending] = await db.insert(attachments).values(att(msgIds[12], {})).returning()
    ids.attUp = up.id
    ids.attHtml = html.id
    ids.attPending = pending.id
    // row says uploaded, but the object is gone from R2 (e.g. removed out of band)
    const [gone] = await db.insert(attachments).values(att(msgIds[13], { r2Key: `u/${alice.id}/att/1/gone-img_13.jpg`, byteSize: 4, mime: 'image/jpeg' })).returning()
    ids.attGone = gone.id
    // a HEIC photo under a .jpg name (WeChat export): stored mime from the extension, bytes are ISO-BMFF 'ftypheic'
    const heicKey = `u/${alice.id}/att/1/heic-img_14.jpg`
    const heic = new Uint8Array([0, 0, 0, 24, ...[...'ftypheic'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...[...'mif1heic'].map((c) => c.charCodeAt(0)), ...new Array(3000).fill(9)])
    await r2.put(heicKey, heic, { httpMetadata: { contentType: 'image/jpeg' } })
    const [heicRow] = await db.insert(attachments).values(att(msgIds[14], { r2Key: heicKey, fileName: '微信图片_202601011200_1.jpg', byteSize: heic.length, mime: 'image/jpeg' })).returning()
    ids.attHeic = heicRow.id

    const imp = (over: Partial<typeof imports.$inferInsert>) =>
      withOwner<typeof imports>(alice.id, {
        chatId: chat.id,
        fileName: 'x.zip',
        fileSha256: `sha-${Math.random()}`,
        exportedAt: null,
        parserVersion: 't',
        status: 'done' as const,
        messageCount: 10,
        newMessageCount: 10,
        dateFrom: null,
        dateTo: null,
        stats: { byKind: {}, bySender: {}, images: { count: 0, bytes: 0 }, videos: { count: 0, bytes: 0 } },
        error: null,
        ...over,
      })
    await db.insert(imports).values(imp({ dateFrom: time(100), dateTo: time(249), newMessageCount: 150 }))
    await db.insert(imports).values(imp({ dateFrom: time(0), dateTo: time(120), newMessageCount: 100 }))
    await db.insert(imports).values(imp({ status: 'mapping', chatId: chat.id }))
  })

  afterAll(async () => {
    await env?.dispose()
  })

  it('GET /api/chats/:id: stats, participants (merged → target, self and unlinked excluded), imports by date', async () => {
    const res = await asUserA.request(`/api/chats/${ids.chat}`)
    expect(res.status).toBe(200)
    const body = (await json(res)) as ChatDetailResponse
    expect(body.chat).toMatchObject({ id: ids.chat, title: '测试群', kind: 'group', messageCount: N, lastMessageAt: time(N - 1) })
    expect(body.participants).toEqual([{ id: ids.amy, label: '艾米', messageCount: 125 }])
    expect(body.imports.map((i) => i.newMessageCount)).toEqual([100, 150])
  })

  it('first page from the start, then newer by cursor, ends with hasNewer false', async () => {
    const first = (await json(await asUserA.request(`/api/chats/${ids.chat}/messages?dir=newer&limit=100`))) as ChatMessagesResponse
    expect(first.messages).toHaveLength(100)
    expect(first.messages[0].id).toBe(msgIds[0])
    expect(first).toMatchObject({ hasOlder: false, hasNewer: true, anchorId: null })
    const seqs = first.messages.map((m) => m.seq)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)

    const second = (await json(await asUserA.request(`/api/chats/${ids.chat}/messages?cursor=${seqs[99]}&dir=newer&limit=100`))) as ChatMessagesResponse
    expect(second.messages[0].id).toBe(msgIds[100])
    expect(second).toMatchObject({ hasOlder: true, hasNewer: true })
    const third = (await json(await asUserA.request(`/api/chats/${ids.chat}/messages?cursor=${second.messages[99].seq}&dir=newer&limit=100`))) as ChatMessagesResponse
    expect(third.messages).toHaveLength(50)
    expect(third).toMatchObject({ hasOlder: true, hasNewer: false })
  })

  it('last page by default and older by cursor', async () => {
    const last = (await json(await asUserA.request(`/api/chats/${ids.chat}/messages?limit=100`))) as ChatMessagesResponse
    expect(last.messages.at(-1)!.id).toBe(msgIds[N - 1])
    expect(last).toMatchObject({ hasOlder: true, hasNewer: false })
    const older = (await json(await asUserA.request(`/api/chats/${ids.chat}/messages?cursor=${last.messages[0].seq}&dir=older&limit=200`))) as ChatMessagesResponse
    expect(older.messages).toHaveLength(150)
    expect(older.messages.at(-1)!.id).toBe(msgIds[149])
    expect(older).toMatchObject({ hasOlder: false, hasNewer: true })
  })

  it('around a message: before/after window, anchorId, edges', async () => {
    const mid = (await json(await asUserA.request(`/api/chats/${ids.chat}/messages?around=${msgIds[120]}&before=50&after=50`))) as ChatMessagesResponse
    expect(mid.anchorId).toBe(msgIds[120])
    expect(mid.messages).toHaveLength(101)
    expect(mid.messages[50].id).toBe(msgIds[120])
    expect(mid).toMatchObject({ hasOlder: true, hasNewer: true })

    const edge = (await json(await asUserA.request(`/api/chats/${ids.chat}/messages?around=${msgIds[3]}`))) as ChatMessagesResponse
    expect(edge.messages[0].id).toBe(msgIds[0])
    expect(edge.messages).toHaveLength(54)
    expect(edge).toMatchObject({ hasOlder: false, hasNewer: true, anchorId: msgIds[3] })
  })

  it('around a message of another chat falls back to the start with anchorId null', async () => {
    const r = (await json(await asUserA.request(`/api/chats/${ids.chat}/messages?around=${ids.bobMsg}`))) as ChatMessagesResponse
    expect(r.anchorId).toBeNull()
    expect(r.messages[0].id).toBe(msgIds[0])
  })

  it('sender: person label (merged resolves to target), unlinked keeps the raw name', async () => {
    const r = (await json(await asUserA.request(`/api/chats/${ids.chat}/messages?dir=newer&limit=4`))) as ChatMessagesResponse
    const [self, amy, old, loose] = r.messages
    expect(self).toMatchObject({ senderName: '小丽', senderPersonId: ids.self, senderLabel: '我' })
    expect(amy).toMatchObject({ senderName: 'Amy', senderPersonId: ids.amy, senderLabel: '艾米' })
    expect(old).toMatchObject({ senderName: '艾米老号', senderPersonId: ids.amy, senderLabel: '艾米' })
    expect(loose).toMatchObject({ senderName: '路人甲', senderPersonId: null, senderLabel: null })
  })

  it('personId filter includes persons merged into it', async () => {
    const r = (await json(await asUserA.request(`/api/chats/${ids.chat}/messages?dir=newer&limit=500&personId=${ids.amy}`))) as ChatMessagesResponse
    expect(r.messages).toHaveLength(125)
    expect(new Set(r.messages.map((m) => m.senderName))).toEqual(new Set(['Amy', '艾米老号']))
  })

  it('attachments in message DTOs; stream with safe headers; 304; missing; octet-stream for unsafe types', async () => {
    const r = (await json(await asUserA.request(`/api/chats/${ids.chat}/messages?around=${msgIds[11]}&before=1&after=1`))) as ChatMessagesResponse
    expect(r.messages[0].attachments[0]).toMatchObject({ id: ids.attUp, uploaded: true, url: `/api/attachments/${ids.attUp}` })
    expect(r.messages[2].attachments[0]).toMatchObject({ id: ids.attPending, uploaded: false, url: null, selected: true })

    const img = await asUserA.request(`/api/attachments/${ids.attUp}`)
    expect(img.status).toBe(200)
    expect(img.headers.get('content-type')).toBe('image/png')
    expect(img.headers.get('x-content-type-options')).toBe('nosniff')
    expect(img.headers.get('cache-control')).toContain('private')
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]))
    const etag = img.headers.get('etag')!
    expect((await asUserA.request(`/api/attachments/${ids.attUp}`, { headers: { 'if-none-match': etag } })).status).toBe(304)

    const html = await asUserA.request(`/api/attachments/${ids.attHtml}`)
    expect(html.headers.get('content-type')).toBe('application/octet-stream')
    expect(html.headers.get('content-disposition')).toBe('attachment')
    await html.arrayBuffer()

    const missing = await asUserA.request(`/api/attachments/${ids.attPending}`)
    expect(missing.status).toBe(404)
    expect((await json(missing)).error.code).toBe('attachment_missing')
  })

  it('HEIC bytes named .jpg are served as image/heic, whole; ?download=1 names the file .heic', async () => {
    const r = await asUserA.request(`/api/attachments/${ids.attHeic}`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/heic')
    expect(r.headers.get('content-disposition')).toBe('inline')
    const body = new Uint8Array(await r.arrayBuffer())
    expect(body.length).toBe(3024)
    expect(Number(r.headers.get('content-length'))).toBe(3024)
    expect(String.fromCharCode(...body.subarray(4, 12))).toBe('ftypheic')

    const d = await asUserA.request(`/api/attachments/${ids.attHeic}?download=1`)
    expect(d.headers.get('content-type')).toBe('image/heic')
    expect(d.headers.get('content-disposition')).toBe(`attachment; filename="_____202601011200_1.heic"; filename*=UTF-8''${encodeURIComponent('微信图片_202601011200_1.heic')}`)
    expect((await d.arrayBuffer()).byteLength).toBe(3024)

    // a real PNG keeps its type; a stored non-image type is never upgraded by sniffing
    const png = await asUserA.request(`/api/attachments/${ids.attUp}?download=1`)
    expect(png.headers.get('content-type')).toBe('image/png')
    expect(png.headers.get('content-disposition')).toBe('attachment; filename="x.jpg"; filename*=UTF-8\'\'x.jpg')
    await png.arrayBuffer()
  })

  it('attachment whose R2 object is missing → 404 attachment_missing', async () => {
    const r = await asUserA.request(`/api/attachments/${ids.attGone}`)
    expect(r.status).toBe(404)
    expect((await json(r)).error.code).toBe('attachment_missing')
  })

  it('empty chat', async () => {
    const d = (await json(await asUserA.request(`/api/chats/${ids.empty}`))) as ChatDetailResponse
    expect(d.chat.messageCount).toBe(0)
    expect(d.chat.lastMessageAt).toBeNull()
    const m = (await json(await asUserA.request(`/api/chats/${ids.empty}/messages?dir=newer`))) as ChatMessagesResponse
    expect(m).toEqual({ messages: [], hasOlder: false, hasNewer: false, anchorId: null })
  })

  it('owner isolation: every route answers 404 across accounts', async () => {
    for (const path of [`/api/chats/${ids.chat}`, `/api/chats/${ids.chat}/messages`, `/api/chats/${ids.chat}/messages?around=${msgIds[5]}`, `/api/attachments/${ids.attUp}`]) {
      const r = await asBob.request(path)
      expect(r.status, path).toBe(404)
      expect((await json(r)).error.code, path).toBe('not_found')
    }
    expect((await asUserA.request(`/api/chats/${ids.bobChat}`)).status).toBe(404)
    expect((await asUserA.request(`/api/chats/999999`)).status).toBe(404)
  })

  it('validation', async () => {
    expect((await asUserA.request(`/api/chats/abc`)).status).toBe(400)
    expect((await asUserA.request(`/api/chats/${ids.chat}/messages?limit=5000`)).status).toBe(400)
    expect((await asUserA.request(`/api/chats/${ids.chat}/messages?dir=sideways`)).status).toBe(400)
  })
})
