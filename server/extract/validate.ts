// Output validation (SPEC §8.6 "入库前校验"; ARCHITECTURE §6 validateOutput). Pure.
//
// Top level is strict: a non-object, an unknown key or a non-array value fails the whole window (validation_failed).
// Each array item is validated strictly on its own; an invalid item is dropped (`invalid_item`) so one malformed item
// does not throw away the window (a retry at temperature 0 would reproduce it). Before validation, null optional fields
// are removed and obvious encodings are normalised ("#12" → 12 in evidence, bare person ids → PersonRef).
import { z } from 'zod'
import { ExtractionOutputSchema, type ExtractionOutput, type PersonRef } from '@/contracts'
import type { DroppedItem, ValidateResult, WindowInput } from './types'

const KEYS = ['newPersons', 'handles', 'relations', 'claims', 'events', 'dates'] as const
type Key = (typeof KEYS)[number]

function elementSchema(key: Key): z.ZodType {
  const field = ExtractionOutputSchema.shape[key] as unknown as { unwrap(): { element: z.ZodType } }
  return field.unwrap().element
}
const ELEMENT: Record<Key, z.ZodType> = Object.fromEntries(KEYS.map((k) => [k, elementSchema(k)])) as Record<Key, z.ZodType>

/** Kin terms that are not a direct parent or child (grandparents, uncles and aunts, cousins, in-laws). */
const EXTENDED_KIN = /爷|奶|外公|外婆|姥|孙|叔|伯|姑|舅|姨|婶|侄|表|堂|亲家|公公|婆婆|岳/

/**
 * Speaker-relative parent/child vocatives ("妈", "老爸", "儿子"). In a group chat each speaker means a different person,
 * while a handle is unique per (owner, kind, value, chat) (SPEC data model): the first usage would become everyone's
 * alias. The kinship itself is kept as a relation. Private chats have one addressee and keep them (DECISIONS X26).
 */
const RELATIVE_VOCATIVE = /^(爸|爸爸|老爸|爹|老爹|妈|妈妈|老妈|娘|老娘|儿子|女儿|闺女|儿)$/
/** Time words that tie a statement to the moment ("这两天牙疼"): not a fact that is still useful a month later. */
const MOMENTARY = /这两天|这几天|今天|昨天|明天|前天|后天|刚才|刚刚|这周|本周|这会儿|最近几天/
/** Explicit not-yet-happened markers at the start of a statement ("将搬去…"): plans are not recorded (prompt rule). */
const PLAN_MARKER = /^(将要|即将|将|准备|打算)/
/**
 * Claims below this confidence are not proposed. Prompt scale: 0.9 直接陈述, 0.8 随口提到, 0.6 需要结合上下文. Calibration on
 * extract.v5 (DECISIONS ## extract X26): of the model's 0.6/0.8 claims on the synthetic eval nearly all were false positives
 * (inferred residence, "换了新学校", one-off wishes), against one true positive; real-data claims were all ≥ 0.85.
 */
export const MIN_CLAIM_CONFIDENCE = 0.85
/** The generic "is a student" status. */
export const STUDENT_STATUS = /^(在上学|是学生|在读书|还在上学|在读)([，,、]?(是学生|在上学))?$/
/** A grade or class states enrolment more specifically than the generic student status. */
export const GRADE = /年级|[一二三四五六七八九]年[一二三四五六七八九十\d]+班|大[一二三四]|初[一二三]|高[一二三]|研[一二三]|博[一二三]/
/** Words in a message that can support a schooling status at all. */
const SCHOOL_CUE = /学|校|课|班|年级|放假|开学|考试|作业|老师/
/** A child's fact phrased on the parent ("儿子只看漫画"). */
const CHILD_PREFIX = /^(儿子|女儿|闺女|孩子)的?/

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function normName(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

function dropNulls(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined) continue
    out[k] = typeof v === 'string' ? v.trim() : v
  }
  return out
}

function cleanRef(v: unknown): unknown {
  if (typeof v === 'number') return { personId: v }
  if (typeof v === 'string') return /^\d+$/.test(v.trim()) ? { personId: Number(v.trim()) } : { tempId: v.trim() }
  if (isObj(v)) {
    const o = dropNulls(v)
    if (typeof o.personId === 'string' && /^\d+$/.test(o.personId)) o.personId = Number(o.personId)
    return o
  }
  return v
}

function cleanEvidence(v: unknown): unknown {
  if (typeof v === 'number') return [v]
  if (!Array.isArray(v)) return v
  return v.map((e) => (typeof e === 'string' && /^#?\d+$/.test(e.trim()) ? Number(e.trim().replace('#', '')) : e))
}

function cleanItem(raw: unknown): unknown {
  if (!isObj(raw)) return raw
  const o = dropNulls(raw)
  if ('evidence' in o) o.evidence = cleanEvidence(o.evidence)
  for (const k of ['person', 'from', 'to']) if (k in o) o[k] = cleanRef(o[k])
  if (Array.isArray(o.participants)) o.participants = o.participants.map(cleanRef)
  return o
}

const refKey = (r: PersonRef) => ('personId' in r ? `p:${r.personId}` : `t:${r.tempId}`)

export function validateOutput(json: unknown, input: WindowInput): ValidateResult {
  if (!isObj(json)) return { error: 'validation_failed', issues: ['output is not a JSON object'] }
  const unknown = Object.keys(json).filter((k) => !(KEYS as readonly string[]).includes(k))
  if (unknown.length) return { error: 'validation_failed', issues: [`unknown top-level keys: ${unknown.join(', ')}`] }
  for (const k of KEYS) {
    const v = json[k]
    if (v !== undefined && v !== null && !Array.isArray(v)) return { error: 'validation_failed', issues: [`${k} is not an array`] }
  }

  let rawItemCount = 0
  const dropped: DroppedItem[] = []
  const parsed = {} as Record<Key, { i: number; item: Record<string, unknown> }[]>
  for (const k of KEYS) {
    const arr = (json[k] as unknown[] | undefined | null) ?? []
    rawItemCount += arr.length
    parsed[k] = []
    arr.forEach((raw, i) => {
      const r = ELEMENT[k].safeParse(cleanItem(raw))
      if (r.success) parsed[k].push({ i, item: r.data as Record<string, unknown> })
      else dropped.push({ path: `${k}[${i}]`, reason: 'invalid_item' })
    })
  }

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
    return uniq
  }

  // Known persons and the names they already have (label + handles). Ambiguous names (two persons) are not used.
  const knownIds = new Set<number>([...(input.selfPersonId > 0 ? [input.selfPersonId] : []), ...input.known.map((p) => p.personId)])
  const namesOf = new Map<number, Set<string>>()
  const byName = new Map<string, number>()
  for (const p of input.known) {
    const names = new Set([p.label, ...p.handles.map((h) => h.value)].map(normName).filter(Boolean))
    namesOf.set(p.personId, names)
    for (const nm of names) byName.set(nm, byName.has(nm) && byName.get(nm) !== p.personId ? -1 : p.personId)
  }
  // claim id → the person it belongs to: a claim may only supersede a confirmed claim of the same person.
  const claimOwner = new Map<number, number>(input.known.flatMap((p) => p.claims.map((c) => [c.id, p.personId] as [number, number])))

  const out: ExtractionOutput = { newPersons: [], handles: [], relations: [], claims: [], events: [], dates: [] }

  // newPersons: a "new" person whose label is already a known name becomes that known person.
  const tempToKnown = new Map<string, number>()
  const tempIds = new Set<string>()
  for (const { item } of parsed.newPersons) {
    const np = item as ExtractionOutput['newPersons'][number]
    if (tempIds.has(np.tempId) || tempToKnown.has(np.tempId)) continue
    const hit = byName.get(normName(np.label))
    if (hit !== undefined && hit > 0) {
      tempToKnown.set(np.tempId, hit)
      continue
    }
    // Person rows carry no evidence; keep only in-window seqs rather than dropping the person and every item about them.
    const ev = [...new Set(np.evidence)].filter((s) => s >= 1 && s <= n)
    tempIds.add(np.tempId)
    out.newPersons.push({ ...np, evidence: ev.length ? ev : np.evidence })
  }
  const resolveRef = (r: PersonRef): PersonRef | null => {
    if ('personId' in r) return knownIds.has(r.personId) ? r : null
    const k = tempToKnown.get(r.tempId)
    if (k !== undefined) return { personId: k }
    return tempIds.has(r.tempId) ? r : null
  }
  const mergeEvidence = (a: number[], b: number[]) => [...new Set([...a, ...b])].sort((x, y) => x - y)
  const newLabels = new Map(out.newPersons.map((np) => [np.tempId, normName(np.label)]))
  const personNames = (r: PersonRef): Set<string> =>
    'personId' in r ? (namesOf.get(r.personId) ?? new Set()) : new Set([newLabels.get(r.tempId) ?? ''].filter(Boolean))

  const handleIdx = new Map<string, number>()
  for (const { i, item } of parsed.handles) {
    const h = item as ExtractionOutput['handles'][number]
    const path = `handles[${i}]`
    const person = resolveRef(h.person)
    if (!person) {
      dropped.push({ path, reason: 'unknown_person' })
      continue
    }
    const ev = checkEvidence(path, h.evidence)
    if (!ev) continue
    // Names the person already has (sender display names come from mapping, not extraction).
    if ('personId' in person && namesOf.get(person.personId)?.has(normName(h.value))) continue
    if (h.kind === 'address_term' && input.chat.kind === 'group' && RELATIVE_VOCATIVE.test(normName(h.value))) {
      dropped.push({ path, reason: 'ambiguous_handle' })
      continue
    }
    const key = `${refKey(person)}|${normName(h.value)}`
    const at = handleIdx.get(key)
    if (at !== undefined) out.handles[at].evidence = mergeEvidence(out.handles[at].evidence, ev)
    else {
      handleIdx.set(key, out.handles.length)
      out.handles.push({ ...h, person, evidence: ev })
    }
  }

  const droppedOtherLabels: { person: string; label: string; evidence: Set<number> }[] = []
  const relIdx = new Map<string, number>()
  for (const { i, item } of parsed.relations) {
    const r = item as ExtractionOutput['relations'][number]
    const path = `relations[${i}]`
    const from = resolveRef(r.from)
    const to = resolveRef(r.to)
    if (!from || !to) {
      dropped.push({ path, reason: 'unknown_person' })
      continue
    }
    if (refKey(from) === refKey(to)) {
      dropped.push({ path, reason: 'self_loop' })
      continue
    }
    const ev = checkEvidence(path, r.evidence)
    if (!ev) continue
    let type = r.type.trim().toLowerCase()
    // parent/child are direct parents and children only; a grandparent/uncle/in-law label means `relative` (prompt rule).
    if ((type === 'parent' || type === 'child') && r.label && EXTENDED_KIN.test(r.label)) type = 'relative'
    // `other` needs a relation word; no label, or a label naming one of the two persons ("苏苏", "照顾苏苏"), is an
    // action or a name, not a relation. The same inference emitted as a claim of `from` on these messages goes too.
    const label = r.label ? normName(r.label) : ''
    if (type === 'other' && (!label || [from, to].some((p) => [...personNames(p)].some((nm) => nm.length >= 2 && label.includes(nm))))) {
      dropped.push({ path, reason: 'invalid_item' })
      if (label) droppedOtherLabels.push({ person: refKey(from), label, evidence: new Set(r.evidence) })
      continue
    }
    const key = `${refKey(from)}|${refKey(to)}|${type}`
    const at = relIdx.get(key)
    if (at !== undefined) out.relations[at].evidence = mergeEvidence(out.relations[at].evidence, ev)
    else {
      relIdx.set(key, out.relations.length)
      out.relations.push({ ...r, from, to, type, evidence: ev })
    }
  }

  const claimIdx = new Map<string, number>()
  for (const { i, item } of parsed.claims) {
    const c = { ...(item as ExtractionOutput['claims'][number]) }
    const path = `claims[${i}]`
    let person = resolveRef(c.person)
    // A child's fact phrased on the parent ("儿子只看漫画") belongs to the child when this window names exactly one child
    // of that parent (prompt: facts go on the person they are about).
    const childFact = person && CHILD_PREFIX.test(c.statement.trim()) ? c.statement.trim().replace(CHILD_PREFIX, '').replace(/^[，,：:\s]+/, '') : ''
    if (person && childFact.length >= 2 && !/^(叫|名叫|是)/.test(childFact)) {
      const pk = refKey(person)
      const kids = new Map<string, PersonRef>()
      for (const r of out.relations) {
        if (r.type === 'parent' && refKey(r.from) === pk) kids.set(refKey(r.to), r.to)
        if (r.type === 'child' && refKey(r.to) === pk) kids.set(refKey(r.from), r.from)
      }
      if (kids.size === 1) {
        person = [...kids.values()][0]
        c.statement = childFact
        delete c.supersedesClaimId
      }
    }
    if (!person) {
      dropped.push({ path, reason: 'unknown_person' })
      continue
    }
    const ev = checkEvidence(path, c.evidence)
    if (!ev) continue
    const stmt = normName(c.statement)
    if (c.confidence < MIN_CLAIM_CONFIDENCE) {
      dropped.push({ path, reason: 'low_confidence' })
      continue
    }
    if (MOMENTARY.test(stmt) || PLAN_MARKER.test(stmt)) {
      dropped.push({ path, reason: 'momentary' })
      continue
    }
    if (droppedOtherLabels.some((d) => d.person === refKey(person) && d.label === stmt && ev.some((s) => d.evidence.has(s)))) {
      dropped.push({ path, reason: 'invalid_item' })
      continue
    }
    if (c.supersedesClaimId !== undefined && !('personId' in person && claimOwner.get(c.supersedesClaimId) === person.personId)) {
      dropped.push({ path: `${path}.supersedesClaimId`, reason: 'unknown_supersedes' })
      delete c.supersedesClaimId
    }
    const key = `${refKey(person)}|${normName(c.statement)}`
    const at = claimIdx.get(key)
    if (at !== undefined) {
      const prev = out.claims[at]
      out.claims[at] = { ...prev, evidence: mergeEvidence(prev.evidence, ev), confidence: Math.max(prev.confidence, c.confidence) }
    } else {
      claimIdx.set(key, out.claims.length)
      out.claims.push({ ...c, person, evidence: ev })
    }
  }

  // A claim whose statement is contained in a more specific claim about the same person in this window ("住在深圳" next
  // to "住在深圳南山附近") is the same fact said twice: its evidence merges into the more specific claim (SPEC §8.6).
  const subsumed = new Set<number>()
  out.claims.forEach((a, i) => {
    const na = normName(a.statement)
    if (na.length < 2) return
    const j = out.claims.findIndex((b, k) => k !== i && !subsumed.has(k) && refKey(b.person) === refKey(a.person) && b.sensitive === a.sensitive && normName(b.statement).length > na.length && normName(b.statement).includes(na))
    if (j < 0) return
    const b = out.claims[j]
    out.claims[j] = { ...b, evidence: mergeEvidence(b.evidence, a.evidence), confidence: Math.max(b.confidence, a.confidence), ...(b.supersedesClaimId === undefined && a.supersedesClaimId !== undefined ? { supersedesClaimId: a.supersedesClaimId } : {}) }
    subsumed.add(i)
  })
  if (subsumed.size) out.claims = out.claims.filter((_, i) => !subsumed.has(i))

  // The generic student status adds nothing next to a grade or class of the same person (in this window or among
  // their confirmed claims), and is unsupported when none of its messages mentions schooling at all. The pipeline
  // repeats the first check against claims already proposed by this import (dropRedundantStudentStatus).
  const gradeKnown = new Set(input.known.filter((p) => p.claims.some((k) => GRADE.test(k.statement))).map((p) => `p:${p.personId}`))
  out.claims = out.claims.filter((c, i) => {
    if (!STUDENT_STATUS.test(normName(c.statement))) return true
    const pk = refKey(c.person)
    const redundant = gradeKnown.has(pk) || out.claims.some((o) => o !== c && refKey(o.person) === pk && GRADE.test(o.statement))
    const cue = c.evidence.some((s) => SCHOOL_CUE.test(input.messages[s - 1]?.body ?? ''))
    if (redundant || !cue) {
      dropped.push({ path: `claims[${i}]`, reason: 'redundant' })
      return false
    }
    return true
  })

  const eventIdx = new Map<string, number>()
  for (const { i, item } of parsed.events) {
    const e = item as ExtractionOutput['events'][number]
    const path = `events[${i}]`
    const seen = new Set<string>()
    const participants: PersonRef[] = []
    for (const p of e.participants) {
      const r = resolveRef(p)
      if (r && !seen.has(refKey(r))) {
        seen.add(refKey(r))
        participants.push(r)
      }
    }
    if (!participants.length) {
      dropped.push({ path, reason: 'unknown_person' })
      continue
    }
    const ev = checkEvidence(path, e.evidence)
    if (!ev) continue
    const key = normName(e.summary)
    const at = eventIdx.get(key)
    if (at !== undefined) out.events[at].evidence = mergeEvidence(out.events[at].evidence, ev)
    else {
      eventIdx.set(key, out.events.length)
      out.events.push({ ...e, participants, evidence: ev })
    }
  }

  const dateIdx = new Map<string, number>()
  for (const { i, item } of parsed.dates) {
    const d = item as ExtractionOutput['dates'][number]
    const path = `dates[${i}]`
    const person = resolveRef(d.person)
    if (!person) {
      dropped.push({ path, reason: 'unknown_person' })
      continue
    }
    const ev = checkEvidence(path, d.evidence)
    if (!ev) continue
    const kind = d.kind.trim().toLowerCase()
    const key = `${refKey(person)}|${kind}|${d.calendar}|${d.month ?? ''}|${d.day ?? ''}`
    const at = dateIdx.get(key)
    if (at !== undefined) out.dates[at].evidence = mergeEvidence(out.dates[at].evidence, ev)
    else {
      dateIdx.set(key, out.dates.length)
      out.dates.push({ ...d, person, kind, evidence: ev })
    }
  }

  // A solar date next to a lunar date of the same person and kind resting on the same messages is the model's own
  // conversion (prompt: keep the calendar as stated, never add the converted date) and is dropped.
  const lunarEvidence = new Map<string, Set<number>>()
  for (const d of out.dates) {
    if (d.calendar !== 'lunar') continue
    const k = `${refKey(d.person)}|${d.kind}`
    lunarEvidence.set(k, new Set([...(lunarEvidence.get(k) ?? []), ...d.evidence]))
  }
  out.dates = out.dates.filter((d, i) => {
    const lunar = d.calendar === 'solar' ? lunarEvidence.get(`${refKey(d.person)}|${d.kind}`) : undefined
    if (lunar && d.evidence.some((e) => lunar.has(e))) {
      dropped.push({ path: `dates[${i}]`, reason: 'invalid_item' })
      return false
    }
    return true
  })

  return { output: out, dropped, rawItemCount }
}
