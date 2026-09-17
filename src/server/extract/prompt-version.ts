// Current prompt versions; must match the front-matter of prompts/<version>.md (prompts.test.ts checks).
import type { LlmPurpose } from '@/contracts'

export const PROMPT_VERSION = 'extract.v8'
export const DEDUP_PROMPT_VERSION = 'dedup.v2'
/**
 * Interaction layer (SPEC §8.8, ARCHITECTURE §6): a SECOND model call over the same window, issued in parallel with
 * the extraction call and versioned on its own. `extract.v9` — the interaction layer folded into the extraction call —
 * is retired, not promoted: measured live on the same 4 synthetic zips against the same frozen gold it cost the
 * extraction its gates (claims P 0.90 → 0.76, R 0.77 → 0.66, handles P 1.00 → 0.875, transactional-as-claim
 * 0.04 → 0.073) while claims *count* rose 50 → 55. DECISIONS I15/I17, ## extract X40.
 *
 * `interaction.v2` adds the third threshold a loop has to pass — **worth remembering the next time you see this
 * person** — because the first two (said out loud, still unsettled) let every within-the-day household errand
 * through and the interaction call's own loop precision measured 0.556 against a 0.80 gate, with 16 of the false
 * positives `should_ignore` coordination ("晚上过去拿西瓜", "回头细说"). `interaction.v1` stays registered so
 * `--prompt interaction.v1` still renders for comparison. SPEC §8.8, DECISIONS ## extract X41.
 */
// v3: actionable requests, explicit recipients, and acknowledgement is not completion.
export const INTERACTION_PROMPT_VERSION = 'interaction.v3'

/**
 * `llm_calls.purpose` of the interaction call, so its cost and latency read separately from the extraction call's.
 *
 * It should be `'interaction'`. `LlmPurposeSchema` (contracts/llm.ts, core-owned) is still `extract | dedup | judge |
 * other`, and cassettes validate `purpose` against it, so a literal `'interaction'` would make every hand-written
 * interaction cassette fail to parse. Until core request extract#9 lands this is `'other'` — distinct from `extract`
 * and `dedup`, which is what cost-per-purpose needs — and the call also carries `promptVersion: 'interaction.v2'`,
 * which identifies it unambiguously. One-line change when the enum grows.
 */
export const INTERACTION_PURPOSE: LlmPurpose = 'interaction'

export interface PromptFeatures {
  packMaxMessages: number | null
  gapMarkers: boolean
  milestoneRules: boolean
}

/**
 * Rendering/windowing features bound to a prompt version, so older versions replay byte-identically from their
 * cassettes (DECISIONS ## extract X20). From extract.v4: adjacent windows are packed up to `packMaxMessages`
 * messages per call and session gaps (> 3 h) are shown as separator lines.
 *
 * There is no `interaction` feature any more: the extraction call does not know the interaction layer exists
 * (X40). `extract.v9` stays registered so `--prompt extract.v9` still renders for comparison, and it keeps v7/v8's
 * features, but nothing reads an interaction flag off it.
 */
export function promptFeatures(version: string): PromptFeatures {
  const n = Number(/^extract\.v(\d+)$/.exec(version)?.[1] ?? 0)
  // milestoneRules (extract.v7+, DECISIONS ## extract X30): validation rules measured on extract.v7 output, so earlier
  // versions keep exactly the outputs their critics verified.
  return { ...(n >= 4 ? { packMaxMessages: 40, gapMarkers: true } : { packMaxMessages: null, gapMarkers: false }), milestoneRules: n >= 7 }
}
