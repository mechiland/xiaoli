// Single-window extraction, storage-agnostic (SPEC §8.6; ARCHITECTURE §6 extractWindow + per-request deadline).
import type { ExtractModel, ExtractionOutput, PersonRef, SettingsDTO } from '@/contracts'
import type { LlmClient, LlmError, LlmJsonRequest, LlmJsonResult, LlmRequestContext } from '@/server/llm'
import { DEDUP_MAX_CANDIDATES, runDedup } from './dedup'
import type { DedupGroupInput } from './prompt'
import { renderExtractPrompt } from './prompt'
import { PROMPT_VERSION, promptFeatures } from './prompt-version'
import { applySensitiveGuard } from './sensitive'
import type { ExtractStore, LoadedWindow, ResolvedItems, WindowErrorCode, WindowOutcome, WindowRef, WindowUsage } from './types'
import { GRADE, normName, statesEnrolment, STUDENT_STATUS, validateOutput } from './validate'

export const EXTRACT_MAX_TOKENS = 8192
/** ARCHITECTURE §6 step 1: extract call ≤ 20 s and leaves 6 s for dedup + persistence */
export const EXTRACT_TIMEOUT_MS = 20_000
export const EXTRACT_RESERVE_MS = 6_000
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

function mapLlmError(e: LlmError): { status: 'retryable_error' | 'fatal_error'; code: WindowErrorCode } {
  switch (e.code) {
    case 'invalid_json':
    case 'truncated':
    case 'timeout':
    case 'deadline':
      return { status: 'retryable_error', code: e.code }
    case 'budget_exceeded':
    case 'cassette_miss':
      return { status: 'fatal_error', code: e.code }
    default:
      return { status: 'retryable_error', code: 'llm_error' }
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

  const call = async (req: LlmJsonRequest): Promise<LlmJsonResult | LlmError> => {
    const w0 = realNow()
    const res = await deps.llm.completeJson(req)
    clock.addCall(realNow() - w0, res.latencyMs)
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
    return { status: 'done', itemsCreated: 0, droppedInvalidEvidence: 0, rawItemCount: 0, dedup: 'not_needed', latencyMs, usage, raw, attemptMs: clock.elapsed() }
  }
  const version = deps.promptVersion ?? PROMPT_VERSION
  const timeoutMs = hasDeadline ? Math.min(EXTRACT_TIMEOUT_MS, remaining() - EXTRACT_RESERVE_MS) : NO_DEADLINE_TIMEOUT_MS
  if (timeoutMs < 1_000) return fail('retryable_error', 'deadline', 'not enough time left for the extract call')

  const res = await call({
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
  })
  if (!res.ok) {
    raw = res.raw
    const m = mapLlmError(res)
    return fail(m.status, m.code, res.message)
  }
  raw = res.raw

  const v = validateOutput(res.json, input, { milestoneRules: promptFeatures(version).milestoneRules })
  if ('error' in v) return fail('retryable_error', 'validation_failed', v.issues.slice(0, 3).join('; '))
  const guarded = applySensitiveGuard(v.output)
  const droppedInvalidEvidence = v.dropped.filter((d) => d.reason === 'evidence_out_of_window').length

  const items = await resolveItems(guarded.output, input, deps.store, window.importId)

  // Dedup: exact statement matches deterministically, the rest in one LLM call per window.
  let dedup: 'ran' | 'skipped_deadline' | 'failed' | 'not_needed' = 'not_needed'
  const groups: DedupGroupInput[] = []
  const labelOf = new Map(input.known.map((p) => [p.personId, p.label]))
  const byPerson = new Map<number, number[]>()
  items.claims.forEach((c, i) => byPerson.set(c.personId, [...(byPerson.get(c.personId) ?? []), i]))
  const redundant = new Set<number>()
  for (const [personId, idxs] of byPerson) {
    const candidates = (await deps.store.findSimilarClaims(personId, window.importId)).slice(-DEDUP_MAX_CANDIDATES)
    if (!candidates.length) continue
    // validateOutput drops the generic student status next to a grade or a named school in the same window; here against
    // this import's claims (DECISIONS ## extract X28).
    // Proposed candidates carry no evidence kinds, so only a grade or class counts for them; a named school counts once
    // the user has confirmed it.
    const gradeKnown = candidates.some((c) => (c.status === 'confirmed' ? statesEnrolment(c.statement) : GRADE.test(normName(c.statement))))
    const exact = new Map(candidates.map((c) => [normName(c.statement), c.id]))
    const rest: { index: number; statement: string }[] = []
    for (const i of idxs) {
      if (gradeKnown && STUDENT_STATUS.test(normName(items.claims[i].statement))) {
        redundant.add(i)
        continue
      }
      const hit = exact.get(normName(items.claims[i].statement))
      if (hit !== undefined) items.claims[i].duplicateOf = hit
      else rest.push({ index: i, statement: items.claims[i].statement })
    }
    if (rest.length) groups.push({ personId, label: labelOf.get(personId) ?? '', candidates: candidates.map((c) => ({ id: c.id, statement: c.statement })), new: rest })
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
        for (const [i, id] of r.duplicates) items.claims[i].duplicateOf = id
      } else dedup = 'failed'
    }
  }

  if (redundant.size) items.claims = items.claims.filter((_, i) => !redundant.has(i))

  const { created } = await deps.store.proposeItems(window.importId, items, { jobId: window.jobId, windowIndex: window.windowIndex })
  return {
    status: 'done',
    itemsCreated: created,
    droppedInvalidEvidence,
    rawItemCount: v.rawItemCount,
    dedup,
    latencyMs,
    usage,
    raw,
    attemptMs: clock.elapsed(),
    sensitiveRewritten: guarded.rewritten,
    dropped: v.dropped,
  }
}

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
  const mentionsOf = (personId: number, statement: string) =>
    mentionable.filter(([id, l]) => id !== personId && statement.includes(l)).map(([id]) => id)

  return {
    handles: out.handles.map((h) => ({ personId: pid(h.person), kind: h.kind, value: h.value, messageIds: ids(h.evidence) })),
    relations: out.relations
      .map((r) => ({ fromPersonId: pid(r.from), toPersonId: pid(r.to), type: r.type, label: r.label, messageIds: ids(r.evidence) }))
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
  }
}
