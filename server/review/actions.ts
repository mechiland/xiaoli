// Review actions: accept / reject / edit / supersede / delete, bulk, import status sync (ARCHITECTURE §1.6, §11).
import { count, eq, inArray, isNull, ne } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { BulkReviewResponse, ClaimDTO, ReviewRequest, ReviewResponse, TargetType } from '@/contracts'
import { nowIso, todayInTz } from '@/lib/time'
import {
  claimMentions,
  claims,
  eventParticipants,
  events,
  evidence,
  handles,
  importantDates,
  imports,
  loops,
  messages,
  owned,
  persons,
  relations,
  withOwner,
  withOwnerLink,
  type Db,
} from '@/server/db'
import { ApiError, errors } from '@/server/errors'
import {
  assertReviewable,
  claimDTOs,
  itemDTO,
  loadRow,
  loadRows,
  REVIEWABLE,
  TABLES,
  type ClaimRow,
  type DateRow,
  type EventRow,
  type HandleRow,
  type ItemRow,
  type LoopRow,
  type RelationRow,
} from './dto'
import { chunk, EVIDENCE_ROWS, IN_CHUNK, LINK_ROWS, logStatements, norm, runBatch, runBatchOrUndo, uniq, type LogEntry } from './util'

export interface ReviewTarget {
  type: TargetType
  id: number
}
export type ReviewActionName = ReviewRequest['action']
export type ReviewPatch = NonNullable<ReviewRequest['patch']>
type Stmt = BatchItem<'sqlite'>

// ---------------------------------------------------------------------------------------------------------------
// shared pieces

/** Persons (not self, not merged, not the subject) whose label occurs in the statement → claim_mentions rows. */
export async function detectMentions(db: Db, ownerId: string, subjectId: number, statement: string): Promise<number[]> {
  const rows = await db
    .select({ id: persons.id, label: persons.label })
    .from(persons)
    .where(owned(persons, ownerId, isNull(persons.mergedIntoId), eq(persons.isSelf, false), ne(persons.id, subjectId)))
  return rows.filter((p) => [...p.label].length >= 2 && statement.includes(p.label)).map((p) => p.id)
}

function mentionInserts(db: Db, ownerId: string, claimId: number, personIds: number[], now: string): Stmt[] {
  return chunk(personIds, LINK_ROWS).map((part) =>
    db
      .insert(claimMentions)
      .values(part.map((personId) => withOwnerLink<typeof claimMentions>(ownerId, { claimId, personId }, now)))
      .onConflictDoNothing(),
  )
}

function setStatus(db: Db, ownerId: string, type: TargetType, id: number, status: ItemRow['status'], now: string): Stmt {
  if (type === 'claim') {
    return db.update(claims).set({ status, statusChangedAt: now, updatedAt: now }).where(owned(claims, ownerId, eq(claims.id, id)))
  }
  const t = TABLES[type] as typeof relations
  return db.update(t).set({ status, updatedAt: now }).where(owned(t, ownerId, eq(t.id, id)))
}

const snapshot = (row: ItemRow): Record<string, unknown> => {
  const { ownerId: _o, createdAt: _c, updatedAt: _u, ...rest } = row as ItemRow & { ownerId: string }
  return rest
}

/** Claims that `rows` supersede (for supersede-on-confirm) and that point back at them (for reject restore). */
async function relatedClaims(db: Db, ownerId: string, rows: ClaimRow[]): Promise<Map<number, ClaimRow>> {
  const m = new Map<number, ClaimRow>()
  const olderIds = uniq(rows.map((r) => r.supersedesClaimId).filter((x): x is number => x != null))
  for (const r of (await loadRows(db, ownerId, 'claim', olderIds)) as ClaimRow[]) m.set(r.id, r)
  for (const part of chunk(rows.map((r) => r.id), IN_CHUNK)) {
    const back = await db.select().from(claims).where(owned(claims, ownerId, inArray(claims.supersededByClaimId, part)))
    for (const r of back) m.set(r.id, r)
  }
  return m
}

interface Plan {
  stmts: Stmt[]
  logs: LogEntry[]
  superseded: number[]
  noop: boolean
}

/**
 * accept / reject of one loaded row. Throws ApiError(409) when the row is superseded (history is read-only).
 * Mutates `row` and the rows in `related` to the planned state, so later plans in the same bulk request see it
 * (e.g. an older claim superseded earlier in the batch is not confirmed again).
 */
function planStatus(db: Db, ownerId: string, type: TargetType, row: ItemRow, action: 'accept' | 'reject', related: Map<number, ClaimRow>, now: string): Plan {
  const plan: Plan = { stmts: [], logs: [], superseded: [], noop: false }
  if (row.status === 'superseded') throw errors.conflict('这条信息已经被取代，不能再修改')
  const next = action === 'accept' ? 'confirmed' : 'rejected'
  if (row.status === next) {
    plan.noop = true
    return plan
  }
  plan.stmts.push(setStatus(db, ownerId, type, row.id, next, now))
  plan.logs.push({ targetType: type, targetId: row.id, action, before: { status: row.status }, after: { status: next } })
  if (type !== 'claim') {
    row.status = next
    return plan
  }
  const claim = row as ClaimRow
  if (action === 'accept' && claim.supersedesClaimId != null) {
    plan.stmts.push(...supersedeOnConfirm(db, ownerId, claim, related, now, plan))
  }
  const wasConfirmed = claim.status === 'confirmed'
  claim.status = next
  if (action === 'reject' && wasConfirmed) {
    // Undo a supersede this claim caused: the replaced claim is current again.
    for (const old of related.values()) {
      if (old.supersededByClaimId !== claim.id || old.statusReason !== 'superseded' || old.status !== 'superseded') continue
      plan.stmts.push(
        db
          .update(claims)
          .set({ status: 'confirmed', statusReason: null, supersededByClaimId: null, statusChangedAt: now, updatedAt: now })
          .where(owned(claims, ownerId, eq(claims.id, old.id))),
      )
      plan.logs.push({ targetType: 'claim', targetId: old.id, action: 'reject', before: { status: 'superseded', supersededByClaimId: claim.id }, after: { status: 'confirmed', restoredBecauseRejected: claim.id } })
      Object.assign(old, { status: 'confirmed', statusReason: null, supersededByClaimId: null })
    }
  }
  return plan
}

/** Confirming a claim with supersedesClaimId marks the older claim superseded (SPEC §3, §9.9 "确认即右侧取代左侧"). */
function supersedeOnConfirm(db: Db, ownerId: string, claim: Pick<ClaimRow, 'id' | 'supersedesClaimId'>, related: Map<number, ClaimRow>, now: string, plan: Plan): Stmt[] {
  const old = claim.supersedesClaimId != null ? related.get(claim.supersedesClaimId) : undefined
  if (!old || old.id === claim.id || (old.status !== 'confirmed' && old.status !== 'proposed')) return []
  plan.superseded.push(old.id)
  plan.logs.push({ targetType: 'claim', targetId: old.id, action: 'supersede', before: { status: old.status }, after: { status: 'superseded', statusReason: 'superseded', supersededByClaimId: claim.id } })
  Object.assign(old, { status: 'superseded', statusReason: 'superseded', supersededByClaimId: claim.id })
  return [
    db
      .update(claims)
      .set({ status: 'superseded', statusReason: 'superseded', supersededByClaimId: claim.id, statusChangedAt: now, updatedAt: now })
      .where(owned(claims, ownerId, eq(claims.id, old.id))),
  ]
}

/** reviewing ⇄ done: an import is done once none of its items is still proposed (seed V9, ARCHITECTURE §6). */
export async function syncImportStatus(db: Db, ownerId: string, importIds: (number | null | undefined)[]): Promise<void> {
  const ids = uniq(importIds.filter((x): x is number => typeof x === 'number'))
  if (ids.length === 0) return
  const rows = await db
    .select({ id: imports.id, status: imports.status })
    .from(imports)
    .where(owned(imports, ownerId, inArray(imports.id, ids.slice(0, IN_CHUNK))))
  const now = nowIso()
  for (const imp of rows) {
    if (imp.status !== 'reviewing' && imp.status !== 'done') continue
    let proposed = 0
    for (const t of Object.values(REVIEWABLE) as (typeof relations)[]) {
      const [r] = await db.select({ n: count() }).from(t).where(owned(t, ownerId, eq(t.importId, imp.id), eq(t.status, 'proposed')))
      proposed += r?.n ?? 0
      if (proposed > 0) break
    }
    const next = proposed === 0 ? 'done' : 'reviewing'
    if (next !== imp.status) {
      await db.update(imports).set({ status: next, updatedAt: now }).where(owned(imports, ownerId, eq(imports.id, imp.id)))
    }
  }
}

/** Undo of a claim row inserted before a batch that then failed: its links and the row itself. */
async function removeInsertedClaim(db: Db, ownerId: string, id: number): Promise<void> {
  await db.batch([
    db.delete(evidence).where(owned(evidence, ownerId, eq(evidence.targetType, 'claim'), eq(evidence.targetId, id))),
    db.delete(claimMentions).where(owned(claimMentions, ownerId, eq(claimMentions.claimId, id))),
    db.update(claims).set({ supersededByClaimId: null }).where(owned(claims, ownerId, eq(claims.supersededByClaimId, id))),
    db.delete(claims).where(owned(claims, ownerId, eq(claims.id, id))),
  ])
}

async function claimDTOById(db: Db, ownerId: string, ids: number[]): Promise<ClaimDTO[]> {
  if (ids.length === 0) return []
  return claimDTOs(db, ownerId, (await loadRows(db, ownerId, 'claim', ids)) as ClaimRow[])
}

// ---------------------------------------------------------------------------------------------------------------
// applyReview

export async function applyReview(
  db: Db,
  ownerId: string,
  target: ReviewTarget,
  action: ReviewActionName,
  patch?: ReviewPatch,
  opts: { replacement?: { statement: string } } = {},
): Promise<ReviewResponse> {
  // A 段落摘要 is a log of what was said that day, not an assertion about a person, so it has no 确认/不对 at all
  // (SPEC §9.9). Failing loudly here keeps a stray `POST /api/review/segment/:id` from looking like it worked;
  // editing or hiding a segment is `PATCH /api/segments/:id` (interaction).
  assertReviewable(target.type)
  const row = await loadRow(db, ownerId, target.type, target.id)
  if (!row) throw errors.notFound()
  const now = nowIso()
  switch (action) {
    case 'accept':
    case 'reject': {
      const related = target.type === 'claim' ? await relatedClaims(db, ownerId, [row as ClaimRow]) : new Map()
      const plan = planStatus(db, ownerId, target.type, row, action, related, now)
      if (!plan.noop) await runBatch(db, [...plan.stmts, ...logStatements(db, ownerId, plan.logs, now)])
      await syncImportStatus(db, ownerId, [row.importId])
      const fresh = (await loadRow(db, ownerId, target.type, target.id))!
      const superseded = await claimDTOById(db, ownerId, plan.superseded)
      return { item: await itemDTO(db, ownerId, target.type, fresh), ...(superseded.length ? { superseded } : {}) }
    }
    case 'edit':
      return editItem(db, ownerId, target.type, row, patch ?? {}, now)
    case 'supersede':
      return supersedeClaim(db, ownerId, target.type, row, opts.replacement, now)
    case 'delete':
      return deleteItem(db, ownerId, target.type, row, now)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// edit

const has = (v: unknown) => v !== undefined

async function editItem(db: Db, ownerId: string, type: TargetType, row: ItemRow, patch: ReviewPatch, now: string): Promise<ReviewResponse> {
  if (row.status === 'superseded') throw errors.conflict('这条信息已经被取代，不能再修改')
  switch (type) {
    case 'claim':
      return editClaim(db, ownerId, row as ClaimRow, patch, now)
    case 'handle': {
      const h = row as HandleRow
      if (!has(patch.value)) throw errors.validation('没有要修改的内容')
      const value = patch.value!
      const clash = await db
        .select({ id: handles.id })
        .from(handles)
        .where(owned(handles, ownerId, eq(handles.kind, h.kind), eq(handles.value, value), h.chatId == null ? isNull(handles.chatId) : eq(handles.chatId, h.chatId), ne(handles.id, h.id)))
        .get()
      if (clash) throw errors.conflict('已经有一个相同的别名了', { handleId: clash.id })
      const stmts: Stmt[] = [
        db.update(handles).set({ value, valueNorm: norm(value), status: 'confirmed', updatedAt: now }).where(owned(handles, ownerId, eq(handles.id, h.id))),
      ]
      return finishSimpleEdit(db, ownerId, type, row, stmts, { value: h.value, status: h.status }, { value, status: 'confirmed' }, now)
    }
    case 'relation': {
      const r = row as RelationRow
      if (!has(patch.type) && !has(patch.label)) throw errors.validation('没有要修改的内容')
      const set = { type: patch.type ?? r.type, label: has(patch.label) ? patch.label!.trim() || null : r.label }
      const stmts: Stmt[] = [
        db.update(relations).set({ ...set, status: 'confirmed', updatedAt: now }).where(owned(relations, ownerId, eq(relations.id, r.id))),
      ]
      return finishSimpleEdit(db, ownerId, type, row, stmts, { type: r.type, label: r.label, status: r.status }, { ...set, status: 'confirmed' }, now)
    }
    case 'event': {
      const e = row as EventRow
      if (!has(patch.summary) && !has(patch.happenedAt) && !has(patch.place)) throw errors.validation('没有要修改的内容')
      const set = {
        summary: patch.summary ?? e.summary,
        happenedAt: patch.happenedAt ?? e.happenedAt,
        place: has(patch.place) ? patch.place!.trim() || null : e.place,
      }
      const stmts: Stmt[] = [
        db.update(events).set({ ...set, status: 'confirmed', updatedAt: now }).where(owned(events, ownerId, eq(events.id, e.id))),
      ]
      return finishSimpleEdit(db, ownerId, type, row, stmts, { summary: e.summary, happenedAt: e.happenedAt, place: e.place, status: e.status }, { ...set, status: 'confirmed' }, now)
    }
    case 'loop': {
      const l = row as LoopRow
      if (!has(patch.text) && !has(patch.dueAt) && !has(patch.kind) && !has(patch.direction)) {
        throw errors.validation('没有要修改的内容')
      }
      const text = patch.text?.trim() || l.text
      const set = {
        text,
        textNorm: norm(text),
        dueAt: has(patch.dueAt) ? (patch.dueAt ?? null) : l.dueAt,
        kind: patch.kind ?? l.kind,
        direction: patch.direction ?? l.direction,
      }
      const stmts: Stmt[] = [
        db.update(loops).set({ ...set, status: 'confirmed', updatedAt: now }).where(owned(loops, ownerId, eq(loops.id, l.id))),
      ]
      const before = { text: l.text, dueAt: l.dueAt, kind: l.kind, direction: l.direction, status: l.status }
      return finishSimpleEdit(db, ownerId, type, row, stmts, before, { ...set, status: 'confirmed' }, now)
    }
    case 'segment':
      throw errors.validation('段落摘要不需要确认，可以直接改写或隐藏')
    case 'date': {
      const d = row as DateRow
      if (!has(patch.month) && !has(patch.day) && !has(patch.year) && !has(patch.calendar) && !has(patch.label)) {
        throw errors.validation('没有要修改的内容')
      }
      const set = {
        month: patch.month ?? d.month,
        day: patch.day ?? d.day,
        year: has(patch.year) ? patch.year! : d.year,
        calendar: patch.calendar ?? d.calendar,
        label: has(patch.label) ? patch.label!.trim() || null : d.label,
      }
      validateDay(set.calendar, set.month, set.day)
      const stmts: Stmt[] = [
        db.update(importantDates).set({ ...set, status: 'confirmed', updatedAt: now }).where(owned(importantDates, ownerId, eq(importantDates.id, d.id))),
      ]
      return finishSimpleEdit(db, ownerId, type, row, stmts, { month: d.month, day: d.day, year: d.year, calendar: d.calendar, label: d.label, status: d.status }, { ...set, status: 'confirmed' }, now)
    }
  }
}

export function validateDay(calendar: 'solar' | 'lunar', month: number | null, day: number | null): void {
  if (month == null || day == null) return
  const max = calendar === 'lunar' ? 30 : [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  if (day > max) throw errors.validation('这个日期不存在')
}

async function finishSimpleEdit(db: Db, ownerId: string, type: TargetType, row: ItemRow, stmts: Stmt[], before: unknown, after: unknown, now: string): Promise<ReviewResponse> {
  await runBatch(db, [...stmts, ...logStatements(db, ownerId, [{ targetType: type, targetId: row.id, action: 'edit', before, after }], now)])
  await syncImportStatus(db, ownerId, [row.importId])
  const fresh = (await loadRow(db, ownerId, type, row.id))!
  return { item: await itemDTO(db, ownerId, type, fresh) }
}

async function editClaim(db: Db, ownerId: string, c: ClaimRow, patch: ReviewPatch, now: string): Promise<ReviewResponse> {
  if (!has(patch.statement) && !has(patch.category) && !has(patch.validFrom)) throw errors.validation('没有要修改的内容')
  const statement = patch.statement ?? c.statement
  const category = patch.category ?? c.category
  const validFrom = has(patch.validFrom) ? patch.validFrom! : c.validFrom
  const mentionIds = await detectMentions(db, ownerId, c.personId, statement)
  const before = { statement: c.statement, category: c.category, validFrom: c.validFrom, status: c.status }

  if (c.status === 'confirmed') {
    // Person page "改写": new confirmed row, the original goes to 历史 (DECISIONS A5 #9).
    const inserted = await db
      .insert(claims)
      .values(
        withOwner<typeof claims>(
          ownerId,
          {
            personId: c.personId,
            statement,
            statementNorm: norm(statement),
            category,
            validFrom,
            validTo: c.validTo,
            learnedAt: c.learnedAt,
            confidence: c.confidence,
            sensitive: c.sensitive,
            status: 'confirmed',
            statusReason: null,
            statusChangedAt: now,
            supersedesClaimId: c.id,
            supersededByClaimId: null,
            importId: c.importId,
            jobId: c.jobId,
            sourceKind: c.sourceKind,
          },
          now,
        ),
      )
      .returning({ id: claims.id })
    const newId = inserted[0].id
    const ev = await db.select({ messageId: evidence.messageId }).from(evidence).where(owned(evidence, ownerId, eq(evidence.targetType, 'claim'), eq(evidence.targetId, c.id)))
    const stmts: Stmt[] = [
      ...chunk(ev, EVIDENCE_ROWS).map((part) =>
        db
          .insert(evidence)
          .values(part.map((e) => withOwnerLink<typeof evidence>(ownerId, { targetType: 'claim', targetId: newId, messageId: e.messageId }, now)))
          .onConflictDoNothing(),
      ),
      ...mentionInserts(db, ownerId, newId, mentionIds, now),
      db
        .update(claims)
        .set({ status: 'superseded', statusReason: 'edited', supersededByClaimId: newId, statusChangedAt: now, updatedAt: now })
        .where(owned(claims, ownerId, eq(claims.id, c.id))),
      ...logStatements(db, ownerId, [{ targetType: 'claim', targetId: c.id, action: 'edit', before, after: { statement, category, validFrom, claimId: newId } }], now),
    ]
    await runBatchOrUndo(db, stmts, async () => {
      await removeInsertedClaim(db, ownerId, newId)
      await db
        .update(claims)
        .set({ status: c.status, statusReason: c.statusReason, supersededByClaimId: c.supersededByClaimId, statusChangedAt: c.statusChangedAt, updatedAt: now })
        .where(owned(claims, ownerId, eq(claims.id, c.id)))
    })
    const [item] = await claimDTOById(db, ownerId, [newId])
    const superseded = await claimDTOById(db, ownerId, [c.id])
    return { item, superseded }
  }

  // proposed / rejected (import-result "改写"): edit in place and confirm; reviewLog keeps `before`.
  const related = await relatedClaims(db, ownerId, [c])
  const plan: Plan = { stmts: [], logs: [], superseded: [], noop: false }
  const stmts: Stmt[] = [
    db
      .update(claims)
      .set({ statement, statementNorm: norm(statement), category, validFrom, status: 'confirmed', statusChangedAt: now, updatedAt: now })
      .where(owned(claims, ownerId, eq(claims.id, c.id))),
    db.delete(claimMentions).where(owned(claimMentions, ownerId, eq(claimMentions.claimId, c.id))),
    ...mentionInserts(db, ownerId, c.id, mentionIds, now),
    ...supersedeOnConfirm(db, ownerId, c, related, now, plan),
  ]
  const logs: LogEntry[] = [{ targetType: 'claim', targetId: c.id, action: 'edit', before, after: { statement, category, validFrom, status: 'confirmed' } }, ...plan.logs]
  await runBatch(db, [...stmts, ...logStatements(db, ownerId, logs, now)])
  await syncImportStatus(db, ownerId, [c.importId])
  const [item] = await claimDTOById(db, ownerId, [c.id])
  const superseded = await claimDTOById(db, ownerId, plan.superseded)
  return { item, ...(superseded.length ? { superseded } : {}) }
}

// ---------------------------------------------------------------------------------------------------------------
// supersede ("已过时", optional "现在的情况")

async function supersedeClaim(db: Db, ownerId: string, type: TargetType, row: ItemRow, replacement: { statement: string } | undefined, now: string): Promise<ReviewResponse> {
  if (type !== 'claim') throw errors.validation('只有信息可以标记为已过时')
  const c = row as ClaimRow
  if (c.status !== 'confirmed') throw errors.conflict('只有已确认的信息可以标记为已过时')
  let createdId: number | null = null
  const stmts: Stmt[] = []
  if (replacement) {
    const inserted = await db
      .insert(claims)
      .values(
        withOwner<typeof claims>(
          ownerId,
          {
            personId: c.personId,
            statement: replacement.statement,
            statementNorm: norm(replacement.statement),
            category: c.category,
            validFrom: null,
            validTo: null,
            learnedAt: now,
            confidence: null,
            sensitive: false,
            status: 'confirmed',
            statusReason: null,
            statusChangedAt: now,
            supersedesClaimId: c.id,
            supersededByClaimId: null,
            importId: null,
            jobId: null,
            sourceKind: 'manual',
          },
          now,
        ),
      )
      .returning({ id: claims.id })
    createdId = inserted[0].id
    stmts.push(...mentionInserts(db, ownerId, createdId, await detectMentions(db, ownerId, c.personId, replacement.statement), now))
  }
  const validTo = todayInTz()
  stmts.push(
    db
      .update(claims)
      .set({ status: 'superseded', statusReason: 'outdated', validTo, supersededByClaimId: createdId, statusChangedAt: now, updatedAt: now })
      .where(owned(claims, ownerId, eq(claims.id, c.id))),
    ...logStatements(db, ownerId, [{ targetType: 'claim', targetId: c.id, action: 'supersede', before: { status: c.status, validTo: c.validTo }, after: { status: 'superseded', statusReason: 'outdated', validTo, replacementClaimId: createdId } }], now),
  )
  await runBatchOrUndo(db, stmts, async () => {
    if (createdId == null) return
    await removeInsertedClaim(db, ownerId, createdId)
    await db
      .update(claims)
      .set({ status: c.status, statusReason: c.statusReason, validTo: c.validTo, supersededByClaimId: c.supersededByClaimId, statusChangedAt: c.statusChangedAt, updatedAt: now })
      .where(owned(claims, ownerId, eq(claims.id, c.id)))
  })
  const [item] = await claimDTOById(db, ownerId, [c.id])
  const created = createdId != null ? (await claimDTOById(db, ownerId, [createdId]))[0] : undefined
  return { item, superseded: [item], ...(created ? { created } : {}) }
}

// ---------------------------------------------------------------------------------------------------------------
// delete (hard, not into history — ARCHITECTURE §11 "Delete item")

async function deleteItem(db: Db, ownerId: string, type: TargetType, row: ItemRow, now: string): Promise<ReviewResponse> {
  const item = await itemDTO(db, ownerId, type, row)
  const stmts: Stmt[] = [db.delete(evidence).where(owned(evidence, ownerId, eq(evidence.targetType, type), eq(evidence.targetId, row.id)))]
  if (type === 'claim') {
    stmts.push(
      db.delete(claimMentions).where(owned(claimMentions, ownerId, eq(claimMentions.claimId, row.id))),
      // a claim this one had replaced becomes current again; edited/outdated originals only lose the pointer
      db
        .update(claims)
        .set({ status: 'confirmed', statusReason: null, supersededByClaimId: null, statusChangedAt: now, updatedAt: now })
        .where(owned(claims, ownerId, eq(claims.supersededByClaimId, row.id), eq(claims.statusReason, 'superseded'))),
      db.update(claims).set({ supersededByClaimId: null, updatedAt: now }).where(owned(claims, ownerId, eq(claims.supersededByClaimId, row.id))),
      db.update(claims).set({ supersedesClaimId: null, updatedAt: now }).where(owned(claims, ownerId, eq(claims.supersedesClaimId, row.id))),
    )
  }
  if (type === 'event') stmts.push(db.delete(eventParticipants).where(owned(eventParticipants, ownerId, eq(eventParticipants.eventId, row.id))))
  if (type === 'handle') stmts.push(db.update(messages).set({ senderHandleId: null, updatedAt: now }).where(owned(messages, ownerId, eq(messages.senderHandleId, row.id))))
  const t = TABLES[type] as typeof relations
  stmts.push(db.delete(t).where(owned(t, ownerId, eq(t.id, row.id))))
  stmts.push(...logStatements(db, ownerId, [{ targetType: type, targetId: row.id, action: 'delete', before: snapshot(row), after: null }], now))
  await runBatch(db, stmts)
  await syncImportStatus(db, ownerId, [row.importId])
  return { item }
}

// ---------------------------------------------------------------------------------------------------------------
// bulk

export async function bulkReview(db: Db, ownerId: string, items: ReviewTarget[], action: 'accept' | 'reject'): Promise<BulkReviewResponse> {
  const failed: BulkReviewResponse['failed'] = []
  const stmts: Stmt[] = []
  const logs: LogEntry[] = []
  const importIds: (number | null)[] = []
  let updated = 0
  const now = nowIso()
  const seen = new Set<string>()
  const byType = new Map<TargetType, number[]>()
  for (const it of items) {
    const key = `${it.type}:${it.id}`
    if (seen.has(key)) continue
    seen.add(key)
    // segments are not reviewable (SPEC §9.9); report them instead of silently counting them as updated
    if (it.type === 'segment') {
      failed.push({ type: it.type, id: it.id, code: 'validation_failed' })
      continue
    }
    byType.set(it.type, [...(byType.get(it.type) ?? []), it.id])
  }
  for (const [type, ids] of byType) {
    const rows = await loadRows(db, ownerId, type, ids)
    const found = new Map(rows.map((r) => [r.id, r]))
    const related = type === 'claim' ? await relatedClaims(db, ownerId, rows as ClaimRow[]) : new Map<number, ClaimRow>()
    // one object per claim, so a plan's in-memory changes (planStatus) are seen by later items of this request
    for (const r of rows) if (related.has(r.id)) related.set(r.id, r as ClaimRow)
    for (const id of ids) {
      const row = found.get(id)
      if (!row) {
        failed.push({ type, id, code: 'not_found' })
        continue
      }
      try {
        const plan = planStatus(db, ownerId, type, row, action, related, now)
        stmts.push(...plan.stmts)
        logs.push(...plan.logs)
        importIds.push(row.importId)
        updated++
      } catch (e) {
        failed.push({ type, id, code: e instanceof ApiError ? e.code : 'internal' })
      }
    }
  }
  await runBatch(db, [...stmts, ...logStatements(db, ownerId, logs, now)])
  await syncImportStatus(db, ownerId, importIds)
  return { updated, failed }
}

