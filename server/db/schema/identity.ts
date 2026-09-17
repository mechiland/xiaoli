import { index, integer, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { HandleKind } from '@/contracts'
import { entityColumns, sourceKindColumn, statusColumn } from './_columns'
import { chats, imports } from './import'

export const persons = sqliteTable(
  'persons',
  {
    ...entityColumns(),
    label: text('label').notNull(),
    isSelf: integer('is_self', { mode: 'boolean' }).notNull().default(false),
    mergedIntoId: integer('merged_into_id').references((): AnySQLiteColumn => persons.id, { onDelete: 'set null' }),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    avatarR2Key: text('avatar_r2_key'),
    lastMessageAt: text('last_message_at'),
    /** pinyin sort key (lib/pinyin.sortKey), computed on write */
    labelSort: text('label_sort').notNull().default(''),
    /** import that created this person ("新" badge) */
    importId: integer('import_id').references(() => imports.id, { onDelete: 'set null' }),
  },
  (t) => [index('persons_owner_idx').on(t.ownerId), index('persons_owner_label_sort_idx').on(t.ownerId, t.labelSort)],
)

export const handles = sqliteTable(
  'handles',
  {
    ...entityColumns(),
    personId: integer('person_id').references(() => persons.id, { onDelete: 'set null' }),
    kind: text('kind').$type<HandleKind>().notNull(),
    value: text('value').notNull(),
    /** NFKC, lowercase, trimmed */
    valueNorm: text('value_norm').notNull(),
    chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }),
    status: statusColumn(),
    importId: integer('import_id').references(() => imports.id, { onDelete: 'set null' }),
    sourceKind: sourceKindColumn(),
  },
  (t) => [
    index('handles_owner_idx').on(t.ownerId),
    // Unique (owner_id, kind, value, ifnull(chat_id, 0)) lives in a custom migration: drizzle-kit 0.31 mangles
    // expression indexes, and SQLite treats NULLs as distinct (DECISIONS A5 #11, core C4).
    index('handles_owner_value_norm_idx').on(t.ownerId, t.valueNorm),
    index('handles_person_idx').on(t.personId),
  ],
)

export const relations = sqliteTable(
  'relations',
  {
    ...entityColumns(),
    fromPersonId: integer('from_person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    toPersonId: integer('to_person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    label: text('label'),
    status: statusColumn(),
    importId: integer('import_id').references(() => imports.id, { onDelete: 'set null' }),
    sourceKind: sourceKindColumn(),
  },
  (t) => [
    index('relations_owner_idx').on(t.ownerId),
    index('relations_from_idx').on(t.fromPersonId),
    index('relations_to_idx').on(t.toPersonId),
    index('relations_owner_import_idx').on(t.ownerId, t.importId),
  ],
)
