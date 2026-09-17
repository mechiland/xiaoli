/**
 * SPEC M7 acceptance — the interaction layer's end-to-end promise (integrator-owned, not a module test).
 *
 * Two imports of the same chat, back to back: the first makes a promise, the second keeps it. The loop must go
 * from open to done. Then the same two records imported in REVERSE order, and then deleting the second import.
 * These three are the whole reason loop state is event-sourced instead of a column (DECISIONS I3), so they are
 * tested against the real pipeline (`processNextJob`) and the real `deleteImport`, with a fake LLM standing in for
 * the model only.
 */
import { asc, eq } from 'drizzle-orm'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { deriveLoop } from '@/lib/loop-state'
import { chats, handles, imports, loops, messages, persons, withOwner, type Db } from '@/server/db'
import { createJobsForImport, processNextJob } from '@/server/extract'
import { deleteImport } from '@/server/import'
import { createTestDb, createTestUser, fakeLlm } from '~/tests/helpers/test-db'
import type { LlmJsonResult } from '@/server/llm'

const env = { EXTRACT_MODEL: undefined }
const deadline = () => Date.now() + 28_000
const ok = (json: unknown): LlmJsonResult => ({
  ok: true,
  json,
  raw: JSON.stringify(json),
  usage: { inputTokens: 900, outputTokens: 90, cacheHitTokens: 0 },
  latencyMs: 10,
  model: 'deepseek-flash',
  finishReason: 'stop',
  fromCassette: false,
})
// Since DECISIONS I17 a window issues TWO calls in parallel with different schemas, so a fake model has to answer
// the one it is actually being asked. The extraction call rejects unknown top-level keys, so one combined reply
// would fail every window.
const extractBase = { newPersons: [], handles: [], relations: [], claims: [], events: [], dates: [] }
const interactionBase = { segment: null, loops: [], closes: [] }
const isInteraction = (req: { messages: { content: string }[] }) => req.messages.some((m) => m.content.includes('未结事项') || m.content.includes('来往'))

// All chat content is invented.
const PART_ONE = [
  { sender: 'me' as const, at: '2026-06-01 09:00', body: '你上次说的那本讲纪录片的书，我这周末整理一下书架找出来寄给你' },
  { sender: 'other' as const, at: '2026-06-01 09:01', body: '好啊不急' },
  { sender: 'other' as const, at: '2026-06-01 09:02', body: '我最近在看同一个导演的另一部' },
]
const PART_TWO = [
  { sender: 'other' as const, at: '2026-06-20 20:00', body: '书今天收到啦，谢谢你' },
  { sender: 'me' as const, at: '2026-06-20 20:01', body: '不客气' },
]

let t: Awaited<ReturnType<typeof createTestDb>>
let db: Db
let r2: R2Bucket
beforeAll(async () => {
  t = await createTestDb()
  db = t.db
  r2 = t.r2
})
afterAll(async () => t?.dispose())

let counter = 0

/** A fresh owner with one private chat, self + one other person, and no messages yet. */
async function world() {
  const user = await createTestUser(db, `m7-${++counter}-${Date.now()}@xiaoli.test`)
  const o = user.id
  const [self] = await db.insert(persons).values(withOwner<typeof persons>(o, { label: '我', isSelf: true, pinned: false, labelSort: 'wo' })).returning()
  const [other] = await db.insert(persons).values(withOwner<typeof persons>(o, { label: '林知夏', isSelf: false, pinned: false, labelSort: 'linzhixia' })).returning()
  const [chat] = await db.insert(chats).values(withOwner<typeof chats>(o, { title: '林知夏', kind: 'private' })).returning()
  const [hSelf] = await db
    .insert(handles)
    .values(withOwner<typeof handles>(o, { personId: self.id, kind: 'display_private', value: '山野', valueNorm: '山野', chatId: chat.id, status: 'confirmed', sourceKind: 'manual' }))
    .returning()
  const [hOther] = await db
    .insert(handles)
    .values(withOwner<typeof handles>(o, { personId: other.id, kind: 'display_private', value: '知夏', valueNorm: '知夏', chatId: chat.id, status: 'confirmed', sourceKind: 'manual' }))
    .returning()
  return { o, self, other, chat, hSelf, hOther }
}

/** Adds one import's worth of messages at the given seq offset and returns the import, in status `extracting`. */
async function addImport(w: Awaited<ReturnType<typeof world>>, rows: typeof PART_ONE, seqFrom: number) {
  const [imp] = await db
    .insert(imports)
    .values(
      withOwner<typeof imports>(w.o, {
        chatId: w.chat.id,
        fileName: `m7-${seqFrom}.zip`,
        fileSha256: `sha-m7-${counter}-${seqFrom}`,
        parserVersion: 'test',
        status: 'extracting',
        messageCount: rows.length,
        newMessageCount: rows.length,
        stats: { byKind: {}, bySender: {}, images: { count: 0, bytes: 0 }, videos: { count: 0, bytes: 0 } },
      }),
    )
    .returning()
  const msgs = await db
    .insert(messages)
    .values(
      rows.map((b, i) =>
        withOwner<typeof messages>(w.o, {
          chatId: w.chat.id,
          firstImportId: imp.id,
          senderHandleId: b.sender === 'me' ? w.hSelf.id : w.hOther.id,
          senderName: b.sender === 'me' ? '山野' : '知夏',
          sentAt: b.at,
          seq: seqFrom + i * 1024,
          kind: 'text',
          body: b.body,
          fingerprint: `m7-${counter}-${seqFrom + i}`,
        }),
      ),
    )
    .returning({ id: messages.id, seq: messages.seq })
  return { imp, msgs, range: [seqFrom, seqFrom + (rows.length - 1) * 1024] as [number, number] }
}

/** Runs every pending job of an import with the given model behaviour. */
async function runJobs(w: { o: string }, importId: number, reply: (req: { messages: { content: string }[] }) => LlmJsonResult) {
  const llm = fakeLlm([reply as never])
  for (let i = 0; i < 10; i++) {
    const r = await processNextJob(db, llm, w.o, importId, { deadlineAt: deadline(), env })
    if (!r.processed) break
  }
  return llm
}

/** The interaction call opens a loop; the extraction call is answered empty. */
const opensLoop = (personId: number) => (req: { messages: { content: string }[] }) =>
  isInteraction(req)
    ? ok({
        ...interactionBase,
        segment: { summary: '聊了要寄的那本书', topics: ['书'], speakers: [{ personId }], evidence: [1] },
        loops: [{ person: { personId }, direction: 'mine', kind: 'promise', text: '把讲纪录片的那本书寄给她', evidence: [1] }],
      })
    : ok(extractBase)

/**
 * The model closes whatever open loop the prompt showed it. Parsing the id out of the rendered prompt is the point:
 * it proves the id survives loadWindow → prompt → model output → store.
 */
const closesLoop = (req: { messages: { content: string }[] }): LlmJsonResult => {
  if (!isInteraction(req)) return ok(extractBase)
  const prompt = req.messages.map((m) => m.content).join('\n')
  const id = /\[loop (\d+)\]/.exec(prompt)?.[1]
  return ok(id ? { ...interactionBase, closes: [{ loopId: Number(id), reason: 'done', evidence: [1] }] } : interactionBase)
}

const loopRows = (o: string) => db.select().from(loops).where(eq(loops.ownerId, o)).orderBy(asc(loops.id))

describe('SPEC M7 — a promise made in one import and kept in the next', () => {
  it('forward order: the loop is opened by the first import and closed by the second', async () => {
    const w = await world()
    const a = await addImport(w, PART_ONE, 0)
    await createJobsForImport(db, w.o, a.imp.id, [a.range])
    await runJobs(w, a.imp.id, opensLoop(w.other.id))

    const opened = await loopRows(w.o)
    expect(opened).toHaveLength(1)
    expect(deriveLoop(opened[0], '2026-06-10').state).toBe('open')

    const b = await addImport(w, PART_TWO, 10 * 1024)
    await createJobsForImport(db, w.o, b.imp.id, [b.range])
    await runJobs(w, b.imp.id, closesLoop)

    const after = await loopRows(w.o)
    expect(after).toHaveLength(1)
    expect(deriveLoop(after[0], '2026-06-25').state).toBe('done')
    expect(after[0].closedReason).toBe('done')
    // closed BY A MESSAGE of the second import — this is what makes deletion reversible
    expect(b.msgs.map((m) => m.id)).toContain(after[0].closedMessageId)
  })

  it('deleting the second import reopens the loop, because the sentence that closed it is gone', async () => {
    const w = await world()
    const a = await addImport(w, PART_ONE, 0)
    await createJobsForImport(db, w.o, a.imp.id, [a.range])
    await runJobs(w, a.imp.id, opensLoop(w.other.id))
    const b = await addImport(w, PART_TWO, 10 * 1024)
    await createJobsForImport(db, w.o, b.imp.id, [b.range])
    await runJobs(w, b.imp.id, closesLoop)
    expect(deriveLoop((await loopRows(w.o))[0], '2026-06-25').state).toBe('done')

    await deleteImport(db, r2, w.o, b.imp.id)

    const after = await loopRows(w.o)
    expect(after).toHaveLength(1)
    expect(after[0].closedMessageId).toBeNull()
    expect(after[0].closedAt).toBeNull()
    expect(after[0].closedReason).toBeNull()
    expect(deriveLoop(after[0], '2026-06-25').state).toBe('open')
  })

  it('reverse order: importing the later record first — what actually happens', async () => {
    const w = await world()
    // the LATER messages arrive first; there is no loop yet, so nothing can be closed
    const b = await addImport(w, PART_TWO, 10 * 1024)
    await createJobsForImport(db, w.o, b.imp.id, [b.range])
    await runJobs(w, b.imp.id, closesLoop)
    expect(await loopRows(w.o)).toHaveLength(0)

    // then the EARLIER record, which opens the promise
    const a = await addImport(w, PART_ONE, 0)
    await createJobsForImport(db, w.o, a.imp.id, [a.range])
    await runJobs(w, a.imp.id, opensLoop(w.other.id))

    const after = await loopRows(w.o)
    expect(after).toHaveLength(1)
    // Documented, not desired: extraction only runs over NEW message ranges, so the message that would close this
    // loop was already read (as part of import B) before the loop existed, and is never revisited. SPEC M7 asks for
    // reverse order to converge with forward order; it does not, and this test records the real behaviour rather
    // than asserting the wish. See DECISIONS ## interaction layer I12.
    expect(deriveLoop(after[0], '2026-06-25').state).toBe('open')
  })
})
