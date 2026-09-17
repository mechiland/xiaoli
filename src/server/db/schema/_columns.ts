import { integer, text } from 'drizzle-orm/sqlite-core'
import { user } from './auth'

/** Entity tables: id pk autoincrement, owner_id fk user cascade, created_at, updated_at (ARCHITECTURE §4.1). */
export const entityColumns = () => ({
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/** Link tables: owner_id fk user cascade, created_at; composite pk declared per table. */
export const linkColumns = () => ({
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
})

export const statusColumn = () =>
  text('status', { enum: ['proposed', 'confirmed', 'rejected', 'superseded'] }).notNull()
export const sourceKindColumn = () => text('source_kind', { enum: ['ai', 'manual'] }).notNull()
