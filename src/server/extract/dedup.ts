// Semantic dedup (SPEC §8.6; ARCHITECTURE §6): one combined `purpose: 'dedup'` call per window, keyed by person.
import { DedupOutputSchema, type ExtractModel } from '@/contracts'
import type { LlmClient, LlmError, LlmJsonRequest, LlmJsonResult, LlmRequestContext } from '@/server/llm'
import { renderDedupPrompt, type DedupGroupInput } from './prompt'
import { DEDUP_PROMPT_VERSION } from './prompt-version'

export const DEDUP_MAX_TOKENS = 1024
export const DEDUP_MAX_CANDIDATES = 80

export type DedupResult = { ok: true; duplicates: Map<number, number> } | { ok: false; code: string }

/** Returns newIndex → existingClaimId. Entries naming an index or id outside their input are ignored. */
export async function runDedup(
  call: (req: LlmJsonRequest) => Promise<LlmJsonResult | LlmError>,
  groups: DedupGroupInput[],
  opts: { model: ExtractModel; timeoutMs: number; deadlineAt?: number; maxTransportRetries: number; context?: LlmRequestContext; version?: string },
): Promise<DedupResult> {
  const version = opts.version ?? DEDUP_PROMPT_VERSION
  const res = await call({
    purpose: 'dedup',
    promptVersion: version,
    model: opts.model,
    messages: renderDedupPrompt(groups, version),
    maxTokens: DEDUP_MAX_TOKENS,
    temperature: 0,
    timeoutMs: opts.timeoutMs,
    deadlineAt: opts.deadlineAt,
    maxTransportRetries: opts.maxTransportRetries,
    context: opts.context,
  })
  if (!res.ok) return { ok: false, code: res.code }
  const parsed = DedupOutputSchema.safeParse(res.json)
  if (!parsed.success) return { ok: false, code: 'validation_failed' }
  const allowed = new Map<number, Set<number>>()
  for (const g of groups) {
    const ids = new Set(g.candidates.map((c) => c.id))
    for (const nw of g.new) allowed.set(nw.index, ids)
  }
  const duplicates = new Map<number, number>()
  for (const d of parsed.data.duplicates) {
    if (allowed.get(d.newIndex)?.has(d.existingClaimId) && !duplicates.has(d.newIndex)) duplicates.set(d.newIndex, d.existingClaimId)
  }
  return { ok: true, duplicates }
}

export type { LlmClient }
