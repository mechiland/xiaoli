// Offline entry for the eval harness (ARCHITECTURE §6 extractOffline): no D1, no server, no browser.
import type { ExtractModel, ParsedExport } from '@/contracts'
import type { LlmClient } from '@/server/llm'
import { parseServerEnv } from '@/server/env'
import { memoryStore, type OfflineItems, type OfflineMapping } from './memory-store'
import { extractWindow, resolveExtractModel } from './pipeline'
import { getPrompt } from './prompt'
import { INTERACTION_PROMPT_VERSION, PROMPT_VERSION, promptFeatures } from './prompt-version'
import type { WindowOutcome } from './types'
import { packWindows, planWindows } from './windowing'

/** ARCHITECTURE §6 / DECISIONS A7 #5: each attempt gets the app's 28 s request deadline. */
export const APP_DEADLINE_MS = 28_000
export const MAX_ATTEMPTS = 3

export interface ExtractOfflineArgs {
  parsed: ParsedExport
  mapping: OfflineMapping
  llm: LlmClient
  model?: ExtractModel
  promptVersion?: string
  /** additive: the second, parallel call's prompt (ARCHITECTURE §6); defaults to INTERACTION_PROMPT_VERSION */
  interactionPromptVersion?: string
  deadlinePolicy?: 'app' | 'none'
  onWindow?: (i: number, total: number, outcome: WindowOutcome) => void
  /** additive: llm_calls evalRunId */
  evalRunId?: string
}

export interface OfflineExtractionResult extends OfflineItems {
  windows: {
    index: number
    startIdx: number
    endIdx: number
    outcome: WindowOutcome['status']
    code?: string
    attempts: number
    attemptMs: number[]
    latencyMs: number
    rawItemCount: number
    droppedInvalidEvidence: number
    dedup?: string
    /** interaction call outcome of the last attempt (ARCHITECTURE §6 failure isolation) */
    interaction?: string
    rawOutputs: string[]
  }[]
  deadlinePolicy: 'app' | 'none'
  usage: { inputTokens: number; outputTokens: number; calls: number }
  promptVersion: string
  /** the interaction layer's own prompt version: it is a separate call with a separate cassette stream */
  interactionPromptVersion: string
  model: string
}

export async function extractOffline(args: ExtractOfflineArgs): Promise<OfflineExtractionResult> {
  const env = (globalThis as { process?: { env: Record<string, unknown> } }).process?.env ?? {}
  const model = args.model ?? resolveExtractModel(null, parseServerEnv(env))
  const promptVersion = args.promptVersion ?? PROMPT_VERSION
  const interactionPromptVersion = args.interactionPromptVersion ?? INTERACTION_PROMPT_VERSION
  getPrompt(promptVersion) // unknown version → throw before any call
  getPrompt(interactionPromptVersion)
  const policy = args.deadlinePolicy ?? 'app'
  const store = memoryStore(args.parsed, args.mapping)
  const n = args.parsed.messages.length
  const seqs = args.parsed.messages.map((m) => ({ seq: m.idx, sentAt: m.sentAt }))
  const planned = n ? planWindows(seqs, [[0, n - 1]]) : []
  const { packMaxMessages } = promptFeatures(promptVersion)
  const plans = packMaxMessages ? packWindows(planned, seqs, packMaxMessages) : planned

  const usage = { inputTokens: 0, outputTokens: 0, calls: 0 }
  const windows: OfflineExtractionResult['windows'] = []
  let budgetExceeded = false

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i]
    const ref = { importId: 1, jobId: null, windowIndex: i, ...plan }
    const attemptMs: number[] = []
    const rawOutputs: string[] = []
    let latencyMs = 0
    let attempts = 0
    let last: WindowOutcome = { status: 'fatal_error', code: 'budget_exceeded', message: 'skipped after budget_exceeded', latencyMs: 0 }
    while (!budgetExceeded && attempts < MAX_ATTEMPTS) {
      attempts++
      const deadlineAt = policy === 'app' ? Date.now() + APP_DEADLINE_MS : undefined
      try {
        last = await extractWindow({ llm: args.llm, store, model, promptVersion, interactionPromptVersion, deadlineAt, context: { evalRunId: args.evalRunId ?? null } }, ref)
      } catch (e) {
        last = { status: 'retryable_error', code: 'llm_error', message: `internal: ${(e as Error).name}`, latencyMs: 0 }
      }
      attemptMs.push(Math.round(last.attemptMs ?? 0))
      if (last.raw != null) rawOutputs.push(last.raw)
      latencyMs += last.latencyMs
      const u = last.usage
      if (u) {
        usage.inputTokens += u.inputTokens
        usage.outputTokens += u.outputTokens
        usage.calls += u.calls
      }
      if (last.status !== 'retryable_error') break
    }
    if (last.status === 'fatal_error' && last.code === 'budget_exceeded') budgetExceeded = true
    windows.push({
      index: i,
      startIdx: plan.startSeq,
      endIdx: plan.endSeq,
      outcome: last.status,
      ...(last.status !== 'done' ? { code: last.code } : {}),
      attempts,
      attemptMs,
      latencyMs,
      rawItemCount: last.status === 'done' ? last.rawItemCount : 0,
      droppedInvalidEvidence: last.status === 'done' ? last.droppedInvalidEvidence : 0,
      ...(last.status === 'done' ? { dedup: last.dedup, interaction: last.interaction } : {}),
      rawOutputs,
    })
    args.onWindow?.(i, plans.length, last)
  }

  return { ...store.result(), windows, deadlinePolicy: policy, usage, promptVersion, interactionPromptVersion, model }
}
