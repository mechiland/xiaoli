// Per-call cost accounting for the harness (ARCHITECTURE §7.5 `usage`).
//
// From DECISIONS I17 the pipeline issues TWO model calls per window — extraction (`PROMPT_VERSION`) and interaction
// (`INTERACTION_PROMPT_VERSION`), in parallel. The split was chosen as a quality-for-cost trade, so a report that
// prints one combined token total hides exactly the half of the trade that was paid for. The harness therefore
// counts the calls itself, by wrapping the `LlmClient` it hands to `extractOffline`: the split is then whatever the
// pipeline really did, not whatever it remembered to report.
import type { LlmClient, LlmJsonRequest } from './entries'

export const USAGE_BUCKETS = ['extract', 'interaction', 'dedup', 'other'] as const
export type UsageBucket = (typeof USAGE_BUCKETS)[number]

export interface BucketUsage {
  inputTokens: number
  outputTokens: number
  calls: number
  /** attempts that returned an error (no usage, but they cost wall time and sometimes tokens upstream) */
  failedCalls: number
}
export type UsageByBucket = Record<UsageBucket, BucketUsage>

export const zeroBucket = (): BucketUsage => ({ inputTokens: 0, outputTokens: 0, calls: 0, failedCalls: 0 })
export const zeroUsageByBucket = (): UsageByBucket => Object.fromEntries(USAGE_BUCKETS.map((b) => [b, zeroBucket()])) as UsageByBucket

export function addUsageByBucket(a: UsageByBucket, b: UsageByBucket): UsageByBucket {
  const r = zeroUsageByBucket()
  for (const k of USAGE_BUCKETS) {
    r[k] = { inputTokens: a[k].inputTokens + b[k].inputTokens, outputTokens: a[k].outputTokens + b[k].outputTokens, calls: a[k].calls + b[k].calls, failedCalls: a[k].failedCalls + b[k].failedCalls }
  }
  return r
}

/**
 * Which call a request belongs to. `purpose` is the contract field (`contracts/llm.ts`), `promptVersion` is the
 * prompt file the call rendered. The interaction call is recognised by its own prompt version — either the exact
 * string extract exports as `INTERACTION_PROMPT_VERSION`, or anything named `interaction.*` — because that name is
 * pinned by ARCHITECTURE §6 while `LlmPurpose` may or may not gain an `interaction` member.
 */
export function usageBucket(req: { purpose: string; promptVersion: string }, interactionVersion?: string | null): UsageBucket {
  if (req.purpose === 'judge') return 'other'
  if (req.purpose === 'interaction') return 'interaction'
  if (interactionVersion && req.promptVersion === interactionVersion) return 'interaction'
  if (/^interaction[.-]/.test(req.promptVersion)) return 'interaction'
  if (req.purpose === 'dedup' || /^dedup[.-]/.test(req.promptVersion)) return 'dedup'
  if (req.purpose === 'extract') return 'extract'
  return 'other'
}

export interface TallyingClient extends LlmClient {
  usage: UsageByBucket
  /** every distinct promptVersion seen per bucket, in first-seen order (what the run actually ran) */
  promptVersions: Record<UsageBucket, string[]>
}

/** Wraps a client and counts every call it makes, bucketed by {@link usageBucket}. */
export function tallyingClient(inner: LlmClient, interactionVersion?: string | null): TallyingClient {
  const usage = zeroUsageByBucket()
  const promptVersions = Object.fromEntries(USAGE_BUCKETS.map((b) => [b, [] as string[]])) as Record<UsageBucket, string[]>
  return {
    usage,
    promptVersions,
    async completeJson(req: LlmJsonRequest) {
      const bucket = usageBucket(req, interactionVersion)
      if (req.promptVersion && !promptVersions[bucket].includes(req.promptVersion)) promptVersions[bucket].push(req.promptVersion)
      const res = await inner.completeJson(req)
      const u = usage[bucket]
      u.calls++
      if (res.ok) {
        u.inputTokens += res.usage.inputTokens
        u.outputTokens += res.usage.outputTokens
      } else u.failedCalls++
      return res
    },
  }
}
