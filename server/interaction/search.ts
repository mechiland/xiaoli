// The 来往 group of the search overlay (SPEC §9.8).
import { eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type { InteractionSearchHit } from '@/contracts'
import { chatHref, personHref } from '@/lib/links'
import { chats, conversationSegments, loops, messages, owned, persons, type Db } from '@/server/db'
import { chunk } from './db'
import { highlightRanges, likeContains, normalizeQuery, splitTerms } from './text'

/**
 * Segment summaries, their topic words, and the text of unfinished items. Ranked by recency: this group sits last in
 * the overlay because it is broader than people and claims (SPEC §9.8).
 */
export async function searchInteraction(db: Db, ownerId: string, q: string, limit: number): Promise<InteractionSearchHit[]> {
  const terms = splitTerms(normalizeQuery(q))
  if (terms.length === 0) return []
  const cap = Math.max(1, Math.min(100, limit))

  const segmentMatch = or(
    ...terms.flatMap((t) => [
      sql`${conversationSegments.summaryNorm} like ${likeContains(t)} escape '\\'`,
      sql`lower(${conversationSegments.topics}) like ${likeContains(t)} escape '\\'`,
    ]),
  )
  const loopMatch = or(...terms.map((t) => sql`${loops.textNorm} like ${likeContains(t)} escape '\\'`))

  const [segRows, loopRows] = await Promise.all([
    db
      .select({
        id: conversationSegments.id,
        chatId: conversationSegments.chatId,
        chatTitle: chats.title,
        startSeq: conversationSegments.startSeq,
        startedAt: conversationSegments.startedAt,
        summary: conversationSegments.summary,
      })
      .from(conversationSegments)
      .innerJoin(chats, eq(chats.id, conversationSegments.chatId))
      .where(owned(conversationSegments, ownerId, eq(conversationSegments.hidden, false), segmentMatch))
      .orderBy(sql`${conversationSegments.startedAt} desc`)
      .limit(cap)
      .all(),
    db
      .select({ id: loops.id, text: loops.text, openedAt: loops.openedAt, personId: persons.id, label: persons.label })
      .from(loops)
      .innerJoin(persons, eq(persons.id, loops.personId))
      .where(owned(loops, ownerId, ne(loops.status, 'rejected'), eq(persons.ownerId, ownerId), isNull(persons.mergedIntoId), loopMatch))
      .orderBy(sql`${loops.openedAt} desc`)
      .limit(cap)
      .all(),
  ])

  // "在聊天中查看" anchors on the segment's first message
  const firstIds = new Map<string, number>()
  if (segRows.length > 0) {
    const chatIds = [...new Set(segRows.map((s) => s.chatId))]
    for (const part of chunk(segRows, 40)) {
      const found = await db
        .select({ id: messages.id, chatId: messages.chatId, seq: messages.seq })
        .from(messages)
        .where(owned(messages, ownerId, inArray(messages.chatId, chatIds), inArray(messages.seq, [...new Set(part.map((s) => s.startSeq))])))
        .all()
      for (const m of found) firstIds.set(`${m.chatId}:${m.seq}`, m.id)
    }
  }

  const hits: InteractionSearchHit[] = [
    ...segRows.map((s): InteractionSearchHit => {
      const at = firstIds.get(`${s.chatId}:${s.startSeq}`)
      return {
        kind: 'segment',
        id: s.id,
        person: null,
        chatId: s.chatId,
        chatTitle: s.chatTitle,
        at: s.startedAt,
        text: s.summary,
        href: chatHref(s.chatId, at),
        highlights: highlightRanges(s.summary, terms),
      }
    }),
    ...loopRows.map((l): InteractionSearchHit => ({
      kind: 'loop',
      id: l.id,
      person: { id: l.personId, label: l.label },
      chatId: null,
      chatTitle: null,
      at: l.openedAt,
      text: l.text,
      href: personHref(l.personId, { type: 'loop', id: l.id }),
      highlights: highlightRanges(l.text, terms),
    })),
  ]

  hits.sort((a, b) => b.at.localeCompare(a.at) || a.kind.localeCompare(b.kind) || a.id - b.id)
  return hits.slice(0, cap)
}
