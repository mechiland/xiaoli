// GET /api/evidence/:type/:id — evidence messages with ±context, grouped into per-chat segments (SPEC §9.6).
import { and, asc, desc, eq, gt, inArray, lt } from 'drizzle-orm'
import type { AttachmentDTO, EvidenceItemDTO, EvidenceMessageDTO, EvidenceResponse, TargetType } from '@/contracts'
import { attachments, chats, evidence, handles, messages, owned, persons, type Db } from '@/server/db'
import { errors } from '@/server/errors'
import { loadRow } from './dto'
import { chunk, IN_CHUNK, uniq } from './util'

type MessageRow = typeof messages.$inferSelect

export async function getEvidence(db: Db, ownerId: string, type: TargetType, id: number, context = 2): Promise<EvidenceResponse> {
  const row = await loadRow(db, ownerId, type, id)
  if (!row) throw errors.notFound()
  const ctx = Math.max(0, Math.min(10, Math.floor(context)))
  const base: EvidenceResponse = {
    target: { type, id },
    sourceKind: row.sourceKind,
    manualAddedAt: row.sourceKind === 'manual' ? row.createdAt : null,
    items: [],
  }

  const evRows = await db
    .select({ messageId: evidence.messageId })
    .from(evidence)
    .where(owned(evidence, ownerId, eq(evidence.targetType, type), eq(evidence.targetId, id)))
  if (evRows.length === 0) return base

  const evMsgs: MessageRow[] = []
  for (const part of chunk(uniq(evRows.map((e) => e.messageId)), IN_CHUNK)) {
    evMsgs.push(...(await db.select().from(messages).where(owned(messages, ownerId, inArray(messages.id, part)))))
  }
  const evidenceIds = new Set(evMsgs.map((m) => m.id))

  // Context around every evidence message, in one batch: `ctx` before (desc) and `ctx + 1` after (asc) in the same chat.
  // The extra message after the window is not shown; it is the window's chat successor, used to tell whether the next
  // window is really adjacent in the chat (positions in the fetched list say nothing about chat adjacency).
  interface Window {
    ev: MessageRow
    msgs: MessageRow[]
    nextId: number | null
  }
  const windows: Window[] = evMsgs.map((ev) => ({ ev, msgs: [ev], nextId: null }))
  const queries = evMsgs.flatMap((m) => [
    ...(ctx > 0
      ? [db.select().from(messages).where(owned(messages, ownerId, and(eq(messages.chatId, m.chatId), lt(messages.seq, m.seq)))).orderBy(desc(messages.seq)).limit(ctx)]
      : []),
    db.select().from(messages).where(owned(messages, ownerId, and(eq(messages.chatId, m.chatId), gt(messages.seq, m.seq)))).orderBy(asc(messages.seq)).limit(ctx + 1),
  ])
  const per = ctx > 0 ? 2 : 1
  const results: MessageRow[][] = []
  for (const part of chunk(queries, 40)) {
    results.push(...((await db.batch(part as [(typeof queries)[number], ...(typeof queries)[number][]])) as MessageRow[][]))
  }
  windows.forEach((w, i) => {
    const before = ctx > 0 ? results[i * per] : []
    const after = results[i * per + per - 1]
    w.msgs = [...before, w.ev, ...after.slice(0, ctx)].sort((a, b) => a.seq - b.seq)
    w.nextId = after.length > ctx ? after[ctx].id : null
  })

  // Per chat, merge windows only when they share a message or the second starts right after the first in the chat,
  // so a message never repeats and far-apart evidence stays in separate segments (SPEC §9.6 "多条证据时逐段排列").
  const byChat = new Map<number, Window[]>()
  for (const w of windows) byChat.set(w.ev.chatId, [...(byChat.get(w.ev.chatId) ?? []), w])
  const segments: MessageRow[][] = []
  for (const list of byChat.values()) {
    list.sort((a, b) => a.ev.seq - b.ev.seq)
    let cur: { msgs: Map<number, MessageRow>; endSeq: number; nextId: number | null } | null = null
    const groups: Map<number, MessageRow>[] = []
    for (const w of list) {
      const first = w.msgs[0]
      const last = w.msgs[w.msgs.length - 1]
      if (cur && (first.seq <= cur.endSeq || first.id === cur.nextId)) {
        for (const m of w.msgs) cur.msgs.set(m.id, m)
        if (last.seq > cur.endSeq) {
          cur.endSeq = last.seq
          cur.nextId = w.nextId
        }
      } else {
        cur = { msgs: new Map(w.msgs.map((m) => [m.id, m])), endSeq: last.seq, nextId: w.nextId }
        groups.push(cur.msgs)
      }
    }
    for (const g of groups) segments.push([...g.values()].sort((a, b) => a.seq - b.seq))
  }
  segments.sort((a, b) => {
    const ea = a.find((m) => evidenceIds.has(m.id))!
    const eb = b.find((m) => evidenceIds.has(m.id))!
    return ea.sentAt === eb.sentAt ? ea.seq - eb.seq : ea.sentAt < eb.sentAt ? -1 : 1
  })

  const msgIds = segments.flat().map((m) => m.id)
  const chatIds = uniq(segments.map((s) => s[0].chatId))
  const handleIds = uniq(segments.flat().map((m) => m.senderHandleId).filter((x): x is number => x != null))

  const chatTitles = new Map<number, string>()
  for (const part of chunk(chatIds, IN_CHUNK)) {
    for (const c of await db.select({ id: chats.id, title: chats.title }).from(chats).where(owned(chats, ownerId, inArray(chats.id, part)))) {
      chatTitles.set(c.id, c.title)
    }
  }
  const senders = new Map<number, { personId: number | null; label: string | null }>()
  for (const part of chunk(handleIds, IN_CHUNK)) {
    const hs = await db
      .select({ id: handles.id, personId: handles.personId, label: persons.label })
      .from(handles)
      .leftJoin(persons, eq(persons.id, handles.personId))
      .where(owned(handles, ownerId, inArray(handles.id, part)))
    for (const h of hs) senders.set(h.id, { personId: h.personId, label: h.label })
  }
  const atts = new Map<number, AttachmentDTO[]>()
  for (const part of chunk(msgIds, IN_CHUNK)) {
    for (const a of await db.select().from(attachments).where(owned(attachments, ownerId, inArray(attachments.messageId, part)))) {
      const dto: AttachmentDTO = {
        id: a.id,
        messageId: a.messageId,
        kind: a.kind,
        fileName: a.fileName,
        selected: a.selected,
        uploaded: a.r2Key != null,
        byteSize: a.byteSize,
        mime: a.mime,
        url: a.r2Key != null ? `/api/attachments/${a.id}` : null,
      }
      atts.set(a.messageId, [...(atts.get(a.messageId) ?? []), dto])
    }
  }

  const toDTO = (m: MessageRow): EvidenceMessageDTO => {
    const s = m.senderHandleId != null ? senders.get(m.senderHandleId) : undefined
    return {
      id: m.id,
      chatId: m.chatId,
      seq: m.seq,
      sentAt: m.sentAt,
      kind: m.kind,
      body: m.body,
      meta: m.meta ?? null,
      senderHandleId: m.senderHandleId,
      senderName: m.senderName,
      senderPersonId: s?.personId ?? null,
      senderLabel: s?.label ?? null,
      attachments: atts.get(m.id) ?? [],
      isEvidence: evidenceIds.has(m.id),
    }
  }
  const items: EvidenceItemDTO[] = segments.map((seg) => ({
    messageId: seg.find((m) => evidenceIds.has(m.id))!.id,
    chatId: seg[0].chatId,
    chatTitle: chatTitles.get(seg[0].chatId) ?? '',
    messages: seg.map(toDTO),
  }))
  return { ...base, items }
}
