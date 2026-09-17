// Public entry `@/server/interaction` (ARCHITECTURE §1.17). Interaction layer: SPEC §7 交互层, §8.8.
export { getPersonInteraction, getImportInteraction } from './read'
export { getUpcomingPlans, getUpcomingLoops } from './upcoming'
export { searchInteraction } from './search'
export { closeLoop, reopenLoop, patchSegment } from './write'
export { groupSegments } from './group'
export { deriveRhythm } from './rhythm'
export { loopState } from './loop-state'
export type {
  GroupableSegment,
  SegmentGroup,
  RhythmConversation,
  LoopLike,
  LoopDerived,
  SegmentPatch,
} from './types'
