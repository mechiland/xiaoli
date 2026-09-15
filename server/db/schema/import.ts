import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { AttachmentKind, ImportStats, MessageKind, MessageMeta } from '@/contracts'
import { entityColumns, linkColumns } from './_columns'
import { handles } from './identity'

export const chats = sqliteTable(
  'chats',
  {
    ...entityColumns(),
    title: text('title').notNull(),
    kind: text('kind', { enum: ['private', 'group'] }).notNull(),
    note: text('note'),
  },
  (t) => [index('chats_owner_idx').on(t.ownerId), index('chats_owner_title_idx').on(t.ownerId, t.title)],
)

export const imports = sqliteTable(
  'imports',
  {
    ...entityColumns(),
    chatId: integer('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    fileName: text('file_name').notNull(),
    fileSha256: text('file_sha256').notNull(),
    exportedAt: text('exported_at'),
    parserVersion: text('parser_version').notNull(),
    status: text('status', { enum: ['parsed', 'mapping', 'extracting', 'reviewing', 'done', 'failed'] }).notNull(),
    messageCount: integer('message_count').notNull().default(0),
    newMessageCount: integer('new_message_count').notNull().default(0),
    dateFrom: text('date_from'),
    dateTo: text('date_to'),
    stats: text('stats', { mode: 'json' }).$type<ImportStats>().notNull(),
    error: text('error'),
  },
  (t) => [
    index('imports_owner_idx').on(t.ownerId),
    uniqueIndex('imports_owner_sha_uq').on(t.ownerId, t.fileSha256),
    index('imports_owner_created_idx').on(t.ownerId, t.createdAt),
  ],
)

export const messages = sqliteTable(
  'messages',
  {
    ...entityColumns(),
    chatId: integer('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    firstImportId: integer('first_import_id').references(() => imports.id, { onDelete: 'set null' }),
    senderHandleId: integer('sender_handle_id').references(() => handles.id, { onDelete: 'set null' }),
    senderName: text('sender_name').notNull(),
    sentAt: text('sent_at').notNull(),
    seq: integer('seq').notNull(),
    kind: text('kind').$type<MessageKind>().notNull(),
    body: text('body').notNull(),
    meta: text('meta', { mode: 'json' }).$type<MessageMeta>(),
    fingerprint: text('fingerprint').notNull(),
  },
  (t) => [
    index('messages_owner_idx').on(t.ownerId),
    uniqueIndex('messages_chat_seq_uq').on(t.chatId, t.seq),
    index('messages_owner_chat_sent_idx').on(t.ownerId, t.chatId, t.sentAt),
    index('messages_first_import_idx').on(t.firstImportId),
    index('messages_sender_handle_idx').on(t.senderHandleId),
  ],
)

export const attachments = sqliteTable(
  'attachments',
  {
    ...entityColumns(),
    messageId: integer('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<AttachmentKind>().notNull(),
    fileName: text('file_name'),
    selected: integer('selected', { mode: 'boolean' }).notNull().default(false),
    r2Key: text('r2_key'),
    byteSize: integer('byte_size'),
    mime: text('mime'),
  },
  (t) => [index('attachments_owner_idx').on(t.ownerId), index('attachments_message_idx').on(t.messageId)],
)

export const importMessages = sqliteTable(
  'import_messages',
  {
    ...linkColumns(),
    importId: integer('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    messageId: integer('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.importId, t.messageId] }),
    index('import_messages_owner_idx').on(t.ownerId),
    index('import_messages_message_idx').on(t.messageId),
  ],
)
