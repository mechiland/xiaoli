import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { Category, TargetType } from '@/contracts'
import { entityColumns, linkColumns, sourceKindColumn, statusColumn } from './_columns'
import { persons } from './identity'
import { imports, messages } from './import'

export const claims = sqliteTable(
  'claims',
  {
    ...entityColumns(),
    personId: integer('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    statement: text('statement').notNull(),
    statementNorm: text('statement_norm').notNull(),
    category: text('category').$type<Category>().notNull(),
    validFrom: text('valid_from'),
    validTo: text('valid_to'),
    learnedAt: text('learned_at').notNull(),
    confidence: real('confidence'),
    sensitive: integer('sensitive', { mode: 'boolean' }).notNull().default(false),
    status: statusColumn(),
    statusReason: text('status_reason', { enum: ['superseded', 'outdated', 'edited'] }),
    statusChangedAt: text('status_changed_at').notNull(),
    supersedesClaimId: integer('supersedes_claim_id'),
    supersededByClaimId: integer('superseded_by_claim_id'),
    importId: integer('import_id').references(() => imports.id, { onDelete: 'set null' }),
    jobId: integer('job_id'),
    sourceKind: sourceKindColumn(),
  },
  (t) => [
    index('claims_owner_idx').on(t.ownerId),
    index('claims_owner_person_status_idx').on(t.ownerId, t.personId, t.status),
    index('claims_owner_import_idx').on(t.ownerId, t.importId),
    index('claims_owner_status_norm_idx').on(t.ownerId, t.status, t.statementNorm),
  ],
)

export const claimMentions = sqliteTable(
  'claim_mentions',
  {
    ...linkColumns(),
    claimId: integer('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    personId: integer('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.claimId, t.personId] }),
    index('claim_mentions_owner_idx').on(t.ownerId),
    index('claim_mentions_person_idx').on(t.personId),
  ],
)

export const events = sqliteTable(
  'events',
  {
    ...entityColumns(),
    summary: text('summary').notNull(),
    happenedAt: text('happened_at'),
    place: text('place'),
    status: statusColumn(),
    importId: integer('import_id').references(() => imports.id, { onDelete: 'set null' }),
    sourceKind: sourceKindColumn(),
  },
  (t) => [index('events_owner_idx').on(t.ownerId), index('events_owner_import_idx').on(t.ownerId, t.importId)],
)

export const eventParticipants = sqliteTable(
  'event_participants',
  {
    ...linkColumns(),
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    personId: integer('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.personId] }),
    index('event_participants_owner_idx').on(t.ownerId),
    index('event_participants_person_idx').on(t.personId),
  ],
)

export const importantDates = sqliteTable(
  'important_dates',
  {
    ...entityColumns(),
    personId: integer('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    day: integer('day'),
    month: integer('month'),
    year: integer('year'),
    calendar: text('calendar', { enum: ['solar', 'lunar'] }).notNull(),
    isLeapMonth: integer('is_leap_month', { mode: 'boolean' }).notNull().default(false),
    label: text('label'),
    status: statusColumn(),
    importId: integer('import_id').references(() => imports.id, { onDelete: 'set null' }),
    sourceKind: sourceKindColumn(),
  },
  (t) => [
    index('important_dates_owner_idx').on(t.ownerId),
    index('important_dates_person_idx').on(t.personId),
    index('important_dates_owner_import_idx').on(t.ownerId, t.importId),
  ],
)

export const evidence = sqliteTable(
  'evidence',
  {
    ...linkColumns(),
    targetType: text('target_type').$type<TargetType>().notNull(),
    targetId: integer('target_id').notNull(),
    messageId: integer('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.targetType, t.targetId, t.messageId] }),
    index('evidence_owner_idx').on(t.ownerId),
    index('evidence_owner_message_idx').on(t.ownerId, t.messageId),
  ],
)
