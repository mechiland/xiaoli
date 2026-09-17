// DELETE /api/people/:id — delete semantics ARCHITECTURE §11 "Delete person".
import { eq, inArray, or } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import {
  claimMentions,
  claims,
  eventParticipants,
  events,
  evidence,
  handles,
  importantDates,
  loops,
  messages,
  owned,
  persons,
  relations,
  segmentParticipants,
  type Db,
} from '@/server/db'
import { errors } from '@/server/errors'
import { syncImportStatus } from '@/server/review'
import { BATCH_STATEMENTS, chunk, IN_CHUNK, uniq } from './util'

type Stmt = BatchItem<'sqlite'>

async function idsIn<T>(parts: number[][], q: (part: number[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (const part of parts) out.push(...(await q(part)))
  return out
}

/**
 * Deletes a person with its handles, claims, important dates, relations (both directions), event participation
 * (events left without participants are deleted), claim mentions and the evidence rows of every deleted item.
 * Messages stay; their sender handle is cleared so the chat shows the raw sender name. reviewLog rows stay.
 * Persons merged into this one are deleted the same way. Self → 409.
 *
 * Interaction layer (core request review#3): the person's loops go with them, like claims, and their evidence
 * rows are deleted explicitly — the FK cascade would take the loop but leave the evidence orphaned. Its
 * `segment_participants` rows go too, but the segments themselves stay: a 段落 belongs to a chat, not a person
 * (SPEC §7 删除语义), and every message in it is still there, so its counts are not recomputed either. Loops of
 * OTHER persons that happen to be opened or closed by a message this person sent are untouched.
 */
export async function deletePerson(db: Db, r2: R2Bucket | undefined, ownerId: string, personId: number): Promise<{ deleted: true }> {
  const person = await db.select().from(persons).where(owned(persons, ownerId, eq(persons.id, personId))).get()
  if (!person) throw errors.notFound('没有找到这个人物')
  if (person.isSelf) throw errors.conflict('不能删除“我”')

  // the person plus everyone merged into it (transitively)
  const personIds = [personId]
  const avatarKeys: string[] = person.avatarR2Key ? [person.avatarR2Key] : []
  for (let frontier = [personId]; frontier.length > 0; ) {
    const merged = await idsIn(chunk(frontier, IN_CHUNK), (part) =>
      db.select({ id: persons.id, avatar: persons.avatarR2Key }).from(persons).where(owned(persons, ownerId, inArray(persons.mergedIntoId, part))),
    )
    frontier = merged.map((m) => m.id).filter((id) => !personIds.includes(id))
    personIds.push(...frontier)
    for (const m of merged) if (m.avatar) avatarKeys.push(m.avatar)
  }
  const pParts = chunk(personIds, IN_CHUNK)

  const handleIds = (await idsIn(pParts, (part) => db.select({ id: handles.id }).from(handles).where(owned(handles, ownerId, inArray(handles.personId, part))))).map((r) => r.id)
  const claimRows = await idsIn(pParts, (part) =>
    db.select({ id: claims.id, importId: claims.importId }).from(claims).where(owned(claims, ownerId, inArray(claims.personId, part))),
  )
  const dateRows = await idsIn(pParts, (part) =>
    db.select({ id: importantDates.id, importId: importantDates.importId }).from(importantDates).where(owned(importantDates, ownerId, inArray(importantDates.personId, part))),
  )
  const relationRows = await idsIn(pParts, (part) =>
    db
      .select({ id: relations.id, importId: relations.importId })
      .from(relations)
      .where(owned(relations, ownerId, or(inArray(relations.fromPersonId, part), inArray(relations.toPersonId, part)))),
  )
  const handleImports = await idsIn(pParts, (part) => db.select({ importId: handles.importId }).from(handles).where(owned(handles, ownerId, inArray(handles.personId, part))))
  const eventIds = uniq(
    (await idsIn(pParts, (part) => db.select({ id: eventParticipants.eventId }).from(eventParticipants).where(owned(eventParticipants, ownerId, inArray(eventParticipants.personId, part))))).map(
      (r) => r.id,
    ),
  )
  // events that keep another participant survive
  const survivors = new Set<number>()
  for (const part of chunk(eventIds, IN_CHUNK)) {
    const rows = await db.select({ eventId: eventParticipants.eventId, personId: eventParticipants.personId }).from(eventParticipants).where(owned(eventParticipants, ownerId, inArray(eventParticipants.eventId, part)))
    for (const r of rows) if (!personIds.includes(r.personId)) survivors.add(r.eventId)
  }
  const orphanEventRows = await idsIn(chunk(eventIds.filter((id) => !survivors.has(id)), IN_CHUNK), (part) =>
    db.select({ id: events.id, importId: events.importId }).from(events).where(owned(events, ownerId, inArray(events.id, part))),
  )

  const loopRows = await idsIn(pParts, (part) =>
    db.select({ id: loops.id, importId: loops.importId }).from(loops).where(owned(loops, ownerId, inArray(loops.personId, part))),
  )

  const claimIds = claimRows.map((r) => r.id)
  const dateIds = dateRows.map((r) => r.id)
  const relationIds = uniq(relationRows.map((r) => r.id))
  const orphanEventIds = orphanEventRows.map((r) => r.id)
  const loopIds = loopRows.map((r) => r.id)

  const stmts: Stmt[] = []
  const evidenceOf = (type: 'handle' | 'claim' | 'date' | 'relation' | 'event' | 'loop', ids: number[]) => {
    for (const part of chunk(ids, IN_CHUNK)) stmts.push(db.delete(evidence).where(owned(evidence, ownerId, eq(evidence.targetType, type), inArray(evidence.targetId, part))))
  }
  evidenceOf('claim', claimIds)
  evidenceOf('date', dateIds)
  evidenceOf('relation', relationIds)
  evidenceOf('handle', handleIds)
  evidenceOf('event', orphanEventIds)
  evidenceOf('loop', loopIds)
  for (const part of chunk(claimIds, IN_CHUNK)) stmts.push(db.delete(claimMentions).where(owned(claimMentions, ownerId, inArray(claimMentions.claimId, part))))
  // other people's claims that mention this person lose the link
  for (const part of pParts) stmts.push(db.delete(claimMentions).where(owned(claimMentions, ownerId, inArray(claimMentions.personId, part))))
  for (const part of pParts) stmts.push(db.delete(eventParticipants).where(owned(eventParticipants, ownerId, inArray(eventParticipants.personId, part))))
  for (const part of chunk(orphanEventIds, IN_CHUNK)) {
    stmts.push(db.delete(eventParticipants).where(owned(eventParticipants, ownerId, inArray(eventParticipants.eventId, part))))
    stmts.push(db.delete(events).where(owned(events, ownerId, inArray(events.id, part))))
  }
  // claims of this person point only at each other through supersede links; clear dangling pointers elsewhere
  for (const part of chunk(claimIds, IN_CHUNK)) {
    stmts.push(db.update(claims).set({ supersedesClaimId: null }).where(owned(claims, ownerId, inArray(claims.supersedesClaimId, part))))
    stmts.push(db.update(claims).set({ supersededByClaimId: null }).where(owned(claims, ownerId, inArray(claims.supersededByClaimId, part))))
  }
  for (const part of chunk(claimIds, IN_CHUNK)) stmts.push(db.delete(claims).where(owned(claims, ownerId, inArray(claims.id, part))))
  for (const part of chunk(dateIds, IN_CHUNK)) stmts.push(db.delete(importantDates).where(owned(importantDates, ownerId, inArray(importantDates.id, part))))
  for (const part of chunk(relationIds, IN_CHUNK)) stmts.push(db.delete(relations).where(owned(relations, ownerId, inArray(relations.id, part))))
  for (const part of chunk(loopIds, IN_CHUNK)) stmts.push(db.delete(loops).where(owned(loops, ownerId, inArray(loops.id, part))))
  // segments are kept — they belong to the chat, not to this person, and all their messages are still there
  for (const part of pParts) stmts.push(db.delete(segmentParticipants).where(owned(segmentParticipants, ownerId, inArray(segmentParticipants.personId, part))))
  for (const part of chunk(handleIds, IN_CHUNK)) {
    stmts.push(db.update(messages).set({ senderHandleId: null }).where(owned(messages, ownerId, inArray(messages.senderHandleId, part))))
    stmts.push(db.delete(handles).where(owned(handles, ownerId, inArray(handles.id, part))))
  }
  // merged persons first (their merged_into_id points at the person), the person last
  const ordered = [...personIds.slice(1).reverse(), personId]
  for (const id of ordered) {
    stmts.push(db.update(persons).set({ mergedIntoId: null }).where(owned(persons, ownerId, eq(persons.mergedIntoId, id))))
    stmts.push(db.delete(persons).where(owned(persons, ownerId, eq(persons.id, id))))
  }

  for (const part of chunk(stmts, BATCH_STATEMENTS)) {
    if (part.length) await db.batch(part as [Stmt, ...Stmt[]])
  }

  if (r2) {
    for (const key of avatarKeys) {
      try {
        await r2.delete(key)
      } catch (e) {
        console.log(JSON.stringify({ level: 'warn', msg: 'person_avatar_delete_failed', name: (e as Error)?.name }))
      }
    }
  }

  // imports whose remaining items are no longer proposed move reviewing → done (review R6)
  const importIds = uniq(
    [...claimRows, ...dateRows, ...relationRows, ...orphanEventRows, ...loopRows, ...handleImports].map((r) => r.importId).filter((x): x is number => x != null),
  )
  if (importIds.length) await syncImportStatus(db, ownerId, importIds)
  return { deleted: true }
}
