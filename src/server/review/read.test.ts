import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { updateUserSettings, type Db } from '@/server/db'
import { createTestDb, createTestUser } from '~/tests/helpers/test-db'
import { client, seedWorld, type Json, type World } from './test-fixtures'

describe('GET /api/evidence/:type/:id and GET /api/imports/:id/review', () => {
  let db: Db
  let dispose: () => Promise<void>
  let uid: string
  let w: World
  let api: ReturnType<typeof client>

  beforeAll(async () => {
    const t = await createTestDb()
    db = t.db
    dispose = t.dispose
    uid = (await createTestUser(db, 'reader@xiaoli.test')).id
    w = await seedWorld(db, uid)
    api = client(db, uid)
  })
  afterAll(async () => dispose?.())

  it('evidence: segments per chat (merged when windows touch), ±2 context, evidence flags, chat titles, sender labels', async () => {
    const r = await api.get(`/api/evidence/claim/${w.newWork.id}`)
    expect(r.status).toBe(200)
    expect(r.body.target).toEqual({ type: 'claim', id: w.newWork.id })
    expect(r.body.sourceKind).toBe('ai')
    expect(r.body.manualAddedAt).toBeNull()
    const items = r.body.items as Json[]
    expect(items).toHaveLength(2)
    // ordered by the first evidence message time; group msg #3 is 2026-09-04, private #4/#5 are 2026-09-05/06
    const [group, priv] = items
    expect(group).toMatchObject({ chatId: w.group.id, chatTitle: '测试群x', messageId: w.g[2].id })
    expect(group.messages.map((m: Json) => m.body)).toEqual(['群消息1', '群消息2', '群消息3', '群消息4', '群消息5'])
    expect(group.messages.filter((m: Json) => m.isEvidence).map((m: Json) => m.id)).toEqual([w.g[2].id])
    expect(priv.chatTitle).toBe('私聊x')
    // evidence #4 and #5 (ctx 2 each) merge into one segment: #2..#5
    expect(priv.messages.map((m: Json) => m.seq)).toEqual([2048, 3072, 4096, 5120])
    expect(priv.messages.filter((m: Json) => m.isEvidence)).toHaveLength(2)
    const voice = priv.messages[0]
    expect(voice).toMatchObject({ kind: 'voice', meta: { durationSec: 14 }, senderName: '周以宁备注', senderPersonId: w.a.id, senderLabel: '周以宁', attachments: [] })
    expect(priv.messages[1]).toMatchObject({ kind: 'transfer', senderLabel: '我' })
    expect(priv.messages[2]).toMatchObject({ kind: 'red_packet', meta: { greeting: '恭喜发财' } })
  })

  it('evidence: context=0 returns only evidence messages; manual items have no segments and manualAddedAt', async () => {
    const r = await api.get(`/api/evidence/claim/${w.newWork.id}?context=0`)
    expect((r.body.items as Json[]).flatMap((i) => i.messages).every((m: Json) => m.isEvidence)).toBe(true)
    const manual = await api.get(`/api/evidence/claim/${w.manual.id}`)
    expect(manual.body).toMatchObject({ sourceKind: 'manual', manualAddedAt: w.manual.createdAt, items: [] })
    const rel = await api.get(`/api/evidence/relation/${w.rel.id}`)
    expect(rel.body.items).toHaveLength(1)
    expect((await api.get(`/api/evidence/claim/999999`)).status).toBe(404)
    expect((await api.get(`/api/evidence/claim/${w.b1.id}?context=99`)).status).toBe(400)
  })

  it('import review: sections (new person first), groups, changes with replaces, placement, high-confidence, flags', async () => {
    const r = await api.get(`/api/imports/${w.imp.id}/review`)
    expect(r.status).toBe(200)
    const body = r.body
    expect(body.import).toMatchObject({ id: w.imp.id, status: 'reviewing' })
    expect(body.chat).toMatchObject({ id: w.group.id, title: '测试群x', messageCount: 10 })
    // failures travels with the review response so the page can name the cause; this fixture's failed job
    // carries no error text, which is reported as the generic code (DECISIONS ## import-result IR-x2)
    expect(body.progress).toEqual({ total: 2, done: 1, failed: 1, pending: 0, running: 0, failures: [{ code: 'llm_error', n: 1 }] })
    const sections = body.sections as Json[]
    expect(sections.map((s) => s.person.label)).toEqual(['陈嘉树', '周以宁'])
    const [b, a] = sections
    expect(b.person).toEqual({ id: w.b.id, label: '陈嘉树', isNew: true })
    expect(b.newClaims.map((i: Json) => i.item.category)).toEqual(['work', 'education', 'preference', 'other'])
    expect(b.aliasesAndRelations.map((i: Json) => i.type)).toEqual(['handle', 'relation']) // relation b→a placed with the new person
    expect(b.dates.map((i: Json) => i.item.id)).toEqual([w.date.id])
    expect(b.events.map((i: Json) => i.item.id)).toEqual([w.evt.id])
    expect(b.newCount).toBe(8)
    expect(a.person.isNew).toBe(false)
    expect(a.newClaims).toEqual([])
    expect(a.changes).toHaveLength(1)
    expect(a.changes[0]).toMatchObject({ type: 'claim', item: { id: w.newWork.id }, replaces: { id: w.oldWork.id, statement: '在苏州做会计' } })
    // manual claim of a is not part of the import
    expect(JSON.stringify(sections)).not.toContain('养了一只猫')
    // high confidence: ≥ 0.8, not sensitive, proposed claims only
    expect(body.highConfidence.map((x: Json) => x.id).sort()).toEqual([w.newWork.id, w.b1.id, w.bMixed.id].sort())
    expect(body.highConfidenceCount).toBe(3)
    expect(body.allHandled).toBe(false)
    expect(body.empty).toBe(false)
  })

  it('import review: threshold from settings; allHandled after handling; items stay in place after review', async () => {
    await updateUserSettings(db, uid, { highConfidenceThreshold: 0.9 })
    const before = await api.get(`/api/imports/${w.imp.id}/review`)
    expect(before.body.highConfidence.map((x: Json) => x.id).sort()).toEqual([w.newWork.id, w.b1.id].sort())
    const items = [
      ...[w.newWork, w.b1, w.b2, w.bSensitive, w.bMixed].map((c) => ({ type: 'claim', id: c.id })),
      { type: 'handle', id: w.hBmention.id },
      { type: 'relation', id: w.rel.id },
      { type: 'event', id: w.evt.id },
      { type: 'date', id: w.date.id },
    ]
    expect((await api.post('/api/review/bulk', { action: 'accept', items })).body.updated).toBe(9)
    const after = await api.get(`/api/imports/${w.imp.id}/review`)
    expect(after.body.allHandled).toBe(true)
    expect(after.body.highConfidenceCount).toBe(0)
    expect(after.body.import.status).toBe('done')
    const a = (after.body.sections as Json[]).find((s) => s.person.id === w.a.id)
    expect(a.changes[0].replaces.status).toBe('superseded')
    expect(after.body.sections.map((s: Json) => s.newCount)).toEqual(before.body.sections.map((s: Json) => s.newCount))
  })

  it('import review: an import without items is empty; unknown import 404', async () => {
    const other = await seedWorld(db, uid, 'y')
    const { imports } = await import('@/server/db')
    const { withOwner } = await import('@/server/db')
    const [imp] = await db
      .insert(imports)
      .values(withOwner<typeof imports>(uid, { chatId: other.group.id, fileName: 'e.zip', fileSha256: 'empty-sha', exportedAt: null, parserVersion: 't', status: 'reviewing', messageCount: 0, newMessageCount: 0, dateFrom: null, dateTo: null, stats: { byKind: {}, bySender: {}, images: { count: 0, bytes: 0 }, videos: { count: 0, bytes: 0 } }, error: null }))
      .returning()
    const r = await api.get(`/api/imports/${imp.id}/review`)
    expect(r.body).toMatchObject({ sections: [], empty: true, allHandled: true, highConfidenceCount: 0 })
    expect((await api.get('/api/imports/999999/review')).status).toBe(404)
  })
})
