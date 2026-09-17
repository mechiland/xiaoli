import { index, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import type { LoopCloseReason, LoopDirection, LoopKind } from '@/contracts'
import { entityColumns, linkColumns, sourceKindColumn, statusColumn } from './_columns'
import { persons } from './identity'
import { chats, imports, messages } from './import'

/**
 * Interaction layer (SPEC §7 交互层). Episodic memory: what happened between us, as opposed to the semantic
 * memory in memory.ts (who this person is).
 */

/**
 * One extraction window's "what was said here" (SPEC §8.8). Conversations are NOT a table: they are
 * `groupSegments()` over these rows (SESSION_GAP_HOURS), because session boundaries drift as later imports
 * fill in messages, and a summary keyed to a window span survives that regrouping.
 */
export const conversationSegments = sqliteTable(
  'conversation_segments',
  {
    ...entityColumns(),
    chatId: integer('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    startSeq: integer('start_seq').notNull(),
    endSeq: integer('end_seq').notNull(),
    /** MsgTime of the first / last message in the span */
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at').notNull(),
    messageCount: integer('message_count').notNull(),
    summary: text('summary').notNull(),
    summaryNorm: text('summary_norm').notNull(),
    /** JSON string[] */
    topics: text('topics').notNull().default('[]'),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    importId: integer('import_id').references(() => imports.id, { onDelete: 'set null' }),
    jobId: integer('job_id'),
    sourceKind: sourceKindColumn(),
  },
  (t) => [
    index('conversation_segments_owner_idx').on(t.ownerId),
    // re-extracting the same span overwrites rather than duplicating (SPEC §8.8)
    unique('conversation_segments_span_uq').on(t.ownerId, t.chatId, t.startSeq, t.endSeq),
    index('conversation_segments_owner_chat_started_idx').on(t.ownerId, t.chatId, t.startedAt),
    index('conversation_segments_owner_import_idx').on(t.ownerId, t.importId),
  ],
)

export const segmentParticipants = sqliteTable(
  'segment_participants',
  {
    ...linkColumns(),
    segmentId: integer('segment_id')
      .notNull()
      .references(() => conversationSegments.id, { onDelete: 'cascade' }),
    personId: integer('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    messageCount: integer('message_count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.segmentId, t.personId] }),
    index('segment_participants_owner_idx').on(t.ownerId),
    index('segment_participants_person_idx').on(t.personId, t.segmentId),
  ],
)

/**
 * An unfinished thing between the user and one person (SPEC §7 交互层).
 *
 * There is deliberately no `state` column: open/done/dropped is derived from `closedMessageId`/`closedReason`,
 * and `expired` is computed at read time. State therefore follows message time rather than import order, so
 * importing September before March, re-importing, and deleting an import all land on the right answer.
 */
export const loops = sqliteTable(
  'loops',
  {
    ...entityColumns(),
    personId: integer('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    direction: text('direction').$type<LoopDirection>().notNull(),
    kind: text('kind').$type<LoopKind>().notNull(),
    text: text('text').notNull(),
    textNorm: text('text_norm').notNull(),
    /** PartialDate; any actionable matter may have a deadline */
    dueAt: text('due_at'),
    /** set null (not cascade): deleting the opening message must not silently drop the item — deleteImport
     *  removes it explicitly through its evidence rows, like every other derived item (ARCHITECTURE §11). */
    openedMessageId: integer('opened_message_id').references(() => messages.id, { onDelete: 'set null' }),
    /** MsgTime */
    openedAt: text('opened_at').notNull(),
    closedMessageId: integer('closed_message_id').references(() => messages.id, { onDelete: 'set null' }),
    /** MsgTime when closed by a message, ISO when closed by hand */
    closedAt: text('closed_at'),
    closedReason: text('closed_reason').$type<LoopCloseReason>(),
    status: statusColumn(),
    importId: integer('import_id').references(() => imports.id, { onDelete: 'set null' }),
    jobId: integer('job_id'),
    sourceKind: sourceKindColumn(),
  },
  (t) => [
    index('loops_owner_idx').on(t.ownerId),
    index('loops_owner_person_status_idx').on(t.ownerId, t.personId, t.status),
    index('loops_owner_import_idx').on(t.ownerId, t.importId),
    index('loops_owner_status_norm_idx').on(t.ownerId, t.status, t.textNorm),
    index('loops_owner_due_idx').on(t.ownerId, t.dueAt),
  ],
)
