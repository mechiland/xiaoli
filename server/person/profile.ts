// GET /api/people/:id aggregate (ARCHITECTURE §1.7, §2.4 ProfileResponse). The infobox is derived, never stored.
// Performance (P2 ≤ 300 ms): everything is read in ONE D1 round trip (db.batch of selects); item ids are expressed
// as subqueries, so there is no second wave and no bound-parameter chunking.
import { and, count, eq, inArray, max, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type {
  Category,
  ClaimDTO,
  EventDTO,
  HandleDTO,
  HandleKind,
  ImportantDateDTO,
  PersonDTO,
  PersonRefDTO,
  ProfileRedirectResponse,
  ProfileResponse,
  RelationDTO,
} from '@/contracts'
import { nextOccurrence } from '@/lib/lunar'
import { todayInTz } from '@/lib/time'
import {
  chats,
  claimMentions,
  claims,
  eventParticipants,
  events,
  evidence,
  handles,
  importantDates,
  messages,
  owned,
  persons,
  relations,
  type Db,
} from '@/server/db'
import { errors } from '@/server/errors'

export type ProfileResult = ProfileResponse | ProfileRedirectResponse

type PersonRow = typeof persons.$inferSelect
type ClaimRow = typeof claims.$inferSelect
type RelationRow = typeof relations.$inferSelect
type DateRow = typeof importantDates.$inferSelect

/** Body section order (SPEC §9.5). */
export const CATEGORY_ORDER: Category[] = ['work', 'location', 'education', 'family', 'preference', 'life_event', 'other']
/** Alias group order (SPEC §9.5: 私聊备注名 / 群内显示名 / 真名 / 称呼); `mentioned` sits with group names in the UI. */
export const HANDLE_KIND_ORDER: HandleKind[] = ['display_private', 'display_group', 'mentioned', 'real_name', 'address_term']

const LIVE = ['confirmed', 'proposed'] as const

function personDTO(p: PersonRow): PersonDTO {
  return {
    id: p.id,
    label: p.label,
    isSelf: p.isSelf,
    mergedIntoId: p.mergedIntoId,
    pinned: p.pinned,
    avatarUrl: null,
    lastMessageAt: p.lastMessageAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
}

/** Follows merged_into_id to the surviving person (bounded; merge never creates cycles, but never loop). */
async function resolveMerged(db: Db, ownerId: string, row: PersonRow): Promise<number> {
  let cur = row
  for (let i = 0; i < 8 && cur.mergedIntoId != null; i++) {
    const next = await db.select().from(persons).where(owned(persons, ownerId, eq(persons.id, cur.mergedIntoId))).get()
    if (!next) break
    cur = next
  }
  return cur.id
}

function claimDTO(r: ClaimRow, mentions: Map<number, PersonRefDTO[]>, counts: Map<string, number>): ClaimDTO {
  return {
    id: r.id,
    personId: r.personId,
    statement: r.statement,
    category: r.category,
    validFrom: r.validFrom,
    validTo: r.validTo,
    learnedAt: r.learnedAt,
    confidence: r.confidence,
    sensitive: r.sensitive,
    status: r.status,
    supersedesClaimId: r.supersedesClaimId,
    supersededByClaimId: r.supersededByClaimId,
    importId: r.importId,
    sourceKind: r.sourceKind,
    mentions: mentions.get(r.id) ?? [],
    evidenceCount: counts.get(`claim:${r.id}`) ?? 0,
    createdAt: r.createdAt,
    statusChangedAt: r.statusChangedAt,
    statusReason: r.statusReason,
  }
}

function dateDTO(r: DateRow, counts: Map<string, number>, today: string): ImportantDateDTO {
  let next: ImportantDateDTO['next'] = null
  if (r.month != null && r.day != null) {
    try {
      const n = nextOccurrence({ calendar: r.calendar, month: r.month, day: r.day, isLeapMonth: r.isLeapMonth }, today)
      next = { solar: n.solar, lunarLabel: n.lunarLabel ?? null, days: n.days }
    } catch {
      next = null
    }
  }
  return {
    id: r.id,
    personId: r.personId,
    kind: r.kind,
    day: r.day,
    month: r.month,
    year: r.year,
    calendar: r.calendar,
    isLeapMonth: r.isLeapMonth,
    label: r.label,
    status: r.status,
    importId: r.importId,
    sourceKind: r.sourceKind,
    next,
    evidenceCount: counts.get(`date:${r.id}`) ?? 0,
    createdAt: r.createdAt,
  }
}

/** Newest first: validFrom desc (null last), then learnedAt desc, then id desc. */
function byRecency(a: ClaimRow, b: ClaimRow): number {
  const av = a.validFrom ?? ''
  const bv = b.validFrom ?? ''
  if (av !== bv) return av < bv ? 1 : -1
  if (a.learnedAt !== b.learnedAt) return a.learnedAt < b.learnedAt ? 1 : -1
  return b.id - a.id
}

const RELATION_ZH: Record<string, string> = {
  parent: '父母',
  child: '子女',
  spouse: '配偶',
  sibling: '兄弟姐妹',
  relative: '亲戚',
  friend: '朋友',
  colleague: '同事',
  classmate: '同学',
  service_provider: '服务方',
  client: '客户',
  other: '其他',
}
/** How `to` sees `from` flipped: the type of `to` relative to `from`. */
const INVERSE_TYPE: Record<string, string> = { parent: 'child', child: 'parent', service_provider: 'client', client: 'service_provider' }

/**
 * "与我的关系" (DECISIONS A6, person P3): confirmed relation between the person and self, newest first.
 * A relation reads `from` 是 `to` 的 `type`/`label`. Person = from, self = to → the label as written ("妈妈").
 * Self = from, person = to → the person is self's inverse type (label names self, so it is not reused).
 */
export function relationToMeValue(r: Pick<RelationRow, 'fromPersonId' | 'toPersonId' | 'type' | 'label'>, personId: number): string {
  if (r.fromPersonId === personId) return r.label?.trim() || RELATION_ZH[r.type] || r.type
  const inv = INVERSE_TYPE[r.type]
  if (inv) return RELATION_ZH[inv]
  return r.label?.trim() || RELATION_ZH[r.type] || r.type
}

/** The profile plus the owner's self person id (the page needs both; one round trip). */
export async function loadPersonPage(db: Db, ownerId: string, personId: number): Promise<{ profile: ProfileResult; selfId: number | null }> {
  const pMention = alias(persons, 'mention_person')
  const pPart = alias(persons, 'part_person')
  const hSender = alias(handles, 'sender_handle')
  const hSender2 = alias(handles, 'sender_handle2')
  const mSent = alias(messages, 'sent_msg')

  // id subqueries (owner-scoped)
  const claimIdsQ = db.select({ id: claims.id }).from(claims).where(owned(claims, ownerId, eq(claims.personId, personId)))
  const handleIdsQ = db.select({ id: handles.id }).from(handles).where(owned(handles, ownerId, eq(handles.personId, personId)))
  const dateIdsQ = db.select({ id: importantDates.id }).from(importantDates).where(owned(importantDates, ownerId, eq(importantDates.personId, personId)))
  const relationIdsQ = db
    .select({ id: relations.id })
    .from(relations)
    .where(owned(relations, ownerId, or(eq(relations.fromPersonId, personId), eq(relations.toPersonId, personId))))
  const relationFromIdsQ = db
    .select({ id: relations.fromPersonId })
    .from(relations)
    .where(owned(relations, ownerId, or(eq(relations.fromPersonId, personId), eq(relations.toPersonId, personId))))
  const relationToIdsQ = db
    .select({ id: relations.toPersonId })
    .from(relations)
    .where(owned(relations, ownerId, or(eq(relations.fromPersonId, personId), eq(relations.toPersonId, personId))))
  const eventIdsQ = db.select({ id: eventParticipants.eventId }).from(eventParticipants).where(owned(eventParticipants, ownerId, eq(eventParticipants.personId, personId)))
  const sentChatIdsQ = db
    .select({ id: mSent.chatId })
    .from(mSent)
    .innerJoin(hSender2, eq(hSender2.id, mSent.senderHandleId))
    .where(owned(mSent as unknown as typeof messages, ownerId, eq(hSender2.personId, personId)))

  // NOTE: D1 batch rows are objects keyed by column name, so a statement must never select two columns with the same
  // name (e.g. relations.label next to persons.label) — related labels come from their own statements.
  const [personRows, handleRows, claimRows, dateRows, relationRows, relationPeople, eventRows, senderChats, privateTotals, evidenceRows, mentionRows, participantRows] =
    await db.batch([
      db.select().from(persons).where(owned(persons, ownerId, or(eq(persons.id, personId), eq(persons.isSelf, true)))),
      db
        .select({ h: handles, chatTitle: chats.title })
        .from(handles)
        .leftJoin(chats, eq(chats.id, handles.chatId))
        .where(owned(handles, ownerId, eq(handles.personId, personId), inArray(handles.status, [...LIVE]))),
      db.select().from(claims).where(owned(claims, ownerId, eq(claims.personId, personId), inArray(claims.status, ['confirmed', 'proposed', 'superseded']))),
      db.select().from(importantDates).where(owned(importantDates, ownerId, eq(importantDates.personId, personId), inArray(importantDates.status, [...LIVE]))),
      db
        .select()
        .from(relations)
        .where(owned(relations, ownerId, or(eq(relations.fromPersonId, personId), eq(relations.toPersonId, personId)), inArray(relations.status, [...LIVE]))),
      db
        .select({ id: persons.id, label: persons.label })
        .from(persons)
        .where(owned(persons, ownerId, or(inArray(persons.id, relationFromIdsQ), inArray(persons.id, relationToIdsQ)))),
      db
        .select({ e: events })
        .from(eventParticipants)
        .innerJoin(events, eq(events.id, eventParticipants.eventId))
        .where(owned(eventParticipants, ownerId, eq(eventParticipants.personId, personId), inArray(events.status, [...LIVE]))),
      // messages this person sent, per chat
      db
        .select({ chatId: messages.chatId, title: chats.title, kind: chats.kind, n: count(), last: max(messages.sentAt) })
        .from(messages)
        .innerJoin(hSender, eq(hSender.id, messages.senderHandleId))
        .innerJoin(chats, eq(chats.id, messages.chatId))
        .where(owned(messages, ownerId, eq(hSender.personId, personId)))
        .groupBy(messages.chatId, chats.title, chats.kind),
      // private chats the person writes in: every message of the chat
      db
        .select({ chatId: messages.chatId, n: count(), last: max(messages.sentAt) })
        .from(messages)
        .innerJoin(chats, eq(chats.id, messages.chatId))
        .where(owned(messages, ownerId, eq(chats.kind, 'private'), inArray(messages.chatId, sentChatIdsQ)))
        .groupBy(messages.chatId),
      // evidence counts for every item of the person, all types in one statement
      db
        .select({ type: evidence.targetType, id: evidence.targetId, n: count() })
        .from(evidence)
        .where(
          owned(
            evidence,
            ownerId,
            or(
              and(eq(evidence.targetType, 'claim'), inArray(evidence.targetId, claimIdsQ)),
              and(eq(evidence.targetType, 'handle'), inArray(evidence.targetId, handleIdsQ)),
              and(eq(evidence.targetType, 'date'), inArray(evidence.targetId, dateIdsQ)),
              and(eq(evidence.targetType, 'relation'), inArray(evidence.targetId, relationIdsQ)),
              and(eq(evidence.targetType, 'event'), inArray(evidence.targetId, eventIdsQ)),
            ),
          ),
        )
        .groupBy(evidence.targetType, evidence.targetId),
      db
        .select({ claimId: claimMentions.claimId, id: pMention.id, label: pMention.label })
        .from(claimMentions)
        .innerJoin(pMention, eq(pMention.id, claimMentions.personId))
        .where(owned(claimMentions, ownerId, inArray(claimMentions.claimId, claimIdsQ))),
      db
        .select({ eventId: eventParticipants.eventId, id: pPart.id, label: pPart.label })
        .from(eventParticipants)
        .innerJoin(pPart, eq(pPart.id, eventParticipants.personId))
        .where(owned(eventParticipants, ownerId, inArray(eventParticipants.eventId, eventIdsQ))),
    ])

  const person = personRows.find((p) => p.id === personId)
  if (!person) throw errors.notFound('没有找到这个人物')
  const selfId = personRows.find((p) => p.isSelf)?.id ?? null
  if (person.mergedIntoId != null) return { profile: { redirectTo: await resolveMerged(db, ownerId, person) }, selfId }

  const today = todayInTz()
  const counts = new Map<string, number>()
  for (const r of evidenceRows) counts.set(`${r.type}:${r.id}`, r.n)
  const mentions = new Map<number, PersonRefDTO[]>()
  for (const m of mentionRows) mentions.set(m.claimId, [...(mentions.get(m.claimId) ?? []), { id: m.id, label: m.label }])
  const participants = new Map<number, PersonRefDTO[]>()
  for (const p of participantRows) participants.set(p.eventId, [...(participants.get(p.eventId) ?? []), { id: p.id, label: p.label }])

  // chats (P2): private chat → every message of the chat; group chat → this person's own messages
  const privateTotal = new Map(privateTotals.map((r) => [r.chatId, r]))
  const chatInfo = senderChats
    .map((c) => {
      const basis = c.kind === 'private' ? (privateTotal.get(c.chatId) ?? c) : c
      return { chat: { id: c.chatId, title: c.title, kind: c.kind }, messageCount: basis.n, lastMessageAt: basis.last ?? null }
    })
    .filter((c) => c.messageCount > 0)
    .sort((a, b) => ((a.lastMessageAt ?? '') < (b.lastMessageAt ?? '') ? 1 : (a.lastMessageAt ?? '') > (b.lastMessageAt ?? '') ? -1 : a.chat.id - b.chat.id))
  const lastContactAt = chatInfo.reduce<string | null>((acc, c) => (c.lastMessageAt && (!acc || c.lastMessageAt > acc) ? c.lastMessageAt : acc), null)

  // handles grouped by kind
  const handleDTOs: HandleDTO[] = handleRows
    .slice()
    .sort((a, b) => a.h.id - b.h.id)
    .map(({ h, chatTitle }) => ({
      id: h.id,
      personId: h.personId,
      kind: h.kind,
      value: h.value,
      chatId: h.chatId,
      chatTitle: h.chatId == null ? null : (chatTitle ?? null),
      status: h.status,
      importId: h.importId,
      sourceKind: h.sourceKind,
      evidenceCount: counts.get(`handle:${h.id}`) ?? 0,
      createdAt: h.createdAt,
    }))
  const aliases = HANDLE_KIND_ORDER.map((kind) => ({ kind, items: handleDTOs.filter((h) => h.kind === kind) })).filter((g) => g.items.length > 0)

  // claims
  const live = claimRows.filter((c) => c.status === 'confirmed' || c.status === 'proposed').sort(byRecency)
  const sections = CATEGORY_ORDER.map((category) => ({
    category,
    claims: live.filter((c) => c.category === category).map((c) => claimDTO(c, mentions, counts)),
  })).filter((s) => s.claims.length > 0)
  const history = claimRows
    .filter((c) => c.status === 'superseded')
    .sort((a, b) => (a.statusChangedAt < b.statusChangedAt ? 1 : a.statusChangedAt > b.statusChangedAt ? -1 : b.id - a.id))
    .map((c) => claimDTO(c, mentions, counts))
  const latestConfirmed = (category: Category) => {
    const c = live.find((x) => x.category === category && x.status === 'confirmed' && x.validTo == null)
    return c ? { value: c.statement, claimId: c.id } : null
  }

  // dates: confirmed birthday first; a lone proposed birthday still shows (styled as proposed)
  const dates = dateRows
    .slice()
    .sort((a, b) => (a.status === b.status ? a.id - b.id : a.status === 'confirmed' ? -1 : 1))
    .map((d) => dateDTO(d, counts, today))
  const birthday = dates.find((d) => d.kind === 'birthday' && d.status === 'confirmed') ?? dates.find((d) => d.kind === 'birthday') ?? null
  const otherDates = dates.filter((d) => d.id !== birthday?.id).sort((a, b) => (a.next?.days ?? 9999) - (b.next?.days ?? 9999) || a.id - b.id)

  // relations
  const labelOf = new Map(relationPeople.map((x) => [x.id, x.label]))
  const relationDTOs: RelationDTO[] = relationRows
    .slice()
    .sort((a, b) => (a.status === b.status ? a.id - b.id : a.status === 'confirmed' ? -1 : 1))
    .map((r) => ({
      id: r.id,
      fromPersonId: r.fromPersonId,
      toPersonId: r.toPersonId,
      from: { id: r.fromPersonId, label: labelOf.get(r.fromPersonId) ?? '' },
      to: { id: r.toPersonId, label: labelOf.get(r.toPersonId) ?? '' },
      type: r.type,
      label: r.label,
      status: r.status,
      importId: r.importId,
      sourceKind: r.sourceKind,
      evidenceCount: counts.get(`relation:${r.id}`) ?? 0,
      createdAt: r.createdAt,
    }))
  let relationToMe: ProfileResponse['infobox']['relationToMe'] = null
  if (selfId != null && selfId !== personId) {
    const r = relationRows
      .filter((x) => x.status === 'confirmed' && ((x.fromPersonId === personId && x.toPersonId === selfId) || (x.toPersonId === personId && x.fromPersonId === selfId)))
      .sort((a, b) => b.id - a.id)[0]
    if (r) relationToMe = { value: relationToMeValue(r, personId), relationId: r.id }
  }

  // events, reverse chronological (undated last)
  const seenEvents = new Set<number>()
  const eventDTOs: EventDTO[] = eventRows
    .map((x) => x.e)
    .filter((e) => (seenEvents.has(e.id) ? false : (seenEvents.add(e.id), true)))
    .sort((a, b) => {
      const ah = a.happenedAt ?? ''
      const bh = b.happenedAt ?? ''
      if (ah !== bh) return ah < bh ? 1 : -1
      return b.id - a.id
    })
    .map((e) => ({
      id: e.id,
      summary: e.summary,
      happenedAt: e.happenedAt,
      place: e.place,
      status: e.status,
      importId: e.importId,
      sourceKind: e.sourceKind,
      participants: participants.get(e.id) ?? [],
      evidenceCount: counts.get(`event:${e.id}`) ?? 0,
      createdAt: e.createdAt,
    }))

  return {
    selfId,
    profile: {
      person: personDTO(person),
      aliases,
      infobox: {
        relationToMe,
        city: latestConfirmed('location'),
        work: latestConfirmed('work'),
        school: latestConfirmed('education'),
        birthday,
        otherDates,
        chats: chatInfo,
        lastContactAt,
      },
      sections,
      relations: relationDTOs,
      events: eventDTOs,
      history,
    },
  }
}

export async function getProfile(db: Db, ownerId: string, personId: number): Promise<ProfileResult> {
  return (await loadPersonPage(db, ownerId, personId)).profile
}
