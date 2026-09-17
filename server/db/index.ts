// Public entry `@/server/db` (ARCHITECTURE §1.1).
export * from './schema'
export { owned, getOwnedOr404, withOwner, withOwnerLink } from './owned'
export type { Db, Schema, OwnedTable, OwnedLinkTable } from './owned'
export { createDb, getDb } from './client'
export { getUserSettings, updateUserSettings } from './settings'
