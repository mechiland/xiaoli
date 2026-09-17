// Person-level review actions: create, merge, split, manual add (ARCHITECTURE §1.6, §11 Merge/Split).
import { eq, inArray, isNull, max, or, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type {
  AddClaimRequest,
  AddDateRequest,
  AddEventRequest,
  AddRelationRequest,
  ClaimDTO,
  EventDTO,
  ImportantDateDTO,
  MergePersonResponse,
  PersonDTO,
  RelationDTO,
  SplitPersonRequest,
  SplitPersonResponse,
  TargetType,
} from '@/contracts'
import { sortKey } from '@/lib/pinyin'
import { nowIso } from '@/lib/time'
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
  withOwner,
  withOwnerLink,
  type Db,
} from '@/server/db'
import { errors } from '@/server/errors'
import { detectMentions, syncImportStatus, validateDay } from './actions'
import { claimDTOs, dateDTOs, eventDTOs, loadRows, personDTO, relationDTOs, TABLES, type ClaimRow, type PersonRow, type RelationRow } from './dto'
import { chunk, EVIDENCE_ROWS, IN_CHUNK, LINK_ROWS, logStatements, norm, rowsPerInsert, runBatch, runBatchOrUndo, uniq, type LogEntry } from './util'

type Stmt = BatchItem<'sqlite'>

async function getPerson(db: Db, ownerId: string, id: number): Promise<PersonRow> {
  const p = await db.select().from(persons).where(owned(persons, ownerId, eq(persons.id, id))).get()
  if (!p) throw errors.notFound()
  return p
}

/** A person that can receive items: exists and is not merged away. */
async function getActivePerson(db: Db, ownerId: string, id: number): Promise<PersonRow> {
  const p = await getPerson(db, ownerId, id)
  if (p.mergedIntoId != null) throw errors.conflict('这个人物已经合并到其他人物', { mergedIntoId: p.mergedIntoId })
  return p
}

export async function createPerson(db: Db, ownerId: string, label: string): Promise<PersonDTO> {
  const clean = label.trim()
  if (!clean) throw errors.validation('名字不能为空')
  const [row] = await db
    .insert(persons)
    .values(withOwner<typeof persons>(ownerId, { label: clean, labelSort: sortKey(clean), isSelf: false, pinned: false, mergedIntoId: null, importId: null }))
    .returning()
  return personDTO(row)
}

// ---------------------------------------------------------------------------------------------------------------
// merge

export async function mergePersons(db: Db, ownerId: string, fromId: number, intoId: number): Promise<MergePersonResponse> {
  if (fromId === intoId) throw errors.validation('不能合并到同一个人物')
  const from = await getActivePerson(db, ownerId, fromId)
  const into = await getActivePerson(db, ownerId, intoId)
  if (from.isSelf) throw errors.conflict('“我”不能合并到其他人物')
  const now = nowIso()

  const handleIds = (await db.select({ id: handles.id }).from(handles).where(owned(handles, ownerId, eq(handles.personId, fromId)))).map((r) => r.id)
  const claimIds = (await db.select({ id: claims.id }).from(claims).where(owned(claims, ownerId, eq(claims.personId, fromId)))).map((r) => r.id)
  const dateIds = (await db.select({ id: importantDates.id }).from(importantDates).where(owned(importantDates, ownerId, eq(importantDates.personId, fromId)))).map((r) => r.id)
  const eventIds = (await db.select({ id: eventParticipants.eventId }).from(eventParticipants).where(owned(eventParticipants, ownerId, eq(eventParticipants.personId, fromId)))).map((r) => r.id)
  const loopIds = (await db.select({ id: loops.id }).from(loops).where(owned(loops, ownerId, eq(loops.personId, fromId)))).map((r) => r.id)
  const partRows = await db
    .select({ segmentId: segmentParticipants.segmentId, messageCount: segmentParticipants.messageCount })
    .from(segmentParticipants)
    .where(owned(segmentParticipants, ownerId, eq(segmentParticipants.personId, fromId)))
  const rels = await db
    .select()
    .from(relations)
    .where(owned(relations, ownerId, or(inArray(relations.fromPersonId, [fromId, intoId]), inArray(relations.toPersonId, [fromId, intoId]))))

  const stmts: Stmt[] = [
    db.update(handles).set({ personId: intoId, updatedAt: now }).where(owned(handles, ownerId, eq(handles.personId, fromId))),
    db.update(claims).set({ personId: intoId, updatedAt: now }).where(owned(claims, ownerId, eq(claims.personId, fromId))),
    db.update(importantDates).set({ personId: intoId, updatedAt: now }).where(owned(importantDates, ownerId, eq(importantDates.personId, fromId))),
    // loops belong to a person like a claim does; segment_participants is a link table and is folded below
    db.update(loops).set({ personId: intoId, updatedAt: now }).where(owned(loops, ownerId, eq(loops.personId, fromId))),
  ]

  // segment_participants: both persons may already be in the same segment, and the pk is (segment_id, person_id),
  // so a collision sums `message_count` — the two rows counted different messages of the one conversation
  // (ARCHITECTURE §11 Merge).
  stmts.push(
    ...chunk(partRows, rowsPerInsert(5)).map((part) =>
      db
        .insert(segmentParticipants)
        .values(part.map((r) => withOwnerLink<typeof segmentParticipants>(ownerId, { segmentId: r.segmentId, personId: intoId, messageCount: r.messageCount }, now)))
        .onConflictDoUpdate({
          target: [segmentParticipants.segmentId, segmentParticipants.personId],
          set: { messageCount: sql`${segmentParticipants.messageCount} + excluded.message_count` },
        }),
    ),
    db.delete(segmentParticipants).where(owned(segmentParticipants, ownerId, eq(segmentParticipants.personId, fromId))),
  )

  // claim_mentions: re-point, then drop mentions of a person inside their own claims.
  const mentionRows = await db.select({ claimId: claimMentions.claimId }).from(claimMentions).where(owned(claimMentions, ownerId, eq(claimMentions.personId, fromId)))
  stmts.push(
    ...chunk(mentionRows, LINK_ROWS).map((part) =>
      db.insert(claimMentions).values(part.map((m) => withOwnerLink<typeof claimMentions>(ownerId, { claimId: m.claimId, personId: intoId }, now))).onConflictDoNothing(),
    ),
    db.delete(claimMentions).where(owned(claimMentions, ownerId, eq(claimMentions.personId, fromId))),
    db
      .delete(claimMentions)
      .where(owned(claimMentions, ownerId, eq(claimMentions.personId, intoId), inArray(claimMentions.claimId, db.select({ id: claims.id }).from(claims).where(owned(claims, ownerId, eq(claims.personId, intoId)))))),
  )

  // event participants
  stmts.push(
    ...chunk(eventIds, LINK_ROWS).map((part) =>
      db.insert(eventParticipants).values(part.map((eventId) => withOwnerLink<typeof eventParticipants>(ownerId, { eventId, personId: intoId }, now))).onConflictDoNothing(),
    ),
    db.delete(eventParticipants).where(owned(eventParticipants, ownerId, eq(eventParticipants.personId, fromId))),
  )

  // relations: remap endpoints; self-loops are deleted; exact duplicates (from, to, type) merge evidence into the keeper.
  const logs: LogEntry[] = []
  const remap = (id: number) => (id === fromId ? intoId : id)
  const keepers = new Map<string, RelationRow>()
  const keyOf = (f: number, t: number, type: string) => `${f}:${t}:${type}`
  for (const r of rels.filter((r) => r.fromPersonId !== fromId && r.toPersonId !== fromId)) keepers.set(keyOf(r.fromPersonId, r.toPersonId, r.type), r)
  let relationsMoved = 0
  for (const r of rels.filter((r) => r.fromPersonId === fromId || r.toPersonId === fromId)) {
    const f = remap(r.fromPersonId)
    const t = remap(r.toPersonId)
    relationsMoved++
    const before = { fromPersonId: r.fromPersonId, toPersonId: r.toPersonId }
    if (f === t) {
      stmts.push(
        db.delete(evidence).where(owned(evidence, ownerId, eq(evidence.targetType, 'relation'), eq(evidence.targetId, r.id))),
        db.delete(relations).where(owned(relations, ownerId, eq(relations.id, r.id))),
      )
      logs.push({ targetType: 'relation', targetId: r.id, action: 'merge', before, after: { deleted: 'self_loop', mergedIntoPersonId: intoId } })
      continue
    }
    const keeper = keepers.get(keyOf(f, t, r.type))
    if (keeper) {
      const ev = await db.select({ messageId: evidence.messageId }).from(evidence).where(owned(evidence, ownerId, eq(evidence.targetType, 'relation'), eq(evidence.targetId, r.id)))
      stmts.push(
        ...chunk(ev, EVIDENCE_ROWS).map((part) =>
          db.insert(evidence).values(part.map((e) => withOwnerLink<typeof evidence>(ownerId, { targetType: 'relation', targetId: keeper.id, messageId: e.messageId }, now))).onConflictDoNothing(),
        ),
        db.delete(evidence).where(owned(evidence, ownerId, eq(evidence.targetType, 'relation'), eq(evidence.targetId, r.id))),
        db.delete(relations).where(owned(relations, ownerId, eq(relations.id, r.id))),
      )
      if (r.status === 'confirmed' && keeper.status !== 'confirmed') {
        stmts.push(db.update(relations).set({ status: 'confirmed', updatedAt: now }).where(owned(relations, ownerId, eq(relations.id, keeper.id))))
        keeper.status = 'confirmed'
      }
      logs.push({ targetType: 'relation', targetId: r.id, action: 'merge', before, after: { deleted: 'duplicate', keptRelationId: keeper.id, mergedIntoPersonId: intoId } })
      continue
    }
    stmts.push(db.update(relations).set({ fromPersonId: f, toPersonId: t, updatedAt: now }).where(owned(relations, ownerId, eq(relations.id, r.id))))
    keepers.set(keyOf(f, t, r.type), { ...r, fromPersonId: f, toPersonId: t })
    logs.push({ targetType: 'relation', targetId: r.id, action: 'merge', before, after: { fromPersonId: f, toPersonId: t, mergedIntoPersonId: intoId } })
  }

  // persons (last: while `from` is not marked merged, an interrupted multi-chunk merge can simply be run again)
  const lastMessageAt = [from.lastMessageAt, into.lastMessageAt].filter(Boolean).sort().pop() ?? null
  const personStmts: Stmt[] = [
    db.update(persons).set({ mergedIntoId: intoId, pinned: false, updatedAt: now }).where(owned(persons, ownerId, eq(persons.id, fromId))),
    db.update(persons).set({ mergedIntoId: intoId, updatedAt: now }).where(owned(persons, ownerId, eq(persons.mergedIntoId, fromId))),
    db.update(persons).set({ pinned: into.pinned || from.pinned, lastMessageAt, updatedAt: now }).where(owned(persons, ownerId, eq(persons.id, intoId))),
  ]

  const moved = (type: TargetType, ids: number[]) => ids.map((id) => ({ targetType: type, targetId: id, action: 'merge' as const, before: { personId: fromId }, after: { personId: intoId } }))
  logs.push(
    ...moved('handle', handleIds),
    ...moved('claim', claimIds),
    ...moved('date', dateIds),
    ...moved('event', eventIds),
    ...moved('loop', loopIds),
    ...moved('segment', partRows.map((r) => r.segmentId)),
  )
  await runBatch(db, [...stmts, ...logStatements(db, ownerId, logs, now), ...personStmts])

  const target = await getPerson(db, ownerId, intoId)
  return {
    person: personDTO(target),
    moved: {
      handle: handleIds.length,
      claim: claimIds.length,
      date: dateIds.length,
      relation: relationsMoved,
      event: eventIds.length,
      loop: loopIds.length,
      // one per segment the person spoke in; the segment itself is not moved, only who spoke in it
      segment: partRows.length,
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------
// split

export async function splitHandle(
  db: Db,
  ownerId: string,
  personId: number,
  handleId: number,
  into?: SplitPersonRequest['into'],
): Promise<SplitPersonResponse> {
  const person = await getActivePerson(db, ownerId, personId)
  const handle = await db.select().from(handles).where(owned(handles, ownerId, eq(handles.id, handleId))).get()
  if (!handle || handle.personId !== person.id) throw errors.notFound('这个人物没有这个别名')
  const now = nowIso()

  let target: PersonRow
  let createdPersonId: number | null = null
  if (into && 'personId' in into) {
    if (into.personId === personId) throw errors.validation('不能拆到同一个人物')
    target = await getActivePerson(db, ownerId, into.personId)
  } else {
    const label = into && 'newPerson' in into ? into.newPerson.label : handle.value
    const created = await createPerson(db, ownerId, label)
    target = await getPerson(db, ownerId, created.id)
    createdPersonId = created.id
  }

  // Items of the original person whose evidence messages were all sent by this handle → back to proposed.
  const claimRows = await db.select({ id: claims.id, status: claims.status, importId: claims.importId }).from(claims).where(owned(claims, ownerId, eq(claims.personId, personId)))
  const dateRows = await db.select({ id: importantDates.id, status: importantDates.status, importId: importantDates.importId }).from(importantDates).where(owned(importantDates, ownerId, eq(importantDates.personId, personId)))
  const relRows = await db
    .select({ id: relations.id, status: relations.status, importId: relations.importId })
    .from(relations)
    .where(owned(relations, ownerId, or(eq(relations.fromPersonId, personId), eq(relations.toPersonId, personId))))
  const eventIds = (await db.select({ id: eventParticipants.eventId }).from(eventParticipants).where(owned(eventParticipants, ownerId, eq(eventParticipants.personId, personId)))).map((r) => r.id)
  const eventRows = eventIds.length ? ((await loadRows(db, ownerId, 'event', eventIds)) as { id: number; status: ClaimRow['status']; importId: number | null }[]) : []
  const handleRows = await db
    .select({ id: handles.id, status: handles.status, importId: handles.importId })
    .from(handles)
    .where(owned(handles, ownerId, eq(handles.personId, personId)))

  const pools: [TargetType, { id: number; status: ClaimRow['status']; importId: number | null }[]][] = [
    ['claim', claimRows],
    ['date', dateRows],
    ['relation', relRows],
    ['event', eventRows],
    ['handle', handleRows.filter((h) => h.id !== handleId)],
  ]
  const candidates: { targetType: TargetType; targetId: number }[] = []
  const stmts: Stmt[] = [db.update(handles).set({ personId: target.id, updatedAt: now }).where(owned(handles, ownerId, eq(handles.id, handleId)))]
  const logs: LogEntry[] = [{ targetType: 'handle', targetId: handleId, action: 'split', before: { personId }, after: { personId: target.id } }]
  const importIds: (number | null)[] = []
  for (const [type, rows] of pools) {
    const live = rows.filter((r) => r.status === 'confirmed' || r.status === 'proposed')
    if (live.length === 0) continue
    const senders = new Map<number, Set<number | null>>()
    for (const part of chunk(live.map((r) => r.id), IN_CHUNK)) {
      const ev = await db
        .select({ targetId: evidence.targetId, sender: messages.senderHandleId })
        .from(evidence)
        .innerJoin(messages, eq(messages.id, evidence.messageId))
        .where(owned(evidence, ownerId, eq(evidence.targetType, type), inArray(evidence.targetId, part)))
      for (const e of ev) senders.set(e.targetId, (senders.get(e.targetId) ?? new Set()).add(e.sender))
    }
    for (const r of live) {
      const s = senders.get(r.id)
      if (!s || s.size !== 1 || !s.has(handleId)) continue
      candidates.push({ targetType: type, targetId: r.id })
      importIds.push(r.importId)
      if (r.status === 'confirmed') {
        const t = TABLES[type] as typeof relations
        stmts.push(
          type === 'claim'
            ? db.update(claims).set({ status: 'proposed', statusChangedAt: now, updatedAt: now }).where(owned(claims, ownerId, eq(claims.id, r.id)))
            : db.update(t).set({ status: 'proposed', updatedAt: now }).where(owned(t, ownerId, eq(t.id, r.id))),
        )
      }
      logs.push({ targetType: type, targetId: r.id, action: 'split', before: { status: r.status }, after: { status: 'proposed', handleId, splitToPersonId: target.id } })
    }
  }
  // One batch normally (atomic). If it fails, the handle goes back and a person created for the split is removed.
  await runBatchOrUndo(db, [...stmts, ...logStatements(db, ownerId, logs, now)], async () => {
    await db.update(handles).set({ personId, updatedAt: now }).where(owned(handles, ownerId, eq(handles.id, handleId)))
    if (createdPersonId != null) await db.delete(persons).where(owned(persons, ownerId, eq(persons.id, createdPersonId)))
  })
  await refreshLastMessageAt(db, ownerId, [personId, target.id], now)
  await syncImportStatus(db, ownerId, importIds)
  return { person: personDTO(await getPerson(db, ownerId, target.id)), movedEvidenceCandidates: candidates }
}

async function refreshLastMessageAt(db: Db, ownerId: string, personIds: number[], now: string): Promise<void> {
  for (const id of uniq(personIds)) {
    const [r] = await db
      .select({ last: max(messages.sentAt) })
      .from(messages)
      .innerJoin(handles, eq(handles.id, messages.senderHandleId))
      .where(owned(messages, ownerId, eq(handles.personId, id)))
    await db.update(persons).set({ lastMessageAt: r?.last ?? null, updatedAt: now }).where(owned(persons, ownerId, eq(persons.id, id)))
  }
}

// ---------------------------------------------------------------------------------------------------------------
// manual add (sourceKind manual, confirmed, no evidence; reviewLog action 'edit' with before null)

const createdLog = (type: TargetType, id: number, after: unknown): LogEntry => ({ targetType: type, targetId: id, action: 'edit', before: null, after: { created: 'manual', ...(after as object) } })

export async function addClaim(db: Db, ownerId: string, personId: number, body: AddClaimRequest): Promise<ClaimDTO> {
  await getActivePerson(db, ownerId, personId)
  const now = nowIso()
  const statement = body.statement.trim()
  const [row] = await db
    .insert(claims)
    .values(
      withOwner<typeof claims>(
        ownerId,
        {
          personId,
          statement,
          statementNorm: norm(statement),
          category: body.category,
          validFrom: body.validFrom ?? null,
          validTo: null,
          learnedAt: now,
          confidence: null,
          sensitive: false,
          status: 'confirmed',
          statusReason: null,
          statusChangedAt: now,
          supersedesClaimId: null,
          supersededByClaimId: null,
          importId: null,
          jobId: null,
          sourceKind: 'manual',
        },
        now,
      ),
    )
    .returning()
  const mentionIds = await detectMentions(db, ownerId, personId, statement)
  await runBatchOrUndo(db, [
    ...chunk(mentionIds, LINK_ROWS).map((part) =>
      db.insert(claimMentions).values(part.map((pid) => withOwnerLink<typeof claimMentions>(ownerId, { claimId: row.id, personId: pid }, now))).onConflictDoNothing(),
    ),
    ...logStatements(db, ownerId, [createdLog('claim', row.id, { statement, category: body.category, validFrom: body.validFrom ?? null })], now),
  ], async () => {
    await db.delete(claimMentions).where(owned(claimMentions, ownerId, eq(claimMentions.claimId, row.id)))
    await db.delete(claims).where(owned(claims, ownerId, eq(claims.id, row.id)))
  })
  const [dto] = await claimDTOs(db, ownerId, [row])
  return dto
}

export async function addDate(db: Db, ownerId: string, personId: number, body: AddDateRequest): Promise<ImportantDateDTO> {
  await getActivePerson(db, ownerId, personId)
  validateDay(body.calendar, body.month, body.day)
  const now = nowIso()
  const [row] = await db
    .insert(importantDates)
    .values(
      withOwner<typeof importantDates>(
        ownerId,
        {
          personId,
          kind: body.kind,
          month: body.month,
          day: body.day,
          year: body.year ?? null,
          calendar: body.calendar,
          isLeapMonth: body.calendar === 'lunar' ? Boolean(body.isLeapMonth) : false,
          label: body.label?.trim() || null,
          status: 'confirmed',
          importId: null,
          sourceKind: 'manual',
        },
        now,
      ),
    )
    .returning()
  await runBatchOrUndo(db, logStatements(db, ownerId, [createdLog('date', row.id, { kind: row.kind, month: row.month, day: row.day, calendar: row.calendar })], now), async () => {
    await db.delete(importantDates).where(owned(importantDates, ownerId, eq(importantDates.id, row.id)))
  })
  const [dto] = await dateDTOs(db, ownerId, [row])
  return dto
}

export async function addRelation(db: Db, ownerId: string, personId: number, body: AddRelationRequest): Promise<RelationDTO> {
  if (body.toPersonId === personId) throw errors.validation('不能和自己建立关系')
  await getActivePerson(db, ownerId, personId)
  await getActivePerson(db, ownerId, body.toPersonId)
  const now = nowIso()
  const [row] = await db
    .insert(relations)
    .values(
      withOwner<typeof relations>(
        ownerId,
        { fromPersonId: personId, toPersonId: body.toPersonId, type: body.type, label: body.label?.trim() || null, status: 'confirmed', importId: null, sourceKind: 'manual' },
        now,
      ),
    )
    .returning()
  await runBatchOrUndo(db, logStatements(db, ownerId, [createdLog('relation', row.id, { fromPersonId: personId, toPersonId: body.toPersonId, type: body.type, label: row.label })], now), async () => {
    await db.delete(relations).where(owned(relations, ownerId, eq(relations.id, row.id)))
  })
  const [dto] = await relationDTOs(db, ownerId, [row])
  return dto
}

export async function addEvent(db: Db, ownerId: string, personId: number, body: AddEventRequest): Promise<EventDTO> {
  await getActivePerson(db, ownerId, personId)
  const participantIds = uniq([personId, ...body.participantIds])
  for (const part of chunk(participantIds, IN_CHUNK)) {
    const found = await db
      .select({ id: persons.id })
      .from(persons)
      .where(owned(persons, ownerId, inArray(persons.id, part), isNull(persons.mergedIntoId)))
    if (found.length !== part.length) throw errors.notFound('参与者中有找不到的人物')
  }
  const now = nowIso()
  const [row] = await db
    .insert(events)
    .values(
      withOwner<typeof events>(
        ownerId,
        { summary: body.summary.trim(), happenedAt: body.happenedAt ?? null, place: body.place?.trim() || null, status: 'confirmed', importId: null, sourceKind: 'manual' },
        now,
      ),
    )
    .returning()
  await runBatchOrUndo(db, [
    ...chunk(participantIds, LINK_ROWS).map((part) =>
      db.insert(eventParticipants).values(part.map((pid) => withOwnerLink<typeof eventParticipants>(ownerId, { eventId: row.id, personId: pid }, now))),
    ),
    ...logStatements(db, ownerId, [createdLog('event', row.id, { summary: row.summary, happenedAt: row.happenedAt, participantIds })], now),
  ], async () => {
    await db.delete(eventParticipants).where(owned(eventParticipants, ownerId, eq(eventParticipants.eventId, row.id)))
    await db.delete(events).where(owned(events, ownerId, eq(events.id, row.id)))
  })
  const [dto] = await eventDTOs(db, ownerId, [row])
  return dto
}

