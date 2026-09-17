// Query matching for the 来往 group of the search overlay. Re-exported from search so all three groups of the
// overlay match and highlight by one rule (core-request interaction#2, resolved by the integrator).
export { highlightRanges, likeContains, normalize, normalizeQuery, splitTerms } from '@/server/search'
