// Current prompt versions; must match the front-matter of prompts/<version>.md (prompts.test.ts checks).
export const PROMPT_VERSION = 'extract.v5'
export const DEDUP_PROMPT_VERSION = 'dedup.v2'

/**
 * Rendering/windowing features bound to a prompt version, so older versions replay byte-identically from their
 * cassettes (DECISIONS ## extract X20). From extract.v4: adjacent windows are packed up to `packMaxMessages`
 * messages per call and session gaps (> 3 h) are shown as separator lines.
 */
export function promptFeatures(version: string): { packMaxMessages: number | null; gapMarkers: boolean; milestoneRules: boolean } {
  const n = Number(/^extract\.v(\d+)$/.exec(version)?.[1] ?? 0)
  // milestoneRules (extract.v7+, DECISIONS ## extract X30): validation rules measured on extract.v7 output, so earlier
  // versions keep exactly the outputs their critics verified.
  return { ...(n >= 4 ? { packMaxMessages: 40, gapMarkers: true } : { packMaxMessages: null, gapMarkers: false }), milestoneRules: n >= 7 }
}
