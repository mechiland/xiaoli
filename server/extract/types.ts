// Internal + public types of the extraction pipeline (ARCHITECTURE §6). Pure.
import type { Category, ChatKind, ExtractionOutput, HandleKind, MessageKind, Status } from '@/contracts'

export interface WindowPlan {
  startSeq: number
  endSeq: number
  focusStartSeq: number
  focusEndSeq: number
}

/** One window to extract: a job row in-app, a planned window offline. */
export interface WindowRef {
  importId: number
  jobId: number | null
  windowIndex: number
  startSeq: number
  endSeq: number
  focusStartSeq: number
  focusEndSeq: number
}

export interface WindowMessage {
  /** 1..n within the window */
  localSeq: number
  sentAt: string
  senderName: string
  senderPersonId: number | null
  kind: MessageKind
  body: string
  /** additive: existing message outside the focus range (SPEC §8.4 context); extraction must not come only from these */
  context?: boolean
}

export interface KnownPerson {
  personId: number
  label: string
  handles: { kind: HandleKind; value: string }[]
  claims: { id: number; statement: string; category: Category }[]
}

export interface WindowInput {
  chat: { title: string; kind: ChatKind }
  selfPersonId: number
  messages: WindowMessage[]
  known: KnownPerson[]
}

export type LoadedWindow = WindowInput & { seqMap: Map<number, number> /* localSeq → messageId */ }

export type DropReason =
  | 'evidence_out_of_window'
  | 'unknown_person'
  | 'unknown_supersedes'
  | 'empty_evidence'
  // additive (DECISIONS ## extract)
  | 'invalid_item'
  | 'context_only'
  | 'self_loop'
  /** additive (DECISIONS ## extract X26) */
  | 'low_confidence'
  | 'momentary'
  | 'ambiguous_handle'
  | 'redundant'

export interface DroppedItem {
  path: string
  reason: DropReason
}

export type ValidateResult =
  | { output: ExtractionOutput; dropped: DroppedItem[]; rawItemCount: number }
  | { error: 'validation_failed'; issues: string[] }

export type HandleOutKind = 'mentioned' | 'real_name' | 'address_term'

export interface ResolvedClaim {
  personId: number
  statement: string
  category: Category
  validFrom?: string
  confidence: number
  sensitive: boolean
  supersedesClaimId?: number
  messageIds: number[]
  /** set by dedup: merge evidence into this existing claim instead of inserting */
  duplicateOf?: number
  /** other persons whose label appears in the statement */
  mentionIds: number[]
}

export interface ResolvedItems {
  handles: { personId: number; kind: HandleOutKind; value: string; messageIds: number[] }[]
  relations: { fromPersonId: number; toPersonId: number; type: string; label?: string; messageIds: number[] }[]
  claims: ResolvedClaim[]
  events: { summary: string; happenedAt?: string; place?: string; participantIds: number[]; messageIds: number[] }[]
  dates: { personId: number; kind: string; day?: number; month?: number; year?: number; calendar: 'solar' | 'lunar'; isLeapMonth?: boolean; messageIds: number[] }[]
}

export interface ExtractStore {
  loadWindow(ref: WindowRef): Promise<LoadedWindow>
  proposeItems(importId: number, items: ResolvedItems, ctx: { jobId: number | null; windowIndex: number }): Promise<{ created: number; mergedEvidence: number }>
  findSimilarClaims(personId: number, importId: number): Promise<{ id: number; statement: string; status: Status }[]>
  resolveTempPerson(importId: number, label: string, evidenceMessageIds: number[]): Promise<number | null>
  createPerson(importId: number, label: string): Promise<number>
}

export type WindowErrorCode = 'invalid_json' | 'validation_failed' | 'truncated' | 'timeout' | 'deadline' | 'llm_error' | 'cassette_miss' | 'budget_exceeded'

export interface WindowUsage {
  inputTokens: number
  outputTokens: number
  calls: number
}

export type WindowOutcome =
  | {
      status: 'done'
      itemsCreated: number
      droppedInvalidEvidence: number
      rawItemCount: number
      dedup: 'ran' | 'skipped_deadline' | 'failed' | 'not_needed'
      latencyMs: number
      usage: WindowUsage
      /** additive */
      raw?: string | null
      attemptMs?: number
      sensitiveRewritten?: number
      dropped?: DroppedItem[]
    }
  | {
      status: 'retryable_error' | 'fatal_error'
      code: WindowErrorCode
      message: string
      latencyMs: number
      /** additive */
      raw?: string | null
      usage?: WindowUsage
      attemptMs?: number
    }
