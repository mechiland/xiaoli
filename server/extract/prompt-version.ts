// Current prompt versions; must match the front-matter of prompts/<version>.md (prompts.test.ts checks).
export const PROMPT_VERSION = 'extract.v5'
export const DEDUP_PROMPT_VERSION = 'dedup.v2'

/**
 * Rendering/windowing features bound to a prompt version, so older versions replay byte-identically from their
 * cassettes (DECISIONS ## extract X20). From extract.v4: adjacent windows are packed up to `packMaxMessages`
 * messages per call and session gaps (> 3 h) are shown as separator lines.
 */
export function promptFeatures(version: string): { packMaxMessages: number | null; gapMarkers: boolean } {
  const n = Number(/^extract\.v(\d+)$/.exec(version)?.[1] ?? 0)
  return n >= 4 ? { packMaxMessages: 40, gapMarkers: true } : { packMaxMessages: null, gapMarkers: false }
}
