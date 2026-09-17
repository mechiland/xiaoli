// Deterministic sensitive guard (SPEC §3, §8.7; ARCHITECTURE §6). Pure.
// Patterns are at least as strict as the eval harness detector (ARCHITECTURE §7.4), so a statement the harness
// would flag never leaves the pipeline.
import type { ExtractionOutput, InteractionOutput } from '@/contracts'

export type SensitiveKind = 'phone' | 'id_card' | 'bank_card' | 'address'

const joinDigits = (s: string) => s.normalize('NFKC').replace(/(?<=\d)[\s-]+(?=\d)/g, '')

const NUMBER_RULES: { kind: SensitiveKind; re: RegExp }[] = [
  { kind: 'id_card', re: /(?<!\d)\d{17}[\dXx](?!\d)/ },
  { kind: 'bank_card', re: /(?<!\d)\d{16,19}(?!\d)/ },
  { kind: 'phone', re: /(?<!\d)1[3-9]\d{9}(?!\d)/ },
  { kind: 'phone', re: /(?<!\d)0\d{2,3}\d{7,8}(?!\d)/ },
]
const MOBILE = /(?<!\d)1[3-9]\d{9}(?!\d)/
const ADDRESS = /(?<![月\d])\d{1,5}\s*(号楼|号院|号|栋|幢|单元|室|弄)(?!线)|(路|街|巷|大道)\s*\d{1,5}\s*号/
const ADDRESS_WORDS = /省|市|区|县|镇|乡|村|路|街|巷|大道|小区|花园|公寓|大厦|楼|栋|幢|单元|室|弄|院|门牌/

export function detectSensitive(text: string): SensitiveKind | null {
  const joined = joinDigits(text)
  for (const r of NUMBER_RULES) if (r.re.test(joined)) return r.kind
  if (ADDRESS.test(text.normalize('NFKC'))) return 'address'
  return null
}

/** "3号" meaning a day of the month → "3日", only when the text has no address words (so it is not mistaken for a house number). */
export function softenDayNumbers(text: string): string {
  if (ADDRESS_WORDS.test(text)) return text
  return text.replace(/(?<![月\d])(\d{1,2})\s*号(?![楼院线])/g, '$1日')
}

export function genericStatement(kind: SensitiveKind, original: string): string {
  switch (kind) {
    case 'phone':
      return MOBILE.test(joinDigits(original)) ? '提供过手机号' : '提供过联系方式'
    case 'id_card':
      return '提供过证件号码'
    case 'bank_card':
      return '提供过银行账户'
    case 'address':
      return /收货|快递|寄|邮/.test(original) ? '提供过收货地址' : '提供过详细住址'
  }
}

/**
 * A new-person label becomes `persons.label` (person page, search). Sensitive parts are cut out ("快递13812345678" →
 * "快递"); when nothing clean is left the label is null and the caller drops the person with every item about it.
 */
export function neutraliseLabel(label: string): string | null {
  if (!detectSensitive(label)) return label
  const cut = joinDigits(label.normalize('NFKC'))
    .replace(/(路|街|巷|大道)?\s*\d+\s*(号楼|号院|号|栋|幢|单元|室|弄)?/g, '')
    .replace(/[\s:：,，、()（）-]+/g, ' ')
    .trim()
  return cut && !detectSensitive(cut) && !/\d/.test(cut) ? cut : null
}

/**
 * Claims with sensitive content are rewritten to a generic statement and flagged; handles with sensitive values are
 * dropped; events with sensitive summaries are dropped and sensitive places removed; sensitive relation labels removed;
 * sensitive new-person labels are neutralised, or the person is dropped together with its items.
 *
 * The interaction layer has its own guard below: it is a separate model call with a separate output (X40).
 */
export function applySensitiveGuard(input: ExtractionOutput): { output: ExtractionOutput; rewritten: number } {
  let rewritten = 0
  const droppedTemp = new Set<string>()
  const newPersons = input.newPersons.flatMap((np) => {
    const label = neutraliseLabel(np.label)
    if (label === np.label) return [np]
    rewritten++
    if (label === null) {
      droppedTemp.add(np.tempId)
      return []
    }
    return [{ ...np, label }]
  })
  const gone = (r: { tempId: string } | { personId: number }) => 'tempId' in r && droppedTemp.has(r.tempId)
  const out: ExtractionOutput = droppedTemp.size
    ? {
        newPersons,
        handles: input.handles.filter((h) => !gone(h.person)),
        relations: input.relations.filter((r) => !gone(r.from) && !gone(r.to)),
        claims: input.claims.filter((c) => !gone(c.person)),
        events: input.events
          .map((e) => ({ ...e, participants: e.participants.filter((p) => !gone(p)) }))
          .filter((e) => e.participants.length > 0),
        dates: input.dates.filter((d) => !gone(d.person)),
      }
    : { ...input, newPersons }
  const claims = out.claims.map((c) => {
    const statement = softenDayNumbers(c.statement)
    const kind = detectSensitive(statement)
    if (!kind) return statement === c.statement ? c : { ...c, statement }
    rewritten++
    return { ...c, statement: genericStatement(kind, statement), sensitive: true }
  })
  const handles = out.handles.filter((h) => {
    const bad = detectSensitive(h.value) !== null
    if (bad) rewritten++
    return !bad
  })
  const events = out.events.flatMap((e) => {
    const summary = softenDayNumbers(e.summary)
    if (detectSensitive(summary)) {
      rewritten++
      return []
    }
    const next = { ...e, summary }
    if (next.place && detectSensitive(next.place)) {
      rewritten++
      delete next.place
    }
    return [next]
  })
  const relations = out.relations.map((r) => {
    if (r.label && detectSensitive(r.label)) {
      rewritten++
      const { label: _label, ...rest } = r
      return rest
    }
    return r
  })
  return { output: { ...out, claims, handles, events, relations }, rewritten }
}

/**
 * Interaction layer (SPEC §8.8; eval gate `sensitiveInStatement` = 0 over loop text and segment summary/topics).
 *
 * Drop, not rewrite: a claim has a useful generic form ("提供过手机号" is still a fact about a person), an unfinished
 * thing or a conversation topic does not. A loop whose `text` matches is dropped (like an event summary) and a
 * segment whose `summary` matches is dropped whole; sensitive `topics` are cut from an otherwise clean segment.
 * `softenDayNumbers` runs first, so "5号之前把合同签了" stays a date and is not read as a house number.
 * `closes` carry no free text and pass through untouched. (DECISIONS ## extract X35.)
 */
export function applyInteractionSensitiveGuard(input: InteractionOutput): { output: InteractionOutput; rewritten: number } {
  let rewritten = 0
  const loops = input.loops.flatMap((l) => {
    const text = softenDayNumbers(l.text)
    if (detectSensitive(text)) {
      rewritten++
      return []
    }
    return [text === l.text ? l : { ...l, text }]
  })
  let segment = input.segment
  if (segment) {
    const summary = softenDayNumbers(segment.summary)
    if (detectSensitive(summary)) {
      rewritten++
      segment = null
    } else {
      const topics = segment.topics.filter((t) => {
        const bad = detectSensitive(softenDayNumbers(t)) !== null
        if (bad) rewritten++
        return !bad
      })
      segment = summary === segment.summary && topics.length === segment.topics.length ? segment : { ...segment, summary, topics }
    }
  }
  return { output: { ...input, loops, segment }, rewritten }
}
