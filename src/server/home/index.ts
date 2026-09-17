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
  type UpcomingPlansFn,
} from './queries'
export {
  compareUpcoming,
  computeUpcoming,
  dateItemLabel,
  mergeUpcoming,
  UPCOMING_WINDOW_DAYS,
  type UpcomingDateRow,
  type UpcomingPlanRow,
  type UpcomingRow,
} from './upcoming'
