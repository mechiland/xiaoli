// A mapping that fails after it re-pointed a handle, renumbered the chat and re-selected attachments must undo all
// three (DECISIONS import I2). createJobsForImport is made to throw once; everything else is the real code.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CreateImportRequest, ParsedMessage } from '@/contracts'
import { parseExportZip } from '@/lib/wechat-export'
import { attachments, extractionJobs, handles, imports, messages, persons, updateUserSettings, withOwner, type Db } from '@/server/db'
import { createTestApp, createTestDb, createTestUser } from '~/tests/helpers/test-db'

const failJobs = vi.hoisted(() => ({ on: false }))
vi.mock('@/server/extract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/extract')>()
  return {
    ...actual,
    createJobsForImport: async (...args: Parameters<typeof actual.createJobsForImport>) => {
      if (failJobs.on) throw new Error('simulated job creation failure')
      return actual.createJobsForImport(...args)
    },
  }
})

const FIXTURES = path.resolve(__dirname, '..', '..', '..', 'fixtures', 'synthetic')
const NEWER = '聊天记录_20260914_211545.zip'
const OLDER = '聊天记录_20260405_223012.zip'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json()

describe('mapping rollback', () => {
  let db: Db
  let r2: R2Bucket
  let dispose: () => Promise<void>
  beforeAll(async () => {
    const t = await createTestDb()
    db = t.db
    r2 = t.r2
    dispose = t.dispose
  })
  afterAll(async () => dispose?.())

  it('restores re-pointed handles, renumbered seqs, other job windows and re-selected attachments', async () => {
    const [newer, older] = await Promise.all(
      [NEWER, OLDER].map((n) => parseExportZip(new Uint8Array(readFileSync(path.join(FIXTURES, n))), { fileName: n })),
    )
    const u = await createTestUser(db, 'rollback@xiaoli.test')
    await updateUserSettings(db, u.id, { selfDisplayNames: ['小满'] })
    const app = createTestApp({ db, r2, userId: u.id })
    const call = (method: string, url: string, body?: unknown) =>
      app.request(url, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const body = (sha: string, msgs: ParsedMessage[], selected: string[]): CreateImportRequest => ({
      fileName: newer.fileName, sha256: sha, exportedAt: newer.exportedAt, parserVersion: newer.parserVersion, messages: msgs, media: newer.media, selectedAttachments: selected,
    })

    // import A: the newer export, no attachments selected
    const a = await json(await call('POST', '/api/imports', body(newer.sha256, newer.messages, [])))
    const ma = await json(
      await call('POST', `/api/imports/${a.import.id}/mapping`, {
        chat: { new: { title: '一舟', kind: 'private' } },
        senders: [
          { senderName: '小满', target: { self: true } },
          { senderName: '一舟', target: { newPerson: { label: '一舟' } } },
        ],
      }),
    )
    const chatId = ma.chat.id as number
    const handle = (await db.select().from(handles).where(and(eq(handles.chatId, chatId), eq(handles.value, '一舟'))).get())!
    await db.update(handles).set({ status: 'proposed' }).where(eq(handles.id, handle.id))
    const [other] = await db
      .insert(persons)
      .values(withOwner<typeof persons>(u.id, { label: '另一个人', isSelf: false, pinned: false, labelSort: 'lingyigeren' }))
      .returning()

    const snapshot = async () => ({
      messages: await db.select({ id: messages.id, seq: messages.seq }).from(messages).where(eq(messages.chatId, chatId)).orderBy(messages.id),
      jobs: await db
        .select({ id: extractionJobs.id, ws: extractionJobs.windowStartSeq, we: extractionJobs.windowEndSeq, fs: extractionJobs.focusStartSeq, fe: extractionJobs.focusEndSeq, st: extractionJobs.status })
        .from(extractionJobs)
        .where(eq(extractionJobs.ownerId, u.id))
        .orderBy(extractionJobs.id),
      attachments: await db
        .select({ id: attachments.id, selected: attachments.selected })
        .from(attachments)
        .where(eq(attachments.ownerId, u.id))
        .orderBy(attachments.id),
      handles: await db.select({ id: handles.id, personId: handles.personId, status: handles.status }).from(handles).where(eq(handles.ownerId, u.id)).orderBy(handles.id),
      persons: await db.select({ id: persons.id }).from(persons).where(eq(persons.ownerId, u.id)).orderBy(persons.id),
    })
    const before = await snapshot()
    expect(before.jobs.length).toBeGreaterThan(0)
    expect(before.attachments.some((x) => !x.selected)).toBe(true)

    // import B: 1,500 older messages (forces a renumber) + the whole newer export again (reused), images selected now,
    // and 一舟 picked as a different person (re-points the existing handle)
    const olderMsgs: ParsedMessage[] = Array.from({ length: 1500 }, (_, k) => ({
      ...older.messages[k % older.messages.length],
      idx: k,
      kind: 'text',
      body: `older ${k}`,
      attachmentName: null,
      meta: null,
      sentAt: `2025-01-${String(1 + Math.floor(k / 60)).padStart(2, '0')} ${String(Math.floor((k % 60) / 3)).padStart(2, '0')}:${String(k % 60).padStart(2, '0')}`,
      fingerprint: `rollback-older-${k}`,
    }))
    const images = newer.media.filter((m) => m.kind === 'image').map((m) => m.name)
    const b = await json(await call('POST', '/api/imports', body('e'.repeat(64), [...olderMsgs, ...newer.messages], images)))
    const mapping = {
      chat: { existingChatId: chatId },
      senders: [
        { senderName: '小满', target: { self: true } },
        { senderName: '一舟', target: { personId: other.id } },
      ],
    }

    failJobs.on = true
    const failed = await call('POST', `/api/imports/${b.import.id}/mapping`, mapping)
    failJobs.on = false
    expect(failed.status).toBe(500)

    expect(await snapshot()).toEqual(before)
    expect((await db.select().from(handles).where(eq(handles.id, handle.id)).get())!).toMatchObject({ personId: handle.personId, status: 'proposed' })
    expect(await db.select({ status: imports.status, chatId: imports.chatId }).from(imports).where(eq(imports.id, b.import.id)).get()).toEqual({ status: 'mapping', chatId: null })

    // the staged payload is still there: the same step 2 succeeds now
    const ok = await call('POST', `/api/imports/${b.import.id}/mapping`, mapping)
    expect(ok.status).toBe(200)
    expect((await json(ok)).newMessageCount).toBe(1500)
    expect((await db.select().from(handles).where(eq(handles.id, handle.id)).get())!).toMatchObject({ personId: other.id, status: 'confirmed' })
    const reselected = await db
      .select({ selected: attachments.selected })
      .from(attachments)
      .where(inArray(attachments.id, before.attachments.filter((x) => !x.selected).map((x) => x.id)))
    expect(reselected.some((x) => x.selected)).toBe(true)
  })
})
