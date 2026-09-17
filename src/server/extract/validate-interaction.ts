// Interaction-call validation (SPEC §8.8 "入库前校验"; ARCHITECTURE §6 `validateInteraction`). Pure.
//
// The interaction layer is a SECOND model call over the same window, issued in parallel with the extraction call
// (DECISIONS I17, ## extract X40). This file holds the rules that used to live behind `validateOutput`'s
// `opts.interaction`; `validateOutput` is back to exactly what it was for extract.v8.
//
// Same shape of contract as `validateOutput`: the top level is strict (a non-object, an unknown key or a non-array
// value fails the whole call and the call is retried), each item is parsed strictly on its own and an invalid item is
// dropped. The rules here are **mechanical only** — evidence in window, not context-only, a close naming a loop this
// window was actually shown, a same-day errand carrying no date. Whether a `promise` really is a commitment worth
// remembering is otherwise the prompt's job (ARCHITECTURE §6).
import { z } from 'zod'
import { InteractionOutputSchema, type InteractionOutput, type PersonRef } from '@/contracts'
import type { DroppedItem, WindowInput } from './types'
import { CleanCtx, cleanItem, failingFields, INVISIBLE_KINDS, isObj, LOOP_MOMENTARY, normName, PARTIAL_DATE, refKey } from './validate'

const ARRAY_KEYS = ['loops', 'closes'] as const
type ArrayKey = (typeof ARRAY_KEYS)[number]
const ALL_KEYS: readonly string[] = [...ARRAY_KEYS, 'segment']

function elementSchema(key: ArrayKey): z.ZodType {
  const field = InteractionOutputSchema.shape[key] as unknown as { unwrap(): { element: z.ZodType } }
  return field.unwrap().element
}
const ELEMENT: Record<ArrayKey, z.ZodType> = Object.fromEntries(ARRAY_KEYS.map((k) => [k, elementSchema(k)])) as Record<ArrayKey, z.ZodType>
const SEGMENT_SCHEMA: z.ZodType = (InteractionOutputSchema.shape.segment as unknown as { unwrap(): { unwrap(): z.ZodType } }).unwrap().unwrap()

/** A summary shorter than this says nothing about the conversation ("嗯", "闲聊"): the whole segment goes. */
const MIN_SUMMARY_CHARS = 4

export type ValidateInteractionResult =
  | { output: InteractionOutput; dropped: DroppedItem[]; rawItemCount: number }
  | { error: 'validation_failed'; issues: string[] }

/**
 * The interaction call is given person **labels**, not the archive, and it is told to use the ids the input carries.
 * It therefore has no `newPersons` section and nothing to resolve a `tempId` against — the extraction call's tempIds
 * belong to a different call that ran in parallel and may have failed. A ref that is not a known person of this
 * window (self included) is `unknown_person`.
 */
export function validateInteraction(json: unknown, input: WindowInput): ValidateInteractionResult {
  if (!isObj(json)) return { error: 'validation_failed', issues: ['output is not a JSON object'] }
  const unknown = Object.keys(json).filter((k) => !ALL_KEYS.includes(k))
  if (unknown.length) return { error: 'validation_failed', issues: [`unknown top-level keys: ${unknown.join(', ')}`] }
  for (const k of ARRAY_KEYS) {
    const v = json[k]
    if (v !== undefined && v !== null && !Array.isArray(v)) return { error: 'validation_failed', issues: [`${k} is not an array`] }
  }

  const dropped: DroppedItem[] = []
  let rawItemCount = 0
  const ctx: CleanCtx = { input, tempEvidence: new Map() }
  const out: InteractionOutput = { segment: null, loops: [], closes: [] }

  const n = input.messages.length
  const contextSeqs = new Set(input.messages.filter((m) => m.context).map((m) => m.localSeq))
  const checkEvidence = (path: string, ev: number[]): number[] | null => {
    const uniq = [...new Set(ev)].sort((a, b) => a - b)
    if (!uniq.length) {
      dropped.push({ path, reason: 'empty_evidence' })
      return null
    }
    if (uniq.some((s) => s < 1 || s > n)) {
      dropped.push({ path, reason: 'evidence_out_of_window' })
      return null
    }
    if (contextSeqs.size && uniq.every((s) => contextSeqs.has(s))) {
      dropped.push({ path, reason: 'context_only' })
      return null
    }
    // Voice, pictures, stickers, transfers carry no visible content (prompt: 看不见的内容不猜).
    if (uniq.every((s) => INVISIBLE_KINDS.has(input.messages[s - 1].kind))) {
      dropped.push({ path, reason: 'invalid_item' })
      return null
    }
    return uniq
  }

  const knownIds = new Set<number>([...(input.selfPersonId > 0 ? [input.selfPersonId] : []), ...input.known.map((p) => p.personId)])
  const resolveRef = (r: PersonRef): PersonRef | null => ('personId' in r && knownIds.has(r.personId) ? r : null)
  const mergeEvidence = (a: number[], b: number[]) => [...new Set([...a, ...b])].sort((x, y) => x - y)

  // ---- loops ------------------------------------------------------------------------------------------------
  const rawLoops = (json.loops as unknown[] | undefined | null) ?? []
  rawItemCount += rawLoops.length
  const loopIdx = new Map<string, number>()
  rawLoops.forEach((raw, i) => {
    const path = `loops[${i}]`
    const r = ELEMENT.loops.safeParse(cleanItem(null, raw, ctx))
    if (!r.success) {
      dropped.push({ path, reason: 'invalid_item', fields: failingFields(r.error.issues as never) })
      return
    }
    const l = r.data as InteractionOutput['loops'][number]
    const person = resolveRef(l.person)
    if (!person) {
      dropped.push({ path, reason: 'unknown_person' })
      return
    }
    // `direction` is written from the user's side, so a loop between the user and the user is not one (SPEC §7).
    if (input.selfPersonId > 0 && 'personId' in person && person.personId === input.selfPersonId) {
      dropped.push({ path, reason: 'self_loop' })
      return
    }
    const ev = checkEvidence(path, l.evidence)
    if (!ev) return
    const { dueAt: rawDue, ...rest } = l
    const dueAt = rawDue?.trim()
    const dated = !!dueAt && PARTIAL_DATE.test(dueAt)
    // Undated immediate coordination still gets filtered. Explicitly dated requests (e.g. bring materials
    // tomorrow) survive: action value, rather than month-long relationship value, governs interaction.v3.
    if (!dated && LOOP_MOMENTARY.test(normName(l.text))) {
      dropped.push({ path, reason: 'momentary' })
      return
    }
    const kept: InteractionOutput['loops'][number] = { ...rest, person, evidence: ev, ...(dated ? { dueAt } : {}) }
    const key = `${refKey(person)}|${normName(l.text)}`
    const at = loopIdx.get(key)
    if (at !== undefined) out.loops[at].evidence = mergeEvidence(out.loops[at].evidence, ev)
    else {
      loopIdx.set(key, out.loops.length)
      out.loops.push(kept)
    }
  })

  // ---- closes -----------------------------------------------------------------------------------------------
  // `closes[].loopId` may only name a loop this window's input actually carried, and only a message at or after the
  // loop opened can close it (so a re-import of older messages never closes a later commitment).
  const openedAt = new Map<number, string>()
  const loopKinds = new Map<number, string>()
  for (const p of input.known) for (const l of p.openLoops ?? []) {
    openedAt.set(l.id, l.openedAt)
    loopKinds.set(l.id, l.kind)
  }
  const rawCloses = (json.closes as unknown[] | undefined | null) ?? []
  rawItemCount += rawCloses.length
  const closed = new Set<number>()
  rawCloses.forEach((raw, i) => {
    const path = `closes[${i}]`
    const r = ELEMENT.closes.safeParse(cleanItem(null, raw, ctx))
    if (!r.success) {
      dropped.push({ path, reason: 'invalid_item', fields: failingFields(r.error.issues as never) })
      return
    }
    const c = r.data as InteractionOutput['closes'][number]
    const ev = checkEvidence(path, c.evidence)
    if (!ev) return
    const opened = openedAt.get(c.loopId)
    const at = input.messages[ev[0] - 1]?.sentAt
    if (opened === undefined || !at || opened > at) {
      dropped.push({ path, reason: 'unknown_close' })
      return
    }
    // A read receipt is not evidence that an action was completed. Questions can legitimately be answered this way.
    const receipt = /^(收到|好的|好|ok|知道了|明白了)([，,。.!！\s]*(谢谢老师|谢谢|老师辛苦了))?[\p{P}\s]*$/iu
    if (loopKinds.get(c.loopId) !== 'question' && ev.every((seq) => receipt.test(input.messages[seq - 1].body.trim()))) {
      dropped.push({ path, reason: 'invalid_item' })
      return
    }
    if (closed.has(c.loopId)) {
      dropped.push({ path, reason: 'invalid_item' })
      return
    }
    closed.add(c.loopId)
    out.closes.push({ ...c, evidence: ev })
  })

  // ---- segment ----------------------------------------------------------------------------------------------
  // At most one segment per window (SPEC §8.8): a model that returns a list keeps the first.
  const rawSegment = json.segment
  if (rawSegment !== undefined && rawSegment !== null) {
    const list = Array.isArray(rawSegment) ? rawSegment : [rawSegment]
    rawItemCount += list.length
    list.forEach((raw, i) => {
      const path = list.length > 1 ? `segment[${i}]` : 'segment'
      if (i > 0) {
        dropped.push({ path, reason: 'invalid_item' })
        return
      }
      const r = SEGMENT_SCHEMA.safeParse(cleanItem(null, raw, ctx))
      if (!r.success) {
        dropped.push({ path, reason: 'invalid_item', fields: failingFields(r.error.issues as never) })
        return
      }
      const seg = r.data as NonNullable<InteractionOutput['segment']>
      if (normName(seg.summary).length < MIN_SUMMARY_CHARS) {
        dropped.push({ path, reason: 'invalid_item' })
        return
      }
      const ev = checkEvidence(path, seg.evidence)
      if (!ev) return
      const seen = new Set<string>()
      const speakers: PersonRef[] = []
      for (const sp of seg.speakers) {
        const resolved = resolveRef(sp)
        if (resolved && !seen.has(refKey(resolved))) {
          seen.add(refKey(resolved))
          speakers.push(resolved)
        }
      }
      out.segment = { ...seg, speakers, evidence: ev }
    })
  }

  return { output: out, dropped, rawItemCount }
}
