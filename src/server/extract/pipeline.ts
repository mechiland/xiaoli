// Single-window extraction, storage-agnostic (SPEC §8.6; ARCHITECTURE §6 extractWindow + per-request deadline).
import type { ExtractModel, ExtractionOutput, InteractionOutput, PersonRef, SettingsDTO } from '@/contracts'
import type { LlmClient, LlmError, LlmJsonRequest, LlmJsonResult, LlmRequestContext } from '@/server/llm'
import { DEDUP_MAX_CANDIDATES, runDedup } from './dedup'
import type { DedupGroupInput } from './prompt'
import { renderExtractPrompt, renderInteractionPrompt } from './prompt'
import { INTERACTION_PROMPT_VERSION, INTERACTION_PURPOSE, PROMPT_VERSION, promptFeatures } from './prompt-version'
import { applyInteractionSensitiveGuard, applySensitiveGuard } from './sensitive'
import type { DroppedItem, ExtractStore, LoadedWindow, ResolvedItems, WindowErrorCode, WindowOutcome, WindowRef, WindowUsage } from './types'
import { validateInteraction } from './validate-interaction'
import { GRADE, normName, statesEnrolment, STUDENT_STATUS, validateOutput } from './validate'

export const EXTRACT_MAX_TOKENS = 8192
/** The interaction call answers three sections over the same window; it never needs the extraction call's budget. */
export const INTERACTION_MAX_TOKENS = 2048
/** ARCHITECTURE §6 step 1: extract call ≤ 20 s and leaves 6 s for dedup + persistence */
export const EXTRACT_TIMEOUT_MS = 20_000
export const EXTRACT_RESERVE_MS = 6_000
/**
 * ARCHITECTURE §6: the interaction call starts together with the extraction call and is **skipped, not failed**, when
 * under 6 s remain at the moment it would start. Skipping costs the window its segment and loops; it never costs it
 * the claims.
 */
export const INTERACTION_MIN_REMAINING_MS = 6_000
/**
 * Loop dedup rides the one dedup call per window (ARCHITECTURE §6: the per-request deadline has no room for a second
 * call). Loop candidates and new loops travel in the same per-person group with their ids and indexes shifted into a
 * disjoint range, and a duplicate is only accepted when both sides are in the same range, so a claim can never be
 * merged into a loop. With no loops in the window (a failed or skipped interaction call, or a version that never had
 * one) the payload is byte-identical to before, so the recorded dedup cassettes still hit.
 */
export const LOOP_INDEX_OFFSET = 1_000_000
export const LOOP_ID_OFFSET = 1_000_000_000
/** step 3: dedup only with ≥ 4 s left, ≤ 5 s, leaving 2 s for persistence */
export const DEDUP_MIN_REMAINING_MS = 4_000
export const DEDUP_TIMEOUT_MS = 5_000
export const PERSIST_RESERVE_MS = 2_000
/** No deadline (offline diagnostics): generous per-call limits with transport retries. */
const NO_DEADLINE_TIMEOUT_MS = 90_000

export function resolveExtractModel(settings: SettingsDTO | null, env: { EXTRACT_MODEL?: ExtractModel }): ExtractModel {
  return settings?.extractModel ?? env.EXTRACT_MODEL ?? 'deepseek-flash'
}

export interface ExtractDeps {
  llm: LlmClient
  store: ExtractStore
  model: ExtractModel
  promptVersion?: string
  /** additive: the interaction prompt of the second, parallel call (ARCHITECTURE §6) */
  interactionPromptVersion?: string
  /** epoch ms; undefined = no deadline (deadlinePolicy 'none') */
  deadlineAt?: number
  /** additive: llm_calls context (ownerId, importId, jobId, evalRunId) */
  context?: LlmRequestContext
  /** additive: clock for tests */
  now?: () => number
}

/**
 * Attempt clock. Wall time spent inside LLM calls is replaced by each call's reported latency, so in replay mode the
 * recorded latency counts against the deadline exactly as the live call did (ARCHITECTURE §6 offline timing).
 */
function attemptClock(now: () => number) {
  const start = now()
  let wallInCalls = 0
  let latency = 0
  return {
    now: () => now() - wallInCalls + latency,
    elapsed: () => now() - wallInCalls + latency - start,
    addCall(wall: number, lat: number) {
      wallInCalls += wall
      latency += lat
    },
  }
}

function mapLlmError(e: LlmError): {
  status: 'retryable_error' | 'fatal_error'
  code: WindowErrorCode
} {
  switch (e.code) {
    case 'invalid_json':
    case 'truncated':
    case 'timeout':
    case 'deadline':
      return { status: 'retryable_error', code: e.code }
    case 'budget_exceeded':
    case 'cassette_miss':
      return { status: 'fatal_error', code: e.code }
    // setup faults (no/invalid key, no balance): retrying burns attempts and hides the cause
    case 'no_api_key':
    case 'unauthorized':
    case 'insufficient_balance':
      return { status: 'fatal_error', code: 'llm_config' }
    default:
      // anything the adapter marked non-retryable is fatal too, so a window fails once instead of three times
      return {
        status: e.retryable ? 'retryable_error' : 'fatal_error',
        code: 'llm_error',
      }
  }
}

export async function extractWindow(deps: ExtractDeps, window: WindowRef): Promise<WindowOutcome> {
  const realNow = deps.now ?? Date.now
  const clock = attemptClock(realNow)
  const usage: WindowUsage = { inputTokens: 0, outputTokens: 0, calls: 0 }
  let latencyMs = 0
  let raw: string | null = null
  const hasDeadline = deps.deadlineAt !== undefined
  const remaining = () => (hasDeadline ? (deps.deadlineAt as number) - clock.now() : Number.POSITIVE_INFINITY)
  const callDeadline = () => (hasDeadline ? realNow() + remaining() : undefined)

  /**
   * `defer` collects a call's timing instead of charging the attempt clock for it, so a set of calls issued together
   * can be charged once, as `max`, rather than as their sum: two calls that ran in parallel cost the window the
   * longer of the two, not both (ARCHITECTURE §6 attempt time, re-read for the parallel pair).
   */
  const call = async (req: LlmJsonRequest, defer?: { wall: number; latency: number }[]): Promise<LlmJsonResult | LlmError> => {
    const w0 = realNow()
    const res = await deps.llm.completeJson(req)
    const wall = realNow() - w0
    if (defer) defer.push({ wall, latency: res.latencyMs })
    else clock.addCall(wall, res.latencyMs)
    latencyMs += res.latencyMs
    usage.calls++
    const u = res.ok ? res.usage : res.usage
    if (u) {
      usage.inputTokens += u.inputTokens
      usage.outputTokens += u.outputTokens
    }
    return res
  }
  const fail = (status: 'retryable_error' | 'fatal_error', code: WindowErrorCode, message: string): WindowOutcome => ({
    status,
    code,
    message,
    latencyMs,
    raw,
    usage,
    attemptMs: clock.elapsed(),
  })

  const input = await deps.store.loadWindow(window)
  if (!input.messages.length) {
    return {
      status: 'done',
      itemsCreated: 0,
      droppedInvalidEvidence: 0,
      rawItemCount: 0,
      dedup: 'not_needed',
      interaction: 'not_needed',
      latencyMs,
      usage,
      raw,
      attemptMs: clock.elapsed(),
    }
  }
  const version = deps.promptVersion ?? PROMPT_VERSION
  const interactionVersion = deps.interactionPromptVersion ?? INTERACTION_PROMPT_VERSION
  const timeoutMs = hasDeadline ? Math.min(EXTRACT_TIMEOUT_MS, remaining() - EXTRACT_RESERVE_MS) : NO_DEADLINE_TIMEOUT_MS
  if (timeoutMs < 1_000) return fail('retryable_error', 'deadline', 'not enough time left for the extract call')

  /**
   * The two calls are independent — neither needs the other's output — so they go out together and the window's wall
   * time is `max(extract, interaction)`, not their sum (ARCHITECTURE §6; DECISIONS I17, which overturns I6's
   * latency argument). Both tasks are started before either is awaited.
   */
  const parallel: { wall: number; latency: number }[] = []
  const extractTask = async () =>
    call(
      {
        purpose: 'extract',
        promptVersion: version,
        model: deps.model,
        messages: renderExtractPrompt(input, version),
        maxTokens: EXTRACT_MAX_TOKENS,
        temperature: 0,
        timeoutMs,
        deadlineAt: callDeadline(),
        maxTransportRetries: hasDeadline ? 0 : 2,
        context: deps.context,
      },
      parallel,
    )

  /**
   * Failure isolation: this never throws and never returns an error the caller must handle. A failed or skipped
   * interaction call costs the window its segment and loops and nothing else — the claims still persist and the
   * window still counts `done`. The reverse does not hold: when the extraction call fails the whole attempt is
   * retried and this result is discarded with it.
   */
  const interactionTask = async (): Promise<InteractionResult> => {
    if (hasDeadline && remaining() < INTERACTION_MIN_REMAINING_MS) return { status: 'skipped_deadline' }
    try {
      const r = await call(
        {
          purpose: INTERACTION_PURPOSE,
          promptVersion: interactionVersion,
          model: deps.model,
          messages: renderInteractionPrompt(input, interactionVersion),
          maxTokens: INTERACTION_MAX_TOKENS,
          temperature: 0,
          timeoutMs,
          deadlineAt: callDeadline(),
          maxTransportRetries: hasDeadline ? 0 : 2,
          context: deps.context,
        },
        parallel,
      )
      if (!r.ok) return { status: 'failed' }
      const iv = validateInteraction(r.json, input)
      if ('error' in iv) return { status: 'failed' }
      const ig = applyInteractionSensitiveGuard(iv.output)
      return {
        status: 'ok',
        output: ig.output,
        dropped: iv.dropped,
        rawItemCount: iv.rawItemCount,
        rewritten: ig.rewritten,
      }
    } catch {
      // a programming error in the interaction path may not take the window's claims down with it
      return { status: 'failed' }
    }
  }

  const [res, ir] = await Promise.all([extractTask(), interactionTask()])
  // one charge for the pair: the window waited for the slower of the two, not for both
  if (parallel.length) clock.addCall(Math.max(...parallel.map((c) => c.wall)), Math.max(...parallel.map((c) => c.latency)))
  if (!res.ok) {
    raw = res.raw
    const m = mapLlmError(res)
    return fail(m.status, m.code, res.message)
  }
  raw = res.raw

  const features = promptFeatures(version)
  const v = validateOutput(res.json, input, {
    milestoneRules: features.milestoneRules,
  })
  if ('error' in v) return fail('retryable_error', 'validation_failed', v.issues.slice(0, 3).join('; '))
  const guarded = applySensitiveGuard(v.output)
  const interactionDropped: DroppedItem[] = ir.status === 'ok' ? ir.dropped : []
  const droppedInvalidEvidence = [...v.dropped, ...interactionDropped].filter((d) => d.reason === 'evidence_out_of_window').length

  const items = await resolveItems(guarded.output, input, deps.store, window.importId)
  if (ir.status === 'ok') Object.assign(items, resolveInteraction(ir.output, input))

  // Dedup: exact statement matches deterministically, the rest in one LLM call per window.
  let dedup: 'ran' | 'skipped_deadline' | 'failed' | 'not_needed' = 'not_needed'
  const groups: DedupGroupInput[] = []
  const labelOf = new Map(input.known.map((p) => [p.personId, p.label]))
  const byPerson = new Map<number, number[]>()
  items.claims.forEach((c, i) => byPerson.set(c.personId, [...(byPerson.get(c.personId) ?? []), i]))
  const loopsByPerson = new Map<number, number[]>()
  items.loops.forEach((l, i) => loopsByPerson.set(l.personId, [...(loopsByPerson.get(l.personId) ?? []), i]))
  const redundant = new Set<number>()
  for (const personId of new Set([...byPerson.keys(), ...loopsByPerson.keys()])) {
    const idxs = byPerson.get(personId) ?? []
    const candidates = idxs.length ? (await deps.store.findSimilarClaims(personId, window.importId)).slice(-DEDUP_MAX_CANDIDATES) : []
    const rest: { index: number; statement: string }[] = []
    if (candidates.length) {
      // validateOutput drops the generic student status next to a grade or a named school in the same window; here against
      // this import's claims (DECISIONS ## extract X28).
      // Proposed candidates carry no evidence kinds, so only a grade or class counts for them; a named school counts once
      // the user has confirmed it.
      const gradeKnown = candidates.some((c) => (c.status === 'confirmed' ? statesEnrolment(c.statement) : GRADE.test(normName(c.statement))))
      const exact = new Map(candidates.map((c) => [normName(c.statement), c.id]))
      for (const i of idxs) {
        if (gradeKnown && STUDENT_STATUS.test(normName(items.claims[i].statement))) {
          redundant.add(i)
          continue
        }
        const hit = exact.get(normName(items.claims[i].statement))
        if (hit !== undefined) items.claims[i].duplicateOf = hit
        else rest.push({ index: i, statement: items.claims[i].statement })
      }
    }
    // Loops of this person, on the same call: exact text matches merge without the model, the rest go in the offset range.
    const loopIdxs = loopsByPerson.get(personId) ?? []
    const loopCandidates = loopIdxs.length && deps.store.findSimilarLoops ? (await deps.store.findSimilarLoops(personId, window.importId)).slice(-DEDUP_MAX_CANDIDATES) : []
    if (loopCandidates.length) {
      const exactLoop = new Map(loopCandidates.map((l) => [normName(l.text), l.id]))
      for (const i of loopIdxs) {
        const hit = exactLoop.get(normName(items.loops[i].text))
        if (hit !== undefined) items.loops[i].duplicateOf = hit
        else
          rest.push({
            index: LOOP_INDEX_OFFSET + i,
            statement: items.loops[i].text,
          })
      }
    }
    const all = [
      ...candidates.map((c) => ({ id: c.id, statement: c.statement })),
      ...loopCandidates.map((l) => ({
        id: LOOP_ID_OFFSET + l.id,
        statement: l.text,
      })),
    ]
    if (rest.length && all.length)
      groups.push({
        personId,
        label: labelOf.get(personId) ?? '',
        candidates: all,
        new: rest,
      })
  }
  if (groups.length) {
    if (hasDeadline && remaining() < DEDUP_MIN_REMAINING_MS) {
      dedup = 'skipped_deadline'
    } else {
      const r = await runDedup(call, groups, {
        model: deps.model,
        timeoutMs: hasDeadline ? Math.min(DEDUP_TIMEOUT_MS, remaining() - PERSIST_RESERVE_MS) : NO_DEADLINE_TIMEOUT_MS,
        deadlineAt: callDeadline(),
        maxTransportRetries: hasDeadline ? 0 : 2,
        context: deps.context,
      })
      if (r.ok) {
        dedup = 'ran'
        for (const [i, id] of r.duplicates) {
          if (i >= LOOP_INDEX_OFFSET && id >= LOOP_ID_OFFSET) items.loops[i - LOOP_INDEX_OFFSET].duplicateOf = id - LOOP_ID_OFFSET
          else if (i < LOOP_INDEX_OFFSET && id < LOOP_ID_OFFSET && items.claims[i]) items.claims[i].duplicateOf = id
        }
      } else dedup = 'failed'
    }
  }

  if (redundant.size) items.claims = items.claims.filter((_, i) => !redundant.has(i))

  const { created } = await deps.store.proposeItems(window.importId, items, {
    jobId: window.jobId,
    windowIndex: window.windowIndex,
  })
  return {
    status: 'done',
    itemsCreated: created,
    droppedInvalidEvidence,
    rawItemCount: v.rawItemCount + (ir.status === 'ok' ? ir.rawItemCount : 0),
    dedup,
    interaction: ir.status,
    latencyMs,
    usage,
    raw,
    attemptMs: clock.elapsed(),
    sensitiveRewritten: guarded.rewritten + (ir.status === 'ok' ? ir.rewritten : 0),
    dropped: [...v.dropped, ...interactionDropped],
  }
}

type InteractionResult =
  | {
      status: 'ok'
      output: InteractionOutput
      dropped: DroppedItem[]
      rawItemCount: number
      rewritten: number
    }
  | { status: 'skipped_deadline' }
  | { status: 'failed' }

/** tempIds → persons (reuse a person this import already created with the same label, else create); seqs → message ids. */
export async function resolveItems(out: ExtractionOutput, input: LoadedWindow, store: ExtractStore, importId: number): Promise<ResolvedItems> {
  const ids = (ev: number[]) => [...new Set(ev.map((s) => input.seqMap.get(s)).filter((x): x is number => x !== undefined))]
  const refs: { ref: PersonRef; evidence: number[] }[] = [
    ...out.handles.map((h) => ({ ref: h.person, evidence: h.evidence })),
    ...out.relations.flatMap((r) => [
      { ref: r.from, evidence: r.evidence },
      { ref: r.to, evidence: r.evidence },
    ]),
    ...out.claims.map((c) => ({ ref: c.person, evidence: c.evidence })),
    ...out.events.flatMap((e) => e.participants.map((p) => ({ ref: p, evidence: e.evidence }))),
    ...out.dates.map((d) => ({ ref: d.person, evidence: d.evidence })),
  ]
  const tempEvidence = new Map<string, number[]>()
  for (const { ref, evidence } of refs) if ('tempId' in ref) tempEvidence.set(ref.tempId, [...(tempEvidence.get(ref.tempId) ?? []), ...evidence])

  const tempMap = new Map<string, number>()
  const labels = new Map<number, string>(input.known.map((p) => [p.personId, p.label]))
  for (const np of out.newPersons) {
    const ev = tempEvidence.get(np.tempId)
    if (!ev) continue // not referenced by any surviving item: no orphan person
    const messageIds = ids([...np.evidence.filter((s) => input.seqMap.has(s)), ...ev])
    const id = (await store.resolveTempPerson(importId, np.label, messageIds)) ?? (await store.createPerson(importId, np.label))
    tempMap.set(np.tempId, id)
    labels.set(id, np.label)
  }
  const pid = (r: PersonRef) => ('personId' in r ? r.personId : (tempMap.get(r.tempId) as number))

  const mentionable = [...labels].filter(([, l]) => l.trim().length >= 2)
  const mentionsOf = (personId: number, statement: string) => mentionable.filter(([id, l]) => id !== personId && statement.includes(l)).map(([id]) => id)

  return {
    handles: out.handles.map((h) => ({
      personId: pid(h.person),
      kind: h.kind,
      value: h.value,
      messageIds: ids(h.evidence),
    })),
    relations: out.relations
      .map((r) => ({
        fromPersonId: pid(r.from),
        toPersonId: pid(r.to),
        type: r.type,
        label: r.label,
        messageIds: ids(r.evidence),
      }))
      .filter((r) => r.fromPersonId !== r.toPersonId),
    claims: out.claims.map((c) => {
      const personId = pid(c.person)
      return {
        personId,
        statement: c.statement,
        category: c.category,
        validFrom: c.validFrom,
        confidence: c.confidence,
        sensitive: c.sensitive,
        supersedesClaimId: c.supersedesClaimId,
        messageIds: ids(c.evidence),
        mentionIds: mentionsOf(personId, c.statement),
      }
    }),
    events: out.events.map((e) => ({
      summary: e.summary,
      happenedAt: e.happenedAt,
      place: e.place,
      participantIds: [...new Set(e.participants.map(pid))],
      messageIds: ids(e.evidence),
    })),
    dates: out.dates.map((d) => ({
      personId: pid(d.person),
      kind: d.kind,
      day: d.day,
      month: d.month,
      year: d.year,
      calendar: d.calendar,
      isLeapMonth: d.isLeapMonth,
      messageIds: ids(d.evidence),
    })),
    // The interaction layer comes from the other call; `resolveInteraction` fills these when it succeeded.
    loops: [],
    closes: [],
  }
}

/**
 * Interaction layer (SPEC §8.8), resolved from the second call's own output. Its person refs are already known
 * persons — `validateInteraction` drops anything else — so there is no tempId map to share with the extraction call,
 * which is what lets the two calls run in parallel.
 *
 * The segment's span, message count and participants are computed from the window itself, not from the model:
 * `speakers` only decides whether a person is mentioned at all, because the model cannot count and the row is what
 * the 来往 rhythm is read from. A loop opens at the earliest of its evidence messages and a close lands on the
 * earliest of its own — the ordering `validateInteraction` already checked.
 */
export function resolveInteraction(out: InteractionOutput, input: LoadedWindow): Pick<ResolvedItems, 'segment' | 'loops' | 'closes'> {
  const sentAt = (localSeq: number) => input.messages[localSeq - 1]?.sentAt ?? ''
  const ids = (ev: number[]) => [...new Set(ev.map((s) => input.seqMap.get(s)).filter((x): x is number => x !== undefined))]
  const pid = (r: PersonRef) => ('personId' in r ? r.personId : 0)

  const loops: ResolvedItems['loops'] = out.loops.flatMap((l) => {
    const messageIds = ids(l.evidence)
    const openedMessageId = input.seqMap.get(l.evidence[0])
    if (!messageIds.length || openedMessageId === undefined) return []
    const personId = pid(l.person)
    if (!personId) return []
    return [
      {
        personId,
        direction: l.direction,
        kind: l.kind,
        text: l.text,
        ...(l.dueAt ? { dueAt: l.dueAt } : {}),
        openedMessageId,
        openedAt: sentAt(l.evidence[0]),
        messageIds,
      },
    ]
  })

  const closes: ResolvedItems['closes'] = out.closes.flatMap((c) => {
    const closedMessageId = input.seqMap.get(c.evidence[0])
    if (closedMessageId === undefined) return []
    return [
      {
        loopId: c.loopId,
        reason: c.reason,
        closedMessageId,
        closedAt: sentAt(c.evidence[0]),
      },
    ]
  })

  if (!out.segment) return { loops, closes }
  const messageIds = ids(out.segment.evidence)
  if (!messageIds.length) return { loops, closes }
  const counts = new Map<number, number>()
  for (const m of input.messages) if (m.senderPersonId !== null && m.senderPersonId > 0) counts.set(m.senderPersonId, (counts.get(m.senderPersonId) ?? 0) + 1)
  return {
    segment: {
      chatId: input.chatId,
      startSeq: input.span.startSeq,
      endSeq: input.span.endSeq,
      startedAt: input.span.startedAt,
      endedAt: input.span.endedAt,
      messageCount: input.messages.length,
      summary: out.segment.summary,
      topics: out.segment.topics,
      participants: [...counts].map(([personId, messageCount]) => ({
        personId,
        messageCount,
      })),
      messageIds,
    },
    loops,
    closes,
  }
}
