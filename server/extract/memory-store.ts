// In-memory ExtractStore for the eval harness (ARCHITECTURE §6 offline entry). Mirrors d1Store semantics:
// message ids = idx + 1, seq = idx; proposed claims of this run are dedup candidates; handles unique per (kind, value);
// relations unique per (from, to, type) incl. the inverse; dates per (person, kind, calendar, month, day).
import type { ChatKind, LoopCloseReason, LoopDirection, LoopKind, ParsedExport, Status } from '@/contracts'
import type { ExtractStore, KnownPerson, LoadedWindow, OpenLoopInput, ResolvedItems, WindowRef } from './types'
import { normName } from './validate'

export interface OfflineMapping {
  chat: { title: string; kind: ChatKind }
  senders: { senderName: string; person: string }[]
  self: string
}

export interface OfflineItems {
  persons: { key: string; label: string; isSelf: boolean }[]
  handles: { person: string; kind: string; value: string; evidence: number[]; windowIndex: number }[]
  relations: { from: string; to: string; type: string; label?: string; evidence: number[]; windowIndex: number }[]
  claims: { person: string; statement: string; category: import('@/contracts').Category; validFrom?: string; confidence: number; sensitive: boolean; supersedes?: number; evidence: number[]; windowIndex: number }[]
  events: { summary: string; happenedAt?: string; place?: string; participants: string[]; evidence: number[]; windowIndex: number }[]
  dates: { person: string; kind: string; day?: number; month?: number; year?: number; calendar: 'solar' | 'lunar'; isLeapMonth?: boolean; evidence: number[]; windowIndex: number }[]
  /** interaction layer (SPEC §8.8); message refs are parsed-export idx, like every other type */
  segments: { startIdx: number; endIdx: number; startedAt: string; endedAt: string; messageCount: number; summary: string; topics: string[]; participants: { person: string; messageCount: number }[]; evidence: number[]; windowIndex: number }[]
  loops: {
    person: string
    direction: LoopDirection
    kind: LoopKind
    text: string
    dueAt?: string
    openedAt: string
    openedIdx: number
    closedIdx: number | null
    closedAt: string | null
    closedReason: LoopCloseReason | null
    evidence: number[]
    windowIndex: number
  }[]
  /** `loopIndex` points into `loops`, the way a claim's `supersedes` points into `claims` */
  closes: { loopIndex: number; reason: LoopCloseReason; evidence: number[]; windowIndex: number }[]
}

/** Cap mirroring d1Store.KNOWN_OPEN_LOOPS_PER_PERSON, so offline and in-app show the model the same shape. */
const OPEN_LOOPS_PER_PERSON = 12

const INVERSE: Record<string, string> = { parent: 'child', child: 'parent', service_provider: 'client', client: 'service_provider' }
const SYMMETRIC = new Set(['spouse', 'sibling', 'friend', 'colleague', 'classmate', 'relative'])

export function inverseRelation(type: string): string | null {
  if (SYMMETRIC.has(type)) return type
  return INVERSE[type] ?? null
}

export function memoryStore(parsed: ParsedExport, mapping: OfflineMapping): ExtractStore & { result(): OfflineItems } {
  const counts = new Map<string, number>()
  for (const m of parsed.messages) counts.set(m.senderName, (counts.get(m.senderName) ?? 0) + 1)

  interface P {
    id: number
    key: string
    label: string
    isSelf: boolean
    handles: { kind: KnownPerson['handles'][number]['kind']; value: string }[]
    isNew: boolean
  }
  const persons: P[] = []
  const byKey = new Map<string, P>()
  const displayKind = mapping.chat.kind === 'group' ? 'display_group' : 'display_private'
  const personKeys = [...new Set([...mapping.senders.map((s) => s.person), mapping.self])]
  for (const key of personKeys) {
    const names = mapping.senders
      .filter((s) => s.person === key)
      .map((s) => s.senderName)
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
    if (!names.length) continue
    const p: P = { id: persons.length + 1, key, label: names[0], isSelf: key === mapping.self, handles: names.map((value) => ({ kind: displayKind, value })), isNew: false }
    persons.push(p)
    byKey.set(key, p)
  }
  const senderPerson = new Map(mapping.senders.map((s) => [s.senderName, byKey.get(s.person)?.id ?? null]))
  const selfId = byKey.get(mapping.self)?.id ?? 0
  const personById = (id: number) => persons[id - 1]

  interface Claim {
    id: number
    personId: number
    statement: string
    category: OfflineItems['claims'][number]['category']
    validFrom?: string
    confidence: number
    sensitive: boolean
    supersedesClaimId?: number
    messageIds: Set<number>
    windowIndex: number
    status: Status
  }
  const claims: Claim[] = []
  const handles = new Map<string, { personId: number; kind: string; value: string; messageIds: Set<number>; windowIndex: number }>()
  const relations: { fromPersonId: number; toPersonId: number; type: string; label?: string; messageIds: Set<number>; windowIndex: number }[] = []
  const dates = new Map<string, OfflineItems['dates'][number] & { personId: number; messageIds: Set<number> }>()
  const events = new Map<string, { summary: string; happenedAt?: string; place?: string; participantIds: number[]; messageIds: Set<number>; windowIndex: number }>()

  // Interaction layer (SPEC §8.8). Segments are keyed by their span so re-extracting one overwrites, as in D1.
  interface Segment {
    startSeq: number
    endSeq: number
    startedAt: string
    endedAt: string
    messageCount: number
    summary: string
    topics: string[]
    participants: { personId: number; messageCount: number }[]
    messageIds: Set<number>
    windowIndex: number
  }
  const segments = new Map<string, Segment>()
  interface Loop {
    id: number
    personId: number
    direction: LoopDirection
    kind: LoopKind
    text: string
    dueAt?: string
    openedMessageId: number
    openedAt: string
    closedMessageId: number | null
    closedAt: string | null
    closedReason: LoopCloseReason | null
    status: Status
    messageIds: Set<number>
    windowIndex: number
  }
  const loops: Loop[] = []
  const closeLog: { loopId: number; reason: LoopCloseReason; messageIds: Set<number>; windowIndex: number }[] = []

  // Window range (message ids) per window index. Evidence merged into an item from a later window is kept only when it
  // lies inside the item's own window, because the harness checks every item's evidence against its windowIndex.
  const windowRange = new Map<number, [number, number]>()
  const inRange = (windowIndex: number, id: number) => {
    const r = windowRange.get(windowIndex)
    return !r || (id >= r[0] && id <= r[1])
  }
  const addAll = (set: Set<number>, ids: number[], windowIndex: number) => {
    let added = 0
    for (const id of ids) if (!set.has(id) && inRange(windowIndex, id)) (set.add(id), added++)
    return added
  }
  const itemsOf = (personId: number) => [
    ...claims.filter((c) => c.personId === personId).map((c) => c.messageIds),
    ...[...handles.values()].filter((h) => h.personId === personId).map((h) => h.messageIds),
    ...relations.filter((r) => r.fromPersonId === personId || r.toPersonId === personId).map((r) => r.messageIds),
    ...[...dates.values()].filter((d) => d.personId === personId).map((d) => d.messageIds),
  ]

  return {
    async loadWindow(ref: WindowRef): Promise<LoadedWindow> {
      const msgs = parsed.messages.filter((m) => m.idx >= ref.startSeq && m.idx <= ref.endSeq).sort((a, b) => a.idx - b.idx)
      windowRange.set(ref.windowIndex, [ref.startSeq + 1, ref.endSeq + 1])
      const seqMap = new Map<number, number>()
      const messages = msgs.map((m, i) => {
        seqMap.set(i + 1, m.idx + 1)
        return { localSeq: i + 1, sentAt: m.sentAt, senderName: m.senderName, senderPersonId: senderPerson.get(m.senderName) ?? null, kind: m.kind, body: m.body }
      })
      // Interaction input side, from what this run has produced so far, so offline sees exactly the in-app shape.
      const firstSentAt = messages[0]?.sentAt ?? ''
      const lastContactOf = (personId: number): KnownPerson['lastContact'] => {
        const before = [...segments.values()].filter((sg) => sg.startedAt < firstSentAt && sg.participants.some((x) => x.personId === personId))
        const latest = before.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0]
        return latest ? { at: latest.startedAt, summary: latest.summary } : null
      }
      const openLoopsOf = (personId: number): OpenLoopInput[] =>
        loops
          .filter((l) => l.personId === personId && l.closedMessageId === null && l.status !== 'rejected')
          .sort((a, b) => (a.openedAt === b.openedAt ? b.id - a.id : a.openedAt < b.openedAt ? 1 : -1))
          .slice(0, OPEN_LOOPS_PER_PERSON)
          .map((l) => ({ id: l.id, kind: l.kind, direction: l.direction, text: l.text, openedAt: l.openedAt }))
      const known: KnownPerson[] = persons.map((p) => ({ personId: p.id, label: p.label, handles: p.handles, claims: [], lastContact: lastContactOf(p.id), openLoops: openLoopsOf(p.id) }))
      return {
        chat: mapping.chat,
        selfPersonId: selfId,
        messages,
        known,
        seqMap,
        chatId: 1,
        span: { startSeq: msgs[0]?.idx ?? ref.startSeq, endSeq: msgs[msgs.length - 1]?.idx ?? ref.endSeq, startedAt: msgs[0]?.sentAt ?? '', endedAt: msgs[msgs.length - 1]?.sentAt ?? '' },
      }
    },

    async proposeItems(_importId: number, items: ResolvedItems, ctx: { jobId: number | null; windowIndex: number }) {
      let created = 0
      let mergedEvidence = 0
      for (const c of items.claims) {
        const existing = c.duplicateOf !== undefined ? claims.find((x) => x.id === c.duplicateOf) : undefined
        if (existing) {
          mergedEvidence += addAll(existing.messageIds, c.messageIds, existing.windowIndex)
          continue
        }
        claims.push({ id: claims.length + 1, personId: c.personId, statement: c.statement, category: c.category, validFrom: c.validFrom, confidence: c.confidence, sensitive: c.sensitive, supersedesClaimId: c.supersedesClaimId, messageIds: new Set(c.messageIds), windowIndex: ctx.windowIndex, status: 'proposed' })
        created++
      }
      for (const h of items.handles) {
        const key = `${h.kind}|${h.value}`
        const existing = handles.get(key)
        if (existing) {
          if (existing.personId === h.personId) mergedEvidence += addAll(existing.messageIds, h.messageIds, existing.windowIndex)
          continue
        }
        handles.set(key, { personId: h.personId, kind: h.kind, value: h.value, messageIds: new Set(h.messageIds), windowIndex: ctx.windowIndex })
        created++
      }
      for (const r of items.relations) {
        const inv = inverseRelation(r.type)
        const existing = relations.find(
          (x) => (x.fromPersonId === r.fromPersonId && x.toPersonId === r.toPersonId && x.type === r.type) || (inv !== null && x.fromPersonId === r.toPersonId && x.toPersonId === r.fromPersonId && x.type === inv),
        )
        if (existing) {
          mergedEvidence += addAll(existing.messageIds, r.messageIds, existing.windowIndex)
          continue
        }
        relations.push({ ...r, messageIds: new Set(r.messageIds), windowIndex: ctx.windowIndex })
        created++
      }
      for (const d of items.dates) {
        const key = `${d.personId}|${d.kind}|${d.calendar}|${d.month ?? 0}|${d.day ?? 0}`
        const existing = dates.get(key)
        if (existing) {
          mergedEvidence += addAll(existing.messageIds, d.messageIds, existing.windowIndex)
          continue
        }
        dates.set(key, { ...d, person: '', evidence: [], windowIndex: ctx.windowIndex, messageIds: new Set(d.messageIds) })
        created++
      }
      for (const e of items.events) {
        const key = normName(e.summary)
        const existing = events.get(key)
        if (existing) {
          mergedEvidence += addAll(existing.messageIds, e.messageIds, existing.windowIndex)
          continue
        }
        events.set(key, { ...e, messageIds: new Set(e.messageIds), windowIndex: ctx.windowIndex })
        created++
      }
      const seg = items.segment
      if (seg && seg.messageIds.length) {
        const key = `${seg.startSeq}|${seg.endSeq}`
        const before = segments.get(key)
        segments.set(key, {
          startSeq: seg.startSeq,
          endSeq: seg.endSeq,
          startedAt: seg.startedAt,
          endedAt: seg.endedAt,
          messageCount: seg.messageCount,
          summary: seg.summary,
          topics: seg.topics,
          participants: seg.participants,
          messageIds: new Set(seg.messageIds),
          windowIndex: ctx.windowIndex,
        })
        if (!before) created++
      }
      for (const l of items.loops) {
        if (!l.messageIds.length) continue
        const existing =
          l.duplicateOf !== undefined
            ? loops.find((x) => x.id === l.duplicateOf)
            : loops.find((x) => x.personId === l.personId && normName(x.text) === normName(l.text) && x.closedMessageId === null && x.status !== 'rejected')
        if (existing) {
          mergedEvidence += addAll(existing.messageIds, l.messageIds, existing.windowIndex)
          continue
        }
        loops.push({
          id: loops.length + 1,
          personId: l.personId,
          direction: l.direction,
          kind: l.kind,
          text: l.text,
          ...(l.dueAt ? { dueAt: l.dueAt } : {}),
          openedMessageId: l.openedMessageId,
          openedAt: l.openedAt,
          closedMessageId: null,
          closedAt: null,
          closedReason: null,
          status: 'proposed',
          messageIds: new Set(l.messageIds),
          windowIndex: ctx.windowIndex,
        })
        created++
      }
      for (const c of items.closes) {
        const target = loops.find((x) => x.id === c.loopId && x.closedMessageId === null)
        if (!target) continue
        target.closedMessageId = c.closedMessageId
        target.closedAt = c.closedAt
        target.closedReason = c.reason
        closeLog.push({ loopId: c.loopId, reason: c.reason, messageIds: new Set([c.closedMessageId]), windowIndex: ctx.windowIndex })
      }
      return { created, mergedEvidence }
    },

    async findSimilarClaims(personId: number) {
      return claims.filter((c) => c.personId === personId && (c.status === 'proposed' || c.status === 'confirmed')).map((c) => ({ id: c.id, statement: c.statement, status: c.status }))
    },

    async findSimilarLoops(personId: number) {
      return loops.filter((l) => l.personId === personId && l.closedMessageId === null && l.status !== 'rejected').map((l) => ({ id: l.id, text: l.text }))
    },

    async resolveTempPerson(_importId: number, label: string, evidenceMessageIds: number[]) {
      const n = normName(label)
      const created = persons.filter((p) => p.isNew)
      const exact = created.find((p) => normName(p.label) === n)
      if (exact) return exact.id
      if (n.length < 2) return null
      const ev = new Set(evidenceMessageIds)
      for (const p of created) {
        const pl = normName(p.label)
        if (pl.length < 2 || !(pl.includes(n) || n.includes(pl))) continue
        if (itemsOf(p.id).some((s) => [...s].some((id) => ev.has(id)))) return p.id
      }
      return null
    },

    async createPerson(_importId: number, label: string) {
      const p: P = { id: persons.length + 1, key: `new:${label}`, label, isSelf: false, handles: [], isNew: true }
      persons.push(p)
      return p.id
    },

    result(): OfflineItems {
      const key = (id: number) => personById(id)?.key ?? 'unknown'
      const idx = (s: Set<number>) => [...s].map((id) => id - 1).sort((a, b) => a - b)
      const claimIndex = new Map(claims.map((c, i) => [c.id, i]))
      return {
        persons: persons.map((p) => ({ key: p.key, label: p.label, isSelf: p.isSelf })),
        handles: [...handles.values()].map((h) => ({ person: key(h.personId), kind: h.kind, value: h.value, evidence: idx(h.messageIds), windowIndex: h.windowIndex })),
        relations: relations.map((r) => ({ from: key(r.fromPersonId), to: key(r.toPersonId), type: r.type, ...(r.label ? { label: r.label } : {}), evidence: idx(r.messageIds), windowIndex: r.windowIndex })),
        claims: claims.map((c) => ({
          person: key(c.personId),
          statement: c.statement,
          category: c.category,
          ...(c.validFrom ? { validFrom: c.validFrom } : {}),
          confidence: c.confidence,
          sensitive: c.sensitive,
          ...(c.supersedesClaimId !== undefined && claimIndex.has(c.supersedesClaimId) ? { supersedes: claimIndex.get(c.supersedesClaimId) } : {}),
          evidence: idx(c.messageIds),
          windowIndex: c.windowIndex,
        })),
        events: [...events.values()].map((e) => ({ summary: e.summary, ...(e.happenedAt ? { happenedAt: e.happenedAt } : {}), ...(e.place ? { place: e.place } : {}), participants: e.participantIds.map(key), evidence: idx(e.messageIds), windowIndex: e.windowIndex })),
        dates: [...dates.values()].map((d) => ({ person: key(d.personId), kind: d.kind, ...(d.day ? { day: d.day } : {}), ...(d.month ? { month: d.month } : {}), ...(d.year ? { year: d.year } : {}), calendar: d.calendar, ...(d.isLeapMonth ? { isLeapMonth: true } : {}), evidence: idx(d.messageIds), windowIndex: d.windowIndex })),
        segments: [...segments.values()].map((sg) => ({
          startIdx: sg.startSeq,
          endIdx: sg.endSeq,
          startedAt: sg.startedAt,
          endedAt: sg.endedAt,
          messageCount: sg.messageCount,
          summary: sg.summary,
          topics: sg.topics,
          participants: sg.participants.map((x) => ({ person: key(x.personId), messageCount: x.messageCount })),
          evidence: idx(sg.messageIds),
          windowIndex: sg.windowIndex,
        })),
        loops: loops.map((l) => ({
          person: key(l.personId),
          direction: l.direction,
          kind: l.kind,
          text: l.text,
          ...(l.dueAt ? { dueAt: l.dueAt } : {}),
          openedAt: l.openedAt,
          openedIdx: l.openedMessageId - 1,
          closedIdx: l.closedMessageId === null ? null : l.closedMessageId - 1,
          closedAt: l.closedAt,
          closedReason: l.closedReason,
          evidence: idx(l.messageIds),
          windowIndex: l.windowIndex,
        })),
        closes: closeLog.flatMap((c) => {
          const at = loops.findIndex((l) => l.id === c.loopId)
          return at < 0 ? [] : [{ loopIndex: at, reason: c.reason, evidence: idx(c.messageIds), windowIndex: c.windowIndex }]
        }),
      }
    },
  }
}
