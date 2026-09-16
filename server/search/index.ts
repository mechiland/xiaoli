// Public entry `@/server/search` (ARCHITECTURE §1.8). Owner: search.
export { searchAll, type InteractionSearchFn, type SearchOptions } from './search'
export { listPeopleIndex } from './people-index'
/**
 * Pure text matching, shared (core-request interaction#2). The 来往 group of the overlay has to decide what
 * "matched" using exactly the rule the 人物 and 信息 groups use, or the three groups silently disagree and the
 * highlight ranges drift apart. No server/DB imports — the overlay and PersonPicker use these on the client too.
 */
export { highlightRanges, likeContains, normalize, normalizeQuery, splitTerms } from './text'
