// Internal + public types of the extraction pipeline (ARCHITECTURE §6). Pure.
import type { Category, ChatKind, ExtractionOutput, HandleKind, LoopCloseReason, LoopDirection, LoopKind, MessageKind, Status } from '@/contracts'

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

/** SPEC §8.8 input side: one unfinished thing this person carries into the window. */
export interface OpenLoopInput {
  id: number
  kind: LoopKind
  direction: LoopDirection
  text: string
  /** MsgTime of the message that opened it */
  openedAt: string
}

export interface KnownPerson {
  personId: number
  label: string
  handles: { kind: HandleKind; value: string }[]
  claims: { id: number; statement: string; category: Category }[]
  /** additive, rendered by the interaction prompt only (SPEC §8.8): the last segment this person spoke in, before this window. */
  lastContact?: { at: string; summary: string } | null
  /** additive, rendered by the interaction prompt only (SPEC §8.8): the loops it may close through `closes[].loopId`. */
  openLoops?: OpenLoopInput[]
}

export interface WindowInput {
  chat: { title: string; kind: ChatKind }
  selfPersonId: number
  messages: WindowMessage[]
  known: KnownPerson[]
}

export type LoadedWindow = WindowInput & {
  seqMap: Map<number, number> /* localSeq → messageId */
  /** the chat this window belongs to, for `conversation_segments.chat_id` (interaction, SPEC §8.8) */
  chatId: number
  /** the message span this window covers, in chat `seq` (the segment's natural key with chatId) */
  span: { startSeq: number; endSeq: number; startedAt: string; endedAt: string }
}

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
  /** additive (interaction, SPEC §8.8): a `closes[].loopId` this window was never shown, or closed before it opened */
  | 'unknown_close'

export interface DroppedItem {
  path: string
  reason: DropReason
  /** `invalid_item` from the strict item schema: failing field paths and issue codes ("confidence:invalid_type"), never values (DECISIONS ## extract X31). */
  fields?: string[]
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

/** Interaction layer output (SPEC §8.8, ARCHITECTURE §6): produced by the second, parallel model call. */
export interface ResolvedSegment {
  chatId: number
  startSeq: number
  endSeq: number
  startedAt: string
  endedAt: string
  messageCount: number
  summary: string
  topics: string[]
  participants: { personId: number; messageCount: number }[]
  messageIds: number[]
}

export interface ResolvedLoop {
  personId: number
  direction: LoopDirection
  kind: LoopKind
  text: string
  dueAt?: string
  openedMessageId: number
  /** MsgTime of the opening message */
  openedAt: string
  messageIds: number[]
  /** set by dedup: merge evidence into this existing loop instead of inserting */
  duplicateOf?: number
}

export interface ResolvedClose {
  loopId: number
  reason: LoopCloseReason
  closedMessageId: number
  /** MsgTime of the closing message */
  closedAt: string
}

export interface ResolvedItems {
  handles: { personId: number; kind: HandleOutKind; value: string; messageIds: number[] }[]
  relations: { fromPersonId: number; toPersonId: number; type: string; label?: string; messageIds: number[] }[]
  claims: ResolvedClaim[]
  events: { summary: string; happenedAt?: string; place?: string; participantIds: number[]; messageIds: number[] }[]
  dates: { personId: number; kind: string; day?: number; month?: number; year?: number; calendar: 'solar' | 'lunar'; isLeapMonth?: boolean; messageIds: number[] }[]
  /** interaction (SPEC §8.8): at most one segment per window; empty when the model returned `null` or it was dropped. */
  segment?: ResolvedSegment
  loops: ResolvedLoop[]
  closes: ResolvedClose[]
}

export interface ExtractStore {
  loadWindow(ref: WindowRef): Promise<LoadedWindow>
  proposeItems(importId: number, items: ResolvedItems, ctx: { jobId: number | null; windowIndex: number }): Promise<{ created: number; mergedEvidence: number }>
  findSimilarClaims(personId: number, importId: number): Promise<{ id: number; statement: string; status: Status }[]>
  /** interaction (SPEC §8.8): this person's still-open loops of this import, the dedup candidates riding the same call. */
  findSimilarLoops?(personId: number, importId: number): Promise<{ id: number; text: string }[]>
  resolveTempPerson(importId: number, label: string, evidenceMessageIds: number[]): Promise<number | null>
  createPerson(importId: number, label: string): Promise<number>
}

export type WindowErrorCode = 'invalid_json' | 'validation_failed' | 'truncated' | 'timeout' | 'deadline' | 'llm_error' | 'llm_config' | 'cassette_miss' | 'budget_exceeded'

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
      /**
       * Interaction call outcome (ARCHITECTURE §6 failure isolation). It fails independently of the extraction call:
       * the window still counts `done` and its claims still land. `not_needed` is the empty-window case, where no
       * call is made at all (same vocabulary as `dedup`).
       */
      interaction: 'ok' | 'skipped_deadline' | 'failed' | 'not_needed'
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
