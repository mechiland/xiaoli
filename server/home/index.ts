// Public entry `@/server/home` (ARCHITECTURE §1.9). Owner: home.
export {
  getHome,
  getHomeBlocks,
  computeIsEmpty,
  HOME_BLOCK_KEYS,
  RECENT_IMPORTS_LIMIT,
  RECENTLY_UPDATED_LIMIT,
  type HomeBlockKey,
  type HomeBlocks,
  type HomeBlocksResult,
  type HomeOptions,
} from './queries'
export { computeUpcoming, dateItemLabel, UPCOMING_WINDOW_DAYS, type UpcomingDateRow } from './upcoming'
