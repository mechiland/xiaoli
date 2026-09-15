// DELETE /api/imports/:id — delete semantics (SPEC §7, ARCHITECTURE §11, DECISIONS A5 #24).
// Batched statements use the query builder: drizzle's D1 batch cannot run `db.run(sql)` raw items.
import { and, eq, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { DeleteImportResult, TargetType } from '@/contracts'
import { nowIso } from '@/lib/time'
import {
  attachments,
  claimMentions,
  claims,
  eventParticipants,
  events,
  evidence,
  extractionJobs,
  getOwnedOr404,
  handles,
  importantDates,
  importMessages,
  imports,
  llmCalls,
  messages,
  owned,
  persons,
  relations,
  type Db,
} from '@/server/db'
import { chunk, logImport, MAX_PARAMS, runBatches } from './batch'
import { deleteStagedPayload } from './staging'

const TABLE_NAME: Record<TargetType, string> = {
  handle: 'handles',
  relation: 'relations',
  claim: 'claims',
  event: 'events',
  date: 'important_dates',
}
const TYPES = Object.keys(TABLE_NAME) as TargetType[]

const count = async (db: Db, q: SQL): Promise<number> => Number((await db.all<{ n: number }>(q))[0]?.n ?? 0)

function deleteItems(db: Db, ownerId: string, t: TargetType, ids: number[]): BatchItem<'sqlite'> {
  switch (t) {
    case 'handle':
      return db.delete(handles).where(owned(handles, ownerId, inArray(handles.id, ids)))
    case 'relation':
      return db.delete(relations).where(owned(relations, ownerId, inArray(relations.id, ids)))
    case 'claim':
      return db.delete(claims).where(owned(claims, ownerId, inArray(claims.id, ids)))
    case 'event':
      return db.delete(events).where(owned(events, ownerId, inArray(events.id, ids)))
    case 'date':
      return db.delete(importantDates).where(owned(importantDates, ownerId, inArray(importantDates.id, ids)))
  }
}

export async function deleteImport(db: Db, r2: R2Bucket, ownerId: string, importId: number): Promise<DeleteImportResult> {
  const imp = await getOwnedOr404(db, imports, ownerId, importId)
  const o = ownerId
  const i = importId
  const now = nowIso()

  // 1. Messages this import first brought in that another import also contained → reassign, keep (A5 #24).
  const inOtherImport = sql`select 1 from import_messages im where im.message_id = messages.id and im.import_id <> ${i} and im.owner_id = ${o}`
  const reassignedMessages = await count(
    db,
    sql`select count(*) as n from messages where owner_id = ${o} and first_import_id = ${i} and exists (${inOtherImport})`,
  )
  if (reassignedMessages) {
    await db
      .update(messages)
      .set({
        firstImportId: sql`(select min(im.import_id) from import_messages im where im.message_id = ${messages.id} and im.import_id <> ${i} and im.owner_id = ${o})`,
        updatedAt: now,
      })
      .where(owned(messages, o, eq(messages.firstImportId, i), sql`exists (${inOtherImport})`))
  }

  // M = messages only this import contained.
  const M = sql`select id from messages where owner_id = ${o} and first_import_id = ${i}`
  const inM = (col: SQL | AnyColumn) => sql`${col} in (${M})`
  const deletedMessages = await count(db, sql`select count(*) as n from messages where owner_id = ${o} and first_import_id = ${i}`)
  const affectedPersons = (
    await db.all<{ id: number }>(sql`select distinct h.person_id as id from messages m join handles h on h.id = m.sender_handle_id
      where m.owner_id = ${o} and m.first_import_id = ${i} and h.person_id is not null`)
  ).map((r) => Number(r.id))
  const r2Keys = (
    await db.all<{ k: string }>(sql`select r2_key as k from attachments where owner_id = ${o} and r2_key is not null and message_id in (${M})`)
  ).map((r) => r.k)

  // 2. Derived items with evidence in M: all evidence in M → delete the item; otherwise only detach that evidence.
  const doomed: Record<TargetType, Set<number>> = { handle: new Set(), relation: new Set(), claim: new Set(), event: new Set(), date: new Set() }
  const candidates = await db.all<{ t: TargetType; id: number; other: number }>(sql`
    select e.target_type as t, e.target_id as id, max(case when m.first_import_id = ${i} then 0 else 1 end) as other
    from evidence e join messages m on m.id = e.message_id
    where e.owner_id = ${o} and exists (
      select 1 from evidence e2 join messages m2 on m2.id = e2.message_id
      where e2.owner_id = ${o} and e2.target_type = e.target_type and e2.target_id = e.target_id and m2.first_import_id = ${i})
    group by e.target_type, e.target_id`)
  for (const c of candidates) if (Number(c.other) === 0 && doomed[c.t]) doomed[c.t].add(Number(c.id))

  // 3. AI items of this import with no evidence left outside M.
  for (const t of TYPES) {
    const rows = await db.all<{ id: number }>(sql`select x.id as id from ${sql.raw(TABLE_NAME[t])} x
      where x.owner_id = ${o} and x.import_id = ${i} and x.source_kind = 'ai'
      and not exists (select 1 from evidence e where e.owner_id = ${o} and e.target_type = ${t} and e.target_id = x.id and e.message_id not in (${M}))`)
    for (const r of rows) doomed[t].add(Number(r.id))
  }
  // Display handles created by this import's mapping that no remaining message uses (DECISIONS import #4).
  const unusedHandles = await db.all<{ id: number }>(sql`select h.id as id from handles h
    where h.owner_id = ${o} and h.import_id = ${i} and h.source_kind = 'manual'
    and not exists (select 1 from messages m where m.owner_id = ${o} and m.sender_handle_id = h.id and (m.first_import_id is null or m.first_import_id <> ${i}))
    and not exists (select 1 from evidence e where e.owner_id = ${o} and e.target_type = 'handle' and e.target_id = h.id and e.message_id not in (${M}))`)
  for (const r of unusedHandles) doomed.handle.add(Number(r.id))

  const deletedItems = Object.fromEntries(TYPES.map((t) => [t, doomed[t].size])) as Record<TargetType, number>
  const itemStmts: BatchItem<'sqlite'>[] = []
  // 4. Claims superseded by a deleted claim become confirmed again.
  for (const part of chunk([...doomed.claim], MAX_PARAMS)) {
    itemStmts.push(
      db
        .update(claims)
        .set({ status: 'confirmed', supersededByClaimId: null, statusReason: null, statusChangedAt: now, updatedAt: now })
        .where(owned(claims, o, eq(claims.status, 'superseded'), inArray(claims.supersededByClaimId, part))),
      db.update(claims).set({ supersedesClaimId: null, updatedAt: now }).where(owned(claims, o, inArray(claims.supersedesClaimId, part))),
      db.delete(claimMentions).where(owned(claimMentions, o, inArray(claimMentions.claimId, part))),
    )
  }
  for (const part of chunk([...doomed.event], MAX_PARAMS)) {
    itemStmts.push(db.delete(eventParticipants).where(owned(eventParticipants, o, inArray(eventParticipants.eventId, part))))
  }
  for (const t of TYPES) {
    for (const part of chunk([...doomed[t]], MAX_PARAMS)) {
      itemStmts.push(
        db.delete(evidence).where(owned(evidence, o, eq(evidence.targetType, t), inArray(evidence.targetId, part))),
        deleteItems(db, o, t, part),
      )
    }
  }
  await runBatches(db, itemStmts)

  const detachedEvidence = await count(db, sql`select count(*) as n from evidence where owner_id = ${o} and message_id in (${M})`)
  const createdPersons = (
    await db.all<{ id: number }>(sql`select id from persons where owner_id = ${o} and import_id = ${i} and is_self = 0`)
  ).map((r) => Number(r.id))

  // 5. Evidence, attachments and messages of M; this import's links, jobs, LLM call log; then the import.
  await runBatches(db, [
    db.delete(evidence).where(owned(evidence, o, inM(evidence.messageId))),
    db.delete(attachments).where(owned(attachments, o, inM(attachments.messageId))),
    db.delete(importMessages).where(owned(importMessages, o, inM(importMessages.messageId))),
    db.delete(messages).where(owned(messages, o, eq(messages.firstImportId, i))),
    db.delete(importMessages).where(owned(importMessages, o, eq(importMessages.importId, i))),
    db.delete(extractionJobs).where(owned(extractionJobs, o, eq(extractionJobs.importId, i))),
    db.delete(llmCalls).where(and(eq(llmCalls.ownerId, o), eq(llmCalls.importId, i))),
    // "Created by an import" must keep pointing at a live import (the FK is `set null`): a display handle or person
    // this import created that another import still uses is handed to the earliest such import, so deleting that
    // import later removes it too (DECISIONS import I4). Runs after M and this import's links are gone.
    db
      .update(handles)
      .set({
        importId: sql`(select min(im.import_id) from import_messages im join messages m on m.id = im.message_id
          where im.owner_id = ${o} and m.owner_id = ${o} and m.sender_handle_id = ${handles.id})`,
      })
      .where(owned(handles, o, eq(handles.importId, i), eq(handles.sourceKind, 'manual'))),
    db
      .update(persons)
      .set({
        importId: sql`coalesce(
          (select min(im.import_id) from import_messages im join messages m on m.id = im.message_id join handles h on h.id = m.sender_handle_id
            where im.owner_id = ${o} and h.person_id = ${persons.id}),
          (select min(h.import_id) from handles h where h.owner_id = ${o} and h.person_id = ${persons.id} and h.import_id <> ${i}),
          (select min(c.import_id) from claims c where c.owner_id = ${o} and c.person_id = ${persons.id} and c.import_id <> ${i}),
          (select min(d.import_id) from important_dates d where d.owner_id = ${o} and d.person_id = ${persons.id} and d.import_id <> ${i}))`,
      })
      .where(owned(persons, o, eq(persons.importId, i), eq(persons.isSelf, false))),
    db.delete(imports).where(owned(imports, o, eq(imports.id, i))),
  ])

  for (const part of chunk(r2Keys, 1000)) {
    await r2.delete(part).catch((e) => logImport('warn', 'r2_attachment_delete_failed', { importId: i, name: (e as Error)?.name }))
  }
  await deleteStagedPayload(r2, o, i).catch((e) => logImport('warn', 'staging_delete_failed', { importId: i, name: (e as Error)?.name }))

  // Chat with no messages and no imports left (handles scoped to it cascade).
  if (imp.chatId !== null) {
    const left =
      (await count(db, sql`select count(*) as n from messages where owner_id = ${o} and chat_id = ${imp.chatId}`)) +
      (await count(db, sql`select count(*) as n from imports where owner_id = ${o} and chat_id = ${imp.chatId}`))
    if (left === 0) await db.run(sql`delete from chats where owner_id = ${o} and id = ${imp.chatId}`)
  }

  // Persons this import created that nothing refers to any more.
  let deletedPersons = 0
  for (const part of chunk(createdPersons, MAX_PARAMS)) {
    const ids = sql.join(
      part.map((x) => sql`${x}`),
      sql`, `,
    )
    const orphans = (
      await db.all<{ id: number }>(sql`select p.id as id from persons p where p.owner_id = ${o} and p.id in (${ids})
        and not exists (select 1 from handles x where x.owner_id = ${o} and x.person_id = p.id)
        and not exists (select 1 from claims x where x.owner_id = ${o} and x.person_id = p.id)
        and not exists (select 1 from important_dates x where x.owner_id = ${o} and x.person_id = p.id)
        and not exists (select 1 from relations x where x.owner_id = ${o} and (x.from_person_id = p.id or x.to_person_id = p.id))
        and not exists (select 1 from event_participants x where x.owner_id = ${o} and x.person_id = p.id)
        and not exists (select 1 from persons x where x.owner_id = ${o} and x.merged_into_id = p.id)`)
    ).map((r) => Number(r.id))
    if (orphans.length) {
      await runBatches(db, [
        db.delete(claimMentions).where(owned(claimMentions, o, inArray(claimMentions.personId, orphans))),
        db.delete(persons).where(owned(persons, o, inArray(persons.id, orphans))),
      ])
      deletedPersons += orphans.length
    }
  }

  // 6. persons.last_message_at for senders of the deleted messages.
  await runBatches(
    db,
    chunk(affectedPersons, MAX_PARAMS).map((part) =>
      db
        .update(persons)
        .set({
          lastMessageAt: sql`(select max(m.sent_at) from messages m join handles h on h.id = m.sender_handle_id where m.owner_id = ${o} and h.person_id = ${persons.id})`,
        })
        .where(owned(persons, o, inArray(persons.id, part))),
    ),
  )

  logImport('info', 'import_deleted', { importId: i, deletedMessages, reassignedMessages, detachedEvidence, deletedPersons })
  return { deletedMessages, reassignedMessages, deletedItems, detachedEvidence, deletedPersons }
}
