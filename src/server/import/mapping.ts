// POST /api/imports/:id/mapping (overlay step 2 → 3). ARCHITECTURE §1.4 "Import data lifecycle" step 2.
import { and, eq, gte, inArray, isNull, lt, lte, or, sql, type AnyColumn } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { AttachmentKind, ChatKind, MappingRequest, MappingResponse, StagedImportPayload } from '@/contracts'
import { sortKey } from '@/lib/pinyin'
import { nowIso } from '@/lib/time'
import {
  attachments,
  chats,
  extractionJobs,
  getOwnedOr404,
  handles,
  importMessages,
  imports,
  messages,
  owned,
  persons,
  withOwner,
  withOwnerLink,
  type Db,
} from '@/server/db'
import { errors } from '@/server/errors'
import { createJobsForImport } from '@/server/extract'
import { alignMessages, MAX_SEQ } from './align'
import { chunk, logImport, MAX_PARAMS, runBatches } from './batch'
import { chatDTOs, normName, toImportDTO } from './dto'
import { deleteStagedPayload, getStagedPayload } from './staging'

type JobSeqs = { id: number; windowStartSeq: number; windowEndSeq: number; focusStartSeq: number; focusEndSeq: number }

/** What a mapping changed so far; `rollback` undoes exactly this (DECISIONS import I2). */
type Created = {
  chatId: number | null
  personIds: number[]
  handleIds: number[]
  /** existing handles re-pointed to the user's pick: their previous owner and status */
  repointed: { id: number; personId: number | null; status: (typeof handles.$inferSelect)['status'] }[]
  /** attachments of reused messages flipped to selected */
  reselectedAttachmentIds: number[]
  /** set once the renumber batch has committed: the stored seqs (seq order) and other imports' job windows before it */
  renumber: { chatId: number; unit: number; oldSeqs: number[]; jobs: JobSeqs[] } | null
}

export async function applyMapping(db: Db, r2: R2Bucket, ownerId: string, importId: number, req: MappingRequest): Promise<MappingResponse> {
  const imp = await getOwnedOr404(db, imports, ownerId, importId)
  if (imp.status !== 'mapping') throw errors.conflict('这次导入已经开始了')
  const payload = await getStagedPayload(r2, ownerId, importId)
  if (!payload) throw errors.conflict('请重新选择这份文件')

  const senderNames = [...new Set(payload.messages.map((m) => m.senderName))]
  const targets = new Map(req.senders.map((s) => [s.senderName, s.target]))
  const missing = senderNames.filter((n) => !targets.has(n))
  if (missing.length) throw errors.validation('还有发送者没有选择', { missing: missing.length })

  // Claim the import so a double submit cannot insert twice ('parsed' = mapping in progress).
  const claimed = await db
    .update(imports)
    .set({ status: 'parsed', updatedAt: nowIso() })
    .where(owned(imports, ownerId, eq(imports.id, importId), eq(imports.status, 'mapping')))
    .returning({ id: imports.id })
  if (claimed.length === 0) throw errors.conflict('这次导入已经开始了')

  const created: Created = { chatId: null, personIds: [], handleIds: [], repointed: [], reselectedAttachmentIds: [], renumber: null }
  try {
    return await runMapping(db, r2, ownerId, importId, req, payload, senderNames, created)
  } catch (err) {
    await rollback(db, ownerId, importId, created).catch((e) =>
      logImport('error', 'mapping_rollback_failed', { importId, name: (e as Error)?.name }),
    )
    throw err
  }
}

async function runMapping(
  db: Db,
  r2: R2Bucket,
  ownerId: string,
  importId: number,
  req: MappingRequest,
  payload: StagedImportPayload,
  senderNames: string[],
  created: Created,
): Promise<MappingResponse> {
  const now = nowIso()

  // 1. chat
  let chat: typeof chats.$inferSelect
  if ('existingChatId' in req.chat) {
    chat = await getOwnedOr404(db, chats, ownerId, req.chat.existingChatId)
  } else {
    chat = (
      await db
        .insert(chats)
        .values(withOwner<typeof chats>(ownerId, { title: req.chat.new.title, kind: req.chat.new.kind, note: null }, now))
        .returning()
    )[0]
    created.chatId = chat.id
  }

  // 2. sender → person
  let selfId: number | null = null
  const ensureSelf = async (label: string): Promise<number> => {
    if (selfId !== null) return selfId
    const row = await db
      .select({ id: persons.id })
      .from(persons)
      .where(owned(persons, ownerId, eq(persons.isSelf, true), isNull(persons.mergedIntoId)))
      .get()
    if (row) return (selfId = row.id)
    const p = (
      await db
        .insert(persons)
        .values(withOwner<typeof persons>(ownerId, { label, isSelf: true, pinned: false, labelSort: sortKey(label), importId }, now))
        .returning({ id: persons.id })
    )[0]
    created.personIds.push(p.id)
    return (selfId = p.id)
  }
  const personOf = new Map<string, number>()
  for (const name of senderNames) {
    const target = req.senders.find((s) => s.senderName === name)!.target
    if ('self' in target) {
      personOf.set(name, await ensureSelf(name))
    } else if ('personId' in target) {
      const p = await getOwnedOr404(db, persons, ownerId, target.personId)
      personOf.set(name, p.mergedIntoId ?? p.id)
    } else {
      const label = target.newPerson.label
      const p = (
        await db
          .insert(persons)
          .values(withOwner<typeof persons>(ownerId, { label, isSelf: false, pinned: false, labelSort: sortKey(label), importId }, now))
          .returning({ id: persons.id })
      )[0]
      created.personIds.push(p.id)
      personOf.set(name, p.id)
    }
  }

  // 3. display handles (confirmed: the user chose them explicitly)
  const handleKind = chat.kind === 'private' ? 'display_private' : 'display_group'
  const handleOf = new Map<string, number>()
  for (const name of senderNames) {
    const personId = personOf.get(name)!
    const existing = await db
      .select()
      .from(handles)
      .where(owned(handles, ownerId, eq(handles.kind, handleKind), eq(handles.value, name), eq(handles.chatId, chat.id)))
      .get()
    if (existing) {
      if (existing.personId !== personId || existing.status !== 'confirmed') {
        created.repointed.push({ id: existing.id, personId: existing.personId, status: existing.status })
        await db
          .update(handles)
          .set({ personId, status: 'confirmed', updatedAt: now })
          .where(owned(handles, ownerId, eq(handles.id, existing.id)))
      }
      handleOf.set(name, existing.id)
    } else {
      const h = (
        await db
          .insert(handles)
          .values(
            withOwner<typeof handles>(
              ownerId,
              { personId, kind: handleKind, value: name, valueNorm: normName(name), chatId: chat.id, status: 'confirmed', importId, sourceKind: 'manual' },
              now,
            ),
          )
          .returning({ id: handles.id })
      )[0]
      created.handleIds.push(h.id)
      handleOf.set(name, h.id)
    }
  }

  // 4. align with the chat's stored messages
  const existing = await db
    .select({ id: messages.id, seq: messages.seq, fingerprint: messages.fingerprint, sentAt: messages.sentAt })
    .from(messages)
    .where(owned(messages, ownerId, eq(messages.chatId, chat.id)))
  const align = alignMessages(existing, payload.messages)

  // 5. make room: alignMessages renumbers the stored messages to rank × unit (never a multiplication of old values)
  if (align.resequence.length) await renumberChat(db, ownerId, chat.id, existing, align.resequence, now, created)

  // 6. insert new messages
  const idBySeq = new Map<number, number>()
  const msgStmts: BatchItem<'sqlite'>[] = chunk(align.insert, 7).map((part) =>
    db
      .insert(messages)
      .values(
        part.map(({ incomingIdx, seq }) => {
          const m = payload.messages[incomingIdx]
          return withOwner<typeof messages>(
            ownerId,
            {
              chatId: chat.id,
              firstImportId: importId,
              senderHandleId: handleOf.get(m.senderName)!,
              senderName: m.senderName,
              sentAt: m.sentAt,
              seq,
              kind: m.kind,
              body: m.body,
              meta: m.meta,
              fingerprint: m.fingerprint,
            },
            now,
          )
        }),
      )
      .returning({ id: messages.id, seq: messages.seq }),
  )
  for (const res of await runBatches(db, msgStmts)) for (const r of res as { id: number; seq: number }[]) idBySeq.set(r.seq, r.id)

  const messageIdOf = new Map<number, number>()
  for (const r of align.reuse) messageIdOf.set(r.incomingIdx, r.messageId)
  for (const r of align.insert) messageIdOf.set(r.incomingIdx, idBySeq.get(r.seq)!)

  // 7. import_messages for every incoming message
  const linkIds = [...new Set(messageIdOf.values())]
  await runBatches(
    db,
    chunk(linkIds, 20).map((part) =>
      db
        .insert(importMessages)
        .values(part.map((messageId) => withOwnerLink<typeof importMessages>(ownerId, { importId, messageId }, now)))
        .onConflictDoNothing(),
    ),
  )

  // 8. attachment rows for inserted messages; newly selected names on reused messages
  const mediaByName = new Map(payload.media.map((m) => [m.name, m]))
  const selected = new Set(payload.selectedAttachments)
  const attRows = align.insert.flatMap(({ incomingIdx, seq }) => {
    const m = payload.messages[incomingIdx]
    if (m.attachmentName === null && m.kind !== 'image' && m.kind !== 'video' && m.kind !== 'file') return []
    const media = m.attachmentName ? mediaByName.get(m.attachmentName) : undefined
    const kind: AttachmentKind = media?.kind ?? (m.kind === 'image' ? 'image' : m.kind === 'video' ? 'video' : 'file')
    return [
      withOwner<typeof attachments>(
        ownerId,
        {
          messageId: idBySeq.get(seq)!,
          kind,
          fileName: m.attachmentName,
          selected: m.attachmentName !== null && selected.has(m.attachmentName),
          r2Key: null,
          byteSize: media?.byteSize ?? null,
          mime: media?.mime ?? null,
        },
        now,
      ),
    ]
  })
  const reusedSelected = align.reuse
    .filter((r) => {
      const name = payload.messages[r.incomingIdx].attachmentName
      return name !== null && selected.has(name)
    })
    .map((r) => r.messageId)
  for (const part of chunk(reusedSelected, MAX_PARAMS)) {
    const rows = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(owned(attachments, ownerId, inArray(attachments.messageId, part), eq(attachments.selected, false), isNull(attachments.r2Key)))
    created.reselectedAttachmentIds.push(...rows.map((r) => r.id))
  }
  await runBatches(db, [
    ...chunk(attRows, 9).map((part) => db.insert(attachments).values(part)),
    ...chunk(created.reselectedAttachmentIds, MAX_PARAMS).map((part) =>
      db
        .update(attachments)
        .set({ selected: true, updatedAt: now })
        .where(owned(attachments, ownerId, inArray(attachments.id, part))),
    ),
  ])

  // 9. extraction jobs for the new ranges (extract owns windowing; it reads the import's chat, so link it first —
  //    the status stays 'parsed' until the final batch, and rollback clears chat_id again)
  await db.update(imports).set({ chatId: chat.id, updatedAt: now }).where(owned(imports, ownerId, eq(imports.id, importId)))
  const jobsCreated = align.newSeqRanges.length ? await createJobsForImport(db, ownerId, importId, align.newSeqRanges) : 0

  // 10. persons.last_message_at, import status last
  const lastByPerson = new Map<number, string>()
  for (const m of payload.messages) {
    const pid = personOf.get(m.senderName)!
    if ((lastByPerson.get(pid) ?? '') < m.sentAt) lastByPerson.set(pid, m.sentAt)
  }
  const finalStmts: BatchItem<'sqlite'>[] = [...lastByPerson].map(([pid, last]) =>
    db
      .update(persons)
      .set({ lastMessageAt: last, updatedAt: now })
      .where(owned(persons, ownerId, eq(persons.id, pid), or(isNull(persons.lastMessageAt), lt(persons.lastMessageAt, last)))),
  )
  finalStmts.push(db.update(chats).set({ updatedAt: now }).where(owned(chats, ownerId, eq(chats.id, chat.id))))
  finalStmts.push(
    db
      .update(imports)
      .set({ chatId: chat.id, newMessageCount: align.insert.length, status: 'extracting', updatedAt: now })
      .where(owned(imports, ownerId, eq(imports.id, importId))),
  )
  await runBatches(db, finalStmts)

  await deleteStagedPayload(r2, ownerId, importId).catch((e) =>
    logImport('warn', 'staging_delete_failed', { importId, name: (e as Error)?.name }),
  )

  const impRow = await getOwnedOr404(db, imports, ownerId, importId)
  const [chatDto] = await chatDTOs(db, ownerId, [chat])
  logImport('info', 'mapping_done', { importId, inserted: align.insert.length, reused: align.reuse.length, jobsCreated })
  return { import: toImportDTO(impRow), chat: chatDto, jobsCreated, newMessageCount: align.insert.length }
}

/**
 * Renumbers every stored message of the chat to rank × unit and, in the same atomic batch, moves the extraction
 * job windows of the chat's other imports onto the new numbering, so each window still covers exactly the same
 * messages (extract loads a window by seq range). Order inside the batch: job windows (read the old seqs), then
 * the two-phase message update (negative temporaries never collide with the positive seqs).
 */
async function renumberChat(
  db: Db,
  ownerId: string,
  chatId: number,
  existing: { id: number; seq: number }[],
  resequence: { messageId: number; seq: number }[],
  now: string,
  created: Created,
): Promise<void> {
  const sorted = [...existing].sort((a, b) => a.seq - b.seq)
  const unit = resequence[0].seq
  if (
    !Number.isSafeInteger(unit) ||
    unit <= 0 ||
    resequence.length !== sorted.length ||
    sorted.length * unit > MAX_SEQ ||
    resequence.some((r, k) => r.messageId !== sorted[k].id || r.seq !== (k + 1) * unit)
  ) {
    throw new Error('mapping: resequence is not a rank renumber')
  }

  const chatImports = db.select({ id: imports.id }).from(imports).where(owned(imports, ownerId, eq(imports.chatId, chatId)))
  const jobs: JobSeqs[] = await db
    .select({
      id: extractionJobs.id,
      windowStartSeq: extractionJobs.windowStartSeq,
      windowEndSeq: extractionJobs.windowEndSeq,
      focusStartSeq: extractionJobs.focusStartSeq,
      focusEndSeq: extractionJobs.focusEndSeq,
    })
    .from(extractionJobs)
    .where(owned(extractionJobs, ownerId, inArray(extractionJobs.importId, chatImports)))

  // Window bounds are message seqs (extract plans them from stored messages): look the rank up by equality in one
  // materialized ranking; a bound that is not a stored seq falls back to counting (first message ≥ start, last ≤ end).
  const ranked = sql`(select seq, row_number() over (order by seq) as rn from messages where owner_id = ${ownerId} and chat_id = ${chatId})`
  const lower = (col: AnyColumn) =>
    sql`coalesce((select r.rn from ${ranked} r where r.seq = ${col}), (select count(*) + 1 from messages m2 where m2.owner_id = ${ownerId} and m2.chat_id = ${chatId} and m2.seq < ${col})) * ${unit}`
  const upper = (col: AnyColumn) =>
    sql`coalesce((select r.rn from ${ranked} r where r.seq = ${col}), (select count(*) from messages m2 where m2.owner_id = ${ownerId} and m2.chat_id = ${chatId} and m2.seq <= ${col})) * ${unit}`

  const stmts: BatchItem<'sqlite'>[] = []
  if (jobs.length) {
    stmts.push(
      db
        .update(extractionJobs)
        .set({
          windowStartSeq: lower(extractionJobs.windowStartSeq),
          windowEndSeq: upper(extractionJobs.windowEndSeq),
          focusStartSeq: lower(extractionJobs.focusStartSeq),
          focusEndSeq: upper(extractionJobs.focusEndSeq),
          updatedAt: now,
        })
        .where(owned(extractionJobs, ownerId, inArray(extractionJobs.importId, chatImports))),
    )
  }
  stmts.push(
    db
      .update(messages)
      .set({ seq: sql`-ranked.rn - 1`, updatedAt: now })
      .from(
        sql`(select id, row_number() over (order by seq) as rn from messages where owner_id = ${ownerId} and chat_id = ${chatId}) as ranked`,
      )
      .where(owned(messages, ownerId, eq(messages.chatId, chatId), sql`${messages.id} = ranked.id`)),
    db
      .update(messages)
      .set({ seq: sql`(-${messages.seq} - 1) * ${unit}` })
      .where(owned(messages, ownerId, eq(messages.chatId, chatId), lt(messages.seq, 0))),
  )
  await db.batch(stmts as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  created.renumber = { chatId, unit, oldSeqs: sorted.map((e) => e.seq), jobs }
  logImport('info', 'chat_renumbered', { chatId, messages: sorted.length, unit, jobs: jobs.length })
}

/**
 * Statements that put the stored messages back on their pre-renumber seqs (run after the inserted messages are gone).
 * Old seqs are compressed into arithmetic runs over the rank (old = a + b·rank), one two-phase update per run.
 */
function restoreSeqs(db: Db, ownerId: string, r: NonNullable<Created['renumber']>): BatchItem<'sqlite'>[] {
  const { chatId, unit, oldSeqs } = r
  const out: BatchItem<'sqlite'>[] = []
  for (let k = 0; k < oldSeqs.length; ) {
    const b = k + 1 < oldSeqs.length ? oldSeqs[k + 1] - oldSeqs[k] : 0
    let e = k
    while (e + 1 < oldSeqs.length && oldSeqs[e + 1] - oldSeqs[e] === b) e++
    const a = oldSeqs[k] - b * (k + 1)
    out.push(
      db
        .update(messages)
        .set({ seq: sql`-(${a} + ${b} * (${messages.seq} / ${unit})) - 1` })
        .where(owned(messages, ownerId, eq(messages.chatId, chatId), gte(messages.seq, (k + 1) * unit), lte(messages.seq, (e + 1) * unit))),
    )
    k = e + 1
  }
  out.push(db.update(messages).set({ seq: sql`-${messages.seq} - 1` }).where(owned(messages, ownerId, eq(messages.chatId, chatId), lt(messages.seq, 0))))
  for (const j of r.jobs) {
    out.push(
      db
        .update(extractionJobs)
        .set({ windowStartSeq: j.windowStartSeq, windowEndSeq: j.windowEndSeq, focusStartSeq: j.focusStartSeq, focusEndSeq: j.focusEndSeq })
        .where(owned(extractionJobs, ownerId, eq(extractionJobs.id, j.id))),
    )
  }
  return out
}

/** Undo everything a failed mapping changed, and hand the import back to step 2 (the staged payload is still there). */
async function rollback(db: Db, ownerId: string, importId: number, created: Created): Promise<void> {
  const now = nowIso()
  const mine = sql`select id from messages where owner_id = ${ownerId} and first_import_id = ${importId}`
  const stmts: BatchItem<'sqlite'>[] = [
    ...created.repointed.map((h) =>
      db.update(handles).set({ personId: h.personId, status: h.status, updatedAt: now }).where(owned(handles, ownerId, eq(handles.id, h.id))),
    ),
    ...chunk(created.reselectedAttachmentIds, MAX_PARAMS).map((part) =>
      db.update(attachments).set({ selected: false, updatedAt: now }).where(owned(attachments, ownerId, inArray(attachments.id, part), isNull(attachments.r2Key))),
    ),
    db.delete(extractionJobs).where(owned(extractionJobs, ownerId, eq(extractionJobs.importId, importId))),
    db.delete(importMessages).where(owned(importMessages, ownerId, eq(importMessages.importId, importId))),
    db.delete(attachments).where(owned(attachments, ownerId, sql`${attachments.messageId} in (${mine})`)),
    db.delete(messages).where(owned(messages, ownerId, eq(messages.firstImportId, importId))),
    ...(created.renumber ? restoreSeqs(db, ownerId, created.renumber) : []),
    ...chunk(created.handleIds, MAX_PARAMS).map((part) => db.delete(handles).where(owned(handles, ownerId, inArray(handles.id, part)))),
    ...chunk(created.personIds, MAX_PARAMS).map((part) => db.delete(persons).where(owned(persons, ownerId, inArray(persons.id, part)))),
  ]
  if (created.chatId !== null) stmts.push(db.delete(chats).where(owned(chats, ownerId, eq(chats.id, created.chatId))))
  stmts.push(
    db
      .update(imports)
      .set({ status: 'mapping', chatId: null, newMessageCount: 0, updatedAt: now })
      .where(owned(imports, ownerId, and(eq(imports.id, importId), eq(imports.status, 'parsed')))),
  )
  await runBatches(db, stmts)
}

export type { ChatKind }
