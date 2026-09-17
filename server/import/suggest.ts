// Chat recommendation and sender → person suggestions (SPEC §8.3, §9.7 step 2).
import { eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm'
import type { ChatDTO, MappingSuggestions, SettingsDTO } from '@/contracts'
import { chats, getUserSettings, handles, owned, persons, type Db } from '@/server/db'
import { chunk } from './batch'
import { chatDTOs, normName } from './dto'

export type ChatRecommendation = ChatDTO & { matchReason: string | null; score: number }

/**
 * Every chat of the owner; score = share of the non-self `senderNames` that already have a display handle in that chat.
 * "Me" is in every chat, so my own display names never count as evidence for a chat (DECISIONS import #6).
 */
export async function recommendChats(db: Db, ownerId: string, senderNames: string[]): Promise<ChatRecommendation[]> {
  const chatRows = await db.select().from(chats).where(owned(chats, ownerId))
  const dtos = await chatDTOs(db, ownerId, chatRows)
  const names = [...new Set(senderNames.map((s) => s.trim()).filter(Boolean))]
  const byNorm = new Map<string, string[]>()
  for (const n of names) byNorm.set(normName(n), [...(byNorm.get(normName(n)) ?? []), n])
  const settings = await getUserSettings(db, ownerId)
  const selfNames = new Set<string>(names.filter((n) => settings.selfDisplayNames.some((s) => normName(s) === normName(n))))

  const matched = new Map<number, Set<string>>()
  for (const part of chunk([...byNorm.keys()], 80)) {
    const rows = await db
      .select({ chatId: handles.chatId, valueNorm: handles.valueNorm, isSelf: persons.isSelf })
      .from(handles)
      .leftJoin(persons, eq(persons.id, handles.personId))
      .where(
        owned(
          handles,
          ownerId,
          inArray(handles.kind, ['display_private', 'display_group']),
          inArray(handles.valueNorm, part),
          isNotNull(handles.chatId),
          ne(handles.status, 'rejected'),
        ),
      )
    for (const r of rows) {
      const ns = byNorm.get(r.valueNorm) ?? []
      if (r.isSelf) {
        for (const n of ns) selfNames.add(n)
        continue
      }
      const set = matched.get(r.chatId!) ?? new Set<string>()
      for (const n of ns) set.add(n)
      matched.set(r.chatId!, set)
    }
  }

  const counted = names.filter((n) => !selfNames.has(n))
  return dtos
    .map((c) => {
      const m = [...(matched.get(c.id) ?? [])].filter((n) => !selfNames.has(n))
      return { ...c, score: counted.length ? m.length / counted.length : 0, matchReason: m.length ? chatReason(m, counted.length) : null }
    })
    .sort((a, b) => b.score - a.score || (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '') || b.id - a.id)
}

function chatReason(list: string[], total: number): string {
  if (list.length === total && total > 1) return '所有发送者都在这个聊天里出现过'
  if (list.length === 1) return `『${list[0]}』在这个聊天里出现过`
  return `『${list[0]}』等 ${list.length} 人在这个聊天里出现过`
}

type Candidate = { personId: number; label: string; reason: string; rank: number }

export async function suggestMapping(
  db: Db,
  ownerId: string,
  senders: { name: string; count: number }[],
  settings: SettingsDTO,
): Promise<MappingSuggestions> {
  const chatRecs = (await recommendChats(db, ownerId, senders.map((s) => s.name)))
    .filter((c) => c.score > 0)
    .map((c) => ({ ...c, matchReason: c.matchReason ?? '' }))

  const self = await db
    .select({ id: persons.id })
    .from(persons)
    .where(owned(persons, ownerId, eq(persons.isSelf, true), isNull(persons.mergedIntoId)))
    .get()
  const selfNames = new Set(settings.selfDisplayNames.map(normName))

  const byNorm = new Map<string, Candidate[]>()
  const add = (norm: string, c: Candidate) => byNorm.set(norm, [...(byNorm.get(norm) ?? []), c])
  const norms = [...new Set(senders.map((s) => normName(s.name)))]

  for (const part of chunk(norms, 80)) {
    const rows = await db
      .select({ valueNorm: handles.valueNorm, kind: handles.kind, personId: persons.id, label: persons.label, chatTitle: chats.title })
      .from(handles)
      .innerJoin(persons, eq(persons.id, handles.personId))
      .leftJoin(chats, eq(chats.id, handles.chatId))
      .where(owned(handles, ownerId, inArray(handles.valueNorm, part), isNull(persons.mergedIntoId), ne(handles.status, 'rejected')))
    for (const r of rows) {
      const isDisplay = r.kind === 'display_private' || r.kind === 'display_group'
      add(r.valueNorm, {
        personId: r.personId,
        label: r.label,
        reason: isDisplay && r.chatTitle ? `在『${r.chatTitle}』中也叫这个名字` : isDisplay ? '也叫这个名字' : '也被称为这个名字',
        rank: isDisplay ? 0 : 1,
      })
    }
  }
  const labels = [...new Set(senders.map((s) => s.name.trim()).filter(Boolean))]
  for (const part of chunk(labels, 80)) {
    const rows = await db
      .select({ id: persons.id, label: persons.label })
      .from(persons)
      .where(owned(persons, ownerId, inArray(persons.label, part), isNull(persons.mergedIntoId)))
    for (const r of rows) add(normName(r.label), { personId: r.id, label: r.label, reason: '人物名就是这个名字', rank: 2 })
  }

  return {
    chats: chatRecs,
    senders: senders.map((s) => {
      const seen = new Set<number>()
      const cands = (byNorm.get(normName(s.name)) ?? [])
        .sort((a, b) => a.rank - b.rank)
        .filter((c) => (seen.has(c.personId) ? false : (seen.add(c.personId), true)))
      const others = cands.filter((c) => c.personId !== self?.id).map(({ personId, label, reason }) => ({ personId, label, reason }))
      const isSelf = selfNames.has(normName(s.name)) || (cands.length > 0 && cands[0].personId === self?.id)
      return {
        senderName: s.name,
        count: s.count,
        suggested: isSelf ? { self: true as const } : (others[0] ?? null),
        candidates: others,
      }
    }),
    preselectKind: senders.length === 2 ? 'private' : senders.length > 2 ? 'group' : null,
  }
}
