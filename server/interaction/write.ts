// Write side of the interaction layer: the few things a user can do to it by hand (SPEC §9.5, §9.9).
import { count, eq } from 'drizzle-orm'
import type { LoopCloseReason, LoopDTO, SegmentDTO } from '@/contracts'
import { nowIso, todayInTz } from '@/lib/time'
import { chats, conversationSegments, evidence, loops, owned, type Db } from '@/server/db'
import { errors } from '@/server/errors'

import { loadSegmentExtras, loopDTO, segmentColumns, segmentDTO, type LoopRow, type SegmentRow } from './dto'

function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase().trim()
}

async function loopOr404(db: Db, ownerId: string, loopId: number): Promise<LoopRow> {
  const row = await db.select().from(loops).where(owned(loops, ownerId, eq(loops.id, loopId))).get()
  if (!row) throw errors.notFound()
  return row as LoopRow
}

async function loopEvidenceCount(db: Db, ownerId: string, loopId: number): Promise<number> {
  const row = await db
    .select({ n: count() })
    .from(evidence)
    .where(owned(evidence, ownerId, eq(evidence.targetType, 'loop'), eq(evidence.targetId, loopId)))
    .get()
  return row?.n ?? 0
}

async function loopResult(db: Db, ownerId: string, loopId: number): Promise<LoopDTO> {
  const [row, n] = await Promise.all([loopOr404(db, ownerId, loopId), loopEvidenceCount(db, ownerId, loopId)])
  return loopDTO(row, n, todayInTz())
}

/**
 * Closing is also confirming (SPEC §7 交互层): a `proposed` loop becomes `confirmed`. `closedMessageId` stays null —
 * this was closed by hand, not by a sentence in a chat — and `closedAt` is the moment of the click.
 */
export async function closeLoop(db: Db, ownerId: string, loopId: number, reason: LoopCloseReason): Promise<LoopDTO> {
  const row = await loopOr404(db, ownerId, loopId)
  const now = nowIso()
  await db
    .update(loops)
    .set({
      closedReason: reason,
      closedAt: now,
      status: row.status === 'proposed' ? 'confirmed' : row.status,
      updatedAt: now,
    })
    .where(owned(loops, ownerId, eq(loops.id, loopId)))
  return loopResult(db, ownerId, loopId)
}

/** Back to unfinished: the close event is dropped, so a later import that closes it again lands on the same answer. */
export async function reopenLoop(db: Db, ownerId: string, loopId: number): Promise<LoopDTO> {
  await loopOr404(db, ownerId, loopId)
  await db
    .update(loops)
    .set({ closedReason: null, closedAt: null, closedMessageId: null, updatedAt: nowIso() })
    .where(owned(loops, ownerId, eq(loops.id, loopId)))
  return loopResult(db, ownerId, loopId)
}

/** Rewrite or hide one segment summary (SPEC §9.9). Editing the text makes the segment manual. */
export async function patchSegment(db: Db, ownerId: string, segmentId: number, patch: { summary?: string; hidden?: boolean }): Promise<SegmentDTO> {
  const existing = await db.select({ id: conversationSegments.id }).from(conversationSegments).where(owned(conversationSegments, ownerId, eq(conversationSegments.id, segmentId))).get()
  if (!existing) throw errors.notFound()

  const now = nowIso()
  const set: Partial<typeof conversationSegments.$inferInsert> = { updatedAt: now }
  if (patch.summary !== undefined) {
    const summary = patch.summary.trim()
    if (!summary) throw errors.validation('摘要不能为空')
    set.summary = summary
    set.summaryNorm = normalize(summary)
    set.sourceKind = 'manual'
  }
  if (patch.hidden !== undefined) set.hidden = patch.hidden
  await db.update(conversationSegments).set(set).where(owned(conversationSegments, ownerId, eq(conversationSegments.id, segmentId)))

  const row = await db
    .select(segmentColumns)
    .from(conversationSegments)
    .innerJoin(chats, eq(chats.id, conversationSegments.chatId))
    .where(owned(conversationSegments, ownerId, eq(conversationSegments.id, segmentId)))
    .get()
  if (!row) throw errors.notFound()
  const extras = await loadSegmentExtras(db, ownerId, [row as SegmentRow])
  return segmentDTO(row as SegmentRow, extras)
}
