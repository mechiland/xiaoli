// Seed invariants against an in-memory D1 (never the dev server's state).
import { and, eq, inArray, isNotNull, ne, notInArray, sql } from 'drizzle-orm'
import { LunarYear } from 'lunar-typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { nextOccurrence } from '@/lib/lunar'
import { indexLetter } from '@/lib/pinyin'
import * as schema from '@/server/db/schema'
import type { Db } from '@/server/db'
import { createTestDb, createTestUser } from '@/tests/helpers/test-db'
import { FILLER_KINDS } from './content'
import { TAGGED_LABELS, surnameOf } from './names'
import { DELETE_ORDER, seedAccounts, type SeedResult } from './write'

const TODAY = '2026-09-15'
const NOW = new Date('2026-09-15T04:00:00.000Z')

let env: Awaited<ReturnType<typeof createTestDb>>
let db: Db
let owners: { seed: string; seed2: string; empty: string }
let bystander: string
let first: SeedResult

const count = async (table: typeof schema.claims | typeof schema.persons, where?: ReturnType<typeof eq>) =>
  (await db.select({ n: sql<number>`count(*)` }).from(table).where(where).get())!.n

beforeAll(async () => {
  env = await createTestDb()
  db = env.db
  owners = {
    seed: (await createTestUser(db, 'seed@xiaoli.test')).id,
    seed2: (await createTestUser(db, 'seed2@xiaoli.test')).id,
    empty: (await createTestUser(db, 'empty@xiaoli.test')).id,
  }
  bystander = (await createTestUser(db, 'someone-else@xiaoli.test')).id
  const at = NOW.toISOString()
  await db.insert(schema.chats).values({ ownerId: bystander, title: '别人的聊天', kind: 'private', note: null, createdAt: at, updatedAt: at })
  await db.insert(schema.persons).values({ ownerId: bystander, label: TAGGED_LABELS.longProfile, isSelf: false, pinned: false, labelSort: 'lin zhi xia', createdAt: at, updatedAt: at })
  first = await seedAccounts(db, env.r2, owners, { today: TODAY, now: NOW })
}, 240_000)

afterAll(async () => {
  await env?.dispose()
})

describe('pnpm seed dataset', () => {
  it('runs well under a minute', () => {
    expect(first.ms.total).toBeLessThan(60_000)
  })

  it('has 200 visible persons, 1 self, 3 merged, 12 pinned, pinyin A–Z and # groups', async () => {
    const persons = await db.select().from(schema.persons).where(eq(schema.persons.ownerId, owners.seed)).all()
    const visible = persons.filter((p) => !p.isSelf && p.mergedIntoId === null)
    expect(visible).toHaveLength(200)
    expect(persons.filter((p) => p.isSelf)).toHaveLength(1)
    expect(persons.filter((p) => p.mergedIntoId !== null)).toHaveLength(3)
    expect(visible.filter((p) => p.pinned)).toHaveLength(12)
    const letters = new Set(visible.map((p) => indexLetter(p.label)))
    for (const l of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#') expect(letters, `letter ${l}`).toContain(l)
    expect(visible.some((p) => /^[A-Za-z]/.test(p.label))).toBe(true)
    expect([...TAGGED_LABELS.longLabel]).toHaveLength(30)
    expect(visible.every((p) => p.labelSort.length > 0)).toBe(true)
  })

  it('has exactly 5000 claims across all 7 categories with the documented status mix', async () => {
    const claims = await db.select().from(schema.claims).where(eq(schema.claims.ownerId, owners.seed)).all()
    expect(claims).toHaveLength(5000)
    expect(new Set(claims.map((c) => c.category))).toEqual(new Set(['work', 'location', 'education', 'family', 'preference', 'life_event', 'other']))
    const share = (pred: (c: (typeof claims)[number]) => boolean) => claims.filter(pred).length / claims.length
    expect(share((c) => c.status === 'confirmed')).toBeGreaterThan(0.72)
    expect(share((c) => c.status === 'confirmed')).toBeLessThan(0.88)
    expect(share((c) => c.status === 'proposed')).toBeGreaterThan(0.08)
    expect(share((c) => c.status === 'proposed')).toBeLessThan(0.16)
    expect(share((c) => c.status === 'superseded')).toBeGreaterThan(0.03)
    expect(share((c) => c.status === 'superseded')).toBeLessThan(0.08)
    expect(share((c) => c.status === 'rejected')).toBeGreaterThan(0.015)
    expect(share((c) => c.status === 'rejected')).toBeLessThan(0.05)
    expect(share((c) => c.validFrom !== null)).toBeGreaterThan(0.15)
    expect(claims.some((c) => c.sensitive)).toBe(true)
    expect(claims.filter((c) => c.sourceKind === 'manual').every((c) => c.importId === null && c.confidence === null)).toBe(true)
    expect(new Set(claims.filter((c) => c.status === 'superseded').map((c) => c.statusReason))).toEqual(new Set(['superseded', 'outdated', 'edited']))
  })

  it('superseded chains link both ways', async () => {
    const claims = await db.select().from(schema.claims).where(eq(schema.claims.ownerId, owners.seed)).all()
    const byId = new Map(claims.map((c) => [c.id, c]))
    const linked = claims.filter((c) => c.supersededByClaimId !== null)
    expect(linked.length).toBeGreaterThan(100)
    for (const old of linked) {
      const next = byId.get(old.supersededByClaimId!)
      expect(next, `claim ${old.id}`).toBeDefined()
      expect(next!.supersedesClaimId).toBe(old.id)
      expect(next!.personId).toBe(old.personId)
    }
    const history = claims.filter((c) => c.personId === first.datasets.seed!.refs.persons['with-history'].id)
    expect(history.filter((c) => c.statusReason === 'superseded').length).toBeGreaterThanOrEqual(4)
    expect(history.filter((c) => c.statusReason === 'outdated')).toHaveLength(2)
    expect(history.filter((c) => c.statusReason === 'edited')).toHaveLength(1)
  })

  it('every AI item has 1–3 evidence messages that exist and belong to the same owner', async () => {
    const ev = await db.select().from(schema.evidence).where(eq(schema.evidence.ownerId, owners.seed)).all()
    const perTarget = new Map<string, number>()
    for (const e of ev) perTarget.set(`${e.targetType}:${e.targetId}`, (perTarget.get(`${e.targetType}:${e.targetId}`) ?? 0) + 1)
    const aiClaims = await db.select({ id: schema.claims.id }).from(schema.claims).where(and(eq(schema.claims.ownerId, owners.seed), eq(schema.claims.sourceKind, 'ai'))).all()
    for (const c of aiClaims) {
      const n = perTarget.get(`claim:${c.id}`) ?? 0
      expect(n, `claim ${c.id}`).toBeGreaterThanOrEqual(1)
      expect(n, `claim ${c.id}`).toBeLessThanOrEqual(3)
    }
    const manual = await db.select({ id: schema.claims.id }).from(schema.claims).where(and(eq(schema.claims.ownerId, owners.seed), eq(schema.claims.sourceKind, 'manual'))).all()
    for (const c of manual) expect(perTarget.has(`claim:${c.id}`)).toBe(false)
    for (const type of ['handle', 'relation', 'event', 'date'] as const) expect([...perTarget.keys()].some((k) => k.startsWith(`${type}:`))).toBe(true)

    const orphans = await env.d1
      .prepare(`select count(*) as n from evidence e left join messages m on m.id = e.message_id and m.owner_id = e.owner_id where m.id is null`)
      .first<{ n: number }>()
    expect(orphans!.n).toBe(0)
    const danglingTargets = await env.d1
      .prepare(
        `select count(*) as n from evidence e where
          (e.target_type='claim' and not exists (select 1 from claims x where x.id=e.target_id and x.owner_id=e.owner_id)) or
          (e.target_type='handle' and not exists (select 1 from handles x where x.id=e.target_id and x.owner_id=e.owner_id)) or
          (e.target_type='relation' and not exists (select 1 from relations x where x.id=e.target_id and x.owner_id=e.owner_id)) or
          (e.target_type='event' and not exists (select 1 from events x where x.id=e.target_id and x.owner_id=e.owner_id)) or
          (e.target_type='date' and not exists (select 1 from important_dates x where x.id=e.target_id and x.owner_id=e.owner_id))`,
      )
      .first<{ n: number }>()
    expect(danglingTargets!.n).toBe(0)
    const crossOwner = await env.d1
      .prepare(`select count(*) as n from messages m join chats c on c.id = m.chat_id where c.owner_id <> m.owner_id`)
      .first<{ n: number }>()
    expect(crossOwner!.n).toBe(0)
  })

  it('ownerId is set on every business row and only seed owners (plus the bystander) own rows', async () => {
    const allowed = [owners.seed, owners.seed2, owners.empty, bystander]
    for (const key of DELETE_ORDER) {
      const table = (schema as unknown as Record<string, typeof schema.claims>)[key]
      const bad = await db.select({ n: sql<number>`count(*)` }).from(table).where(notInArray(table.ownerId, allowed)).get()
      expect(bad!.n, key).toBe(0)
    }
    expect(await count(schema.claims, eq(schema.claims.ownerId, owners.empty))).toBe(0)
    expect(await count(schema.persons, eq(schema.persons.ownerId, owners.empty))).toBe(0)
    const emptySettings = await db.select().from(schema.userSettings).where(eq(schema.userSettings.ownerId, owners.empty)).all()
    expect(emptySettings).toHaveLength(0)
  })

  it('covers every message kind, chats, imports in every documented state, handles of every kind', async () => {
    const kinds = await db.selectDistinct({ k: schema.messages.kind }).from(schema.messages).where(eq(schema.messages.ownerId, owners.seed)).all()
    expect(new Set(kinds.map((k) => k.k))).toEqual(new Set(FILLER_KINDS))
    const msgCount = await db.select({ n: sql<number>`count(*)` }).from(schema.messages).where(eq(schema.messages.ownerId, owners.seed)).get()
    expect(msgCount!.n).toBeGreaterThan(5000)
    expect(msgCount!.n).toBeLessThan(8000)

    const chats = await db.select().from(schema.chats).where(eq(schema.chats.ownerId, owners.seed)).all()
    expect(chats.filter((c) => c.kind === 'group')).toHaveLength(3)
    expect(chats.filter((c) => c.kind === 'private').length).toBeGreaterThanOrEqual(5)

    const imports = await db.select().from(schema.imports).where(eq(schema.imports.ownerId, owners.seed)).all()
    const by = (s: string) => imports.filter((i) => i.status === s).length
    expect(by('done')).toBe(8)
    expect(by('reviewing')).toBe(4) // review-mixed, review-empty, failed-windows, delete-me
    expect(by('extracting')).toBe(1)
    expect(by('mapping')).toBe(1)
    const refs = first.datasets.seed!.refs
    for (const tag of ['review-mixed', 'review-empty', 'in-progress', 'failed-windows', 'uploads-pending', 'delete-me', 'unfinished']) expect(refs.imports[tag], tag).toBeDefined()
    for (const tag of ['long-profile', 'sparse-profile', 'proposed-heavy', 'with-history', 'lunar-birthday-soon', 'leap-month', 'long-label']) expect(refs.persons[tag], tag).toBeDefined()
    for (const tag of ['group-big', 'private-long']) expect(refs.chats[tag], tag).toBeDefined()
    expect(refs.claims['claim-searchable']).toBeDefined()
    const unfinished = imports.find((i) => i.id === refs.imports.unfinished.id)!
    expect(unfinished.chatId).toBeNull()

    const jobs = await db.select().from(schema.extractionJobs).where(eq(schema.extractionJobs.ownerId, owners.seed)).all()
    expect(jobs.filter((j) => j.importId === refs.imports['in-progress'].id && j.status === 'pending').length).toBeGreaterThan(0)
    expect(jobs.filter((j) => j.importId === refs.imports['failed-windows'].id && j.status === 'failed')).toHaveLength(2)

    const handles = await db.select().from(schema.handles).where(eq(schema.handles.ownerId, owners.seed)).all()
    expect(new Set(handles.map((h) => h.kind))).toEqual(new Set(['display_private', 'display_group', 'mentioned', 'real_name', 'address_term']))
    expect(handles.filter((h) => h.personId === refs.persons['long-profile'].id)).toHaveLength(15)
    expect(handles.filter((h) => h.kind === 'real_name').every((h) => h.chatId === null)).toBe(true)
  })

  it('done imports carry no proposed items; long-profile has the documented shape', async () => {
    const doneIds = (await db.select({ id: schema.imports.id }).from(schema.imports).where(and(eq(schema.imports.ownerId, owners.seed), eq(schema.imports.status, 'done'))).all()).map((r) => r.id)
    for (const table of [schema.claims, schema.handles, schema.relations, schema.events, schema.importantDates] as (typeof schema.claims)[]) {
      const n = await db.select({ n: sql<number>`count(*)` }).from(table).where(and(eq(table.ownerId, owners.seed), inArray(table.importId, doneIds), eq(table.status, 'proposed'))).get()
      expect(n!.n).toBe(0)
    }
    const long = first.datasets.seed!.refs.persons['long-profile'].id
    const claims = await db.select().from(schema.claims).where(eq(schema.claims.personId, long)).all()
    expect(claims).toHaveLength(60)
    expect(new Set(claims.map((c) => c.category)).size).toBe(7)
    const rel = await db.select().from(schema.relations).where(sql`${schema.relations.fromPersonId} = ${long} or ${schema.relations.toPersonId} = ${long}`).all()
    expect(rel.length).toBeGreaterThanOrEqual(8)
    const events = await db.select().from(schema.eventParticipants).where(eq(schema.eventParticipants.personId, long)).all()
    expect(events.length).toBeGreaterThanOrEqual(6)
    const dates = await db.select().from(schema.importantDates).where(eq(schema.importantDates.personId, long)).all()
    expect(dates).toHaveLength(5)
    expect(dates.some((d) => d.kind === 'birthday' && d.calendar === 'lunar')).toBe(true)
    const sparse = await db.select().from(schema.claims).where(eq(schema.claims.personId, first.datasets.seed!.refs.persons['sparse-profile'].id)).all()
    expect(sparse).toHaveLength(1)
    const heavy = await db.select().from(schema.claims).where(and(eq(schema.claims.personId, first.datasets.seed!.refs.persons['proposed-heavy'].id), eq(schema.claims.status, 'proposed'))).all()
    expect(heavy.length).toBeGreaterThanOrEqual(10)
    const mentions = await db.select().from(schema.claimMentions).where(eq(schema.claimMentions.ownerId, owners.seed)).all()
    expect(mentions.length).toBeGreaterThan(20)
  })

  it('events have participants; relations to self exist; important dates include lunar, leap-month and the next 30 days', async () => {
    const events = await db.select({ id: schema.events.id }).from(schema.events).where(eq(schema.events.ownerId, owners.seed)).all()
    const parts = await db.select().from(schema.eventParticipants).where(eq(schema.eventParticipants.ownerId, owners.seed)).all()
    const withParts = new Set(parts.map((p) => p.eventId))
    expect(events.length).toBeGreaterThan(100)
    expect(events.every((e) => withParts.has(e.id))).toBe(true)

    const self = first.datasets.seed!.refs.persons.self.id
    const selfRel = await db.select().from(schema.relations).where(and(eq(schema.relations.ownerId, owners.seed), eq(schema.relations.toPersonId, self))).all()
    expect(selfRel.filter((r) => r.status === 'confirmed').length).toBeGreaterThan(50)

    const dates = await db.select().from(schema.importantDates).where(eq(schema.importantDates.ownerId, owners.seed)).all()
    expect(dates.some((d) => d.calendar === 'lunar')).toBe(true)
    const leap = dates.find((d) => d.isLeapMonth)!
    expect(leap.personId).toBe(first.datasets.seed!.refs.persons['leap-month'].id)
    expect(LunarYear.fromYear(leap.year!).getLeapMonth()).toBe(leap.month)
    const upcoming = dates.filter((d) => d.status === 'confirmed' && nextOccurrence({ calendar: d.calendar, month: d.month!, day: d.day!, isLeapMonth: d.isLeapMonth }, TODAY).days <= 30)
    expect(upcoming.length).toBeGreaterThanOrEqual(8)
    const lunarSoon = upcoming.find((d) => d.calendar === 'lunar' && d.personId === first.datasets.seed!.refs.persons['lunar-birthday-soon'].id)
    expect(lunarSoon).toBeDefined()
  })

  it('attachments exist with and without r2Key; uploaded objects are in R2; uploads-pending has 3 pending', async () => {
    const atts = await db.select().from(schema.attachments).where(eq(schema.attachments.ownerId, owners.seed)).all()
    const uploaded = atts.filter((a) => a.r2Key !== null)
    expect(uploaded).toHaveLength(10)
    expect(atts.filter((a) => a.r2Key === null).length).toBeGreaterThan(10)
    expect(atts.some((a) => a.fileName === null)).toBe(true)
    for (const a of uploaded) expect(await env.r2.head(a.r2Key!), a.r2Key!).not.toBeNull()
    const pendingImport = first.datasets.seed!.refs.imports['uploads-pending'].id
    const pending = await env.d1
      .prepare(`select count(*) as n from attachments a join import_messages im on im.message_id = a.message_id where im.import_id = ? and a.selected = 1 and a.r2_key is null`)
      .bind(pendingImport)
      .first<{ n: number }>()
    expect(pending!.n).toBe(3)
    const otherPending = await db.select({ n: sql<number>`count(*)` }).from(schema.attachments).where(and(eq(schema.attachments.ownerId, owners.seed), eq(schema.attachments.selected, true), sql`${schema.attachments.r2Key} is null`)).get()
    expect(otherPending!.n).toBe(3)
  })

  it('delete-me import: own chat of 40 messages, its person, shared long-profile claim', async () => {
    const refs = first.datasets.seed!.refs
    const del = refs.imports['delete-me'].id
    const msgs = await db.select().from(schema.messages).where(eq(schema.messages.chatId, refs.chats['delete-me'].id)).all()
    expect(msgs).toHaveLength(40) // includes the message that evidences the shared long-profile claim
    expect(msgs.every((m) => m.firstImportId === del)).toBe(true)
    const person = await db.select().from(schema.persons).where(eq(schema.persons.id, refs.persons['delete-me-person'].id)).get()
    expect(person!.importId).toBe(del)
    const claims = await db.select().from(schema.claims).where(eq(schema.claims.personId, person!.id)).all()
    expect(claims.filter((c) => c.status === 'proposed')).toHaveLength(3)
    expect(claims.filter((c) => c.status === 'confirmed')).toHaveLength(2)
    const ids = new Set(msgs.map((m) => m.id))
    for (const c of claims) {
      const ev = await db.select().from(schema.evidence).where(and(eq(schema.evidence.targetType, 'claim'), eq(schema.evidence.targetId, c.id))).all()
      expect(ev.every((e) => ids.has(e.messageId))).toBe(true)
    }
    const shared = await db.select().from(schema.evidence).where(and(eq(schema.evidence.targetType, 'claim'), eq(schema.evidence.targetId, refs.claims['delete-me-shared'].id))).all()
    expect(shared.some((e) => ids.has(e.messageId))).toBe(true)
    expect(shared.some((e) => !ids.has(e.messageId))).toBe(true)
  })

  it('seed2 overlaps seed labels; empty has nothing', async () => {
    const s2 = await db.select().from(schema.persons).where(and(eq(schema.persons.ownerId, owners.seed2), eq(schema.persons.isSelf, false))).all()
    expect(s2).toHaveLength(10)
    const seedLabels = new Set((await db.select({ l: schema.persons.label }).from(schema.persons).where(eq(schema.persons.ownerId, owners.seed)).all()).map((r) => r.l))
    expect(s2.every((p) => seedLabels.has(p.label))).toBe(true)
    expect(await count(schema.claims, eq(schema.claims.ownerId, owners.seed2))).toBe(30)
    const s2chats = await db.select().from(schema.chats).where(eq(schema.chats.ownerId, owners.seed2)).all()
    expect(s2chats).toHaveLength(1)
  })

  it('each person reads as one life: one current job and home, no repeats, sane history, family surnames line up', async () => {
    const claims = await db.select().from(schema.claims).where(eq(schema.claims.ownerId, owners.seed)).all()
    const byPerson = new Map<number, typeof claims>()
    for (const c of claims) byPerson.set(c.personId, [...(byPerson.get(c.personId) ?? []), c])
    for (const [pid, cs] of byPerson) {
      const current = cs.filter((c) => c.status === 'confirmed' && c.validTo === null)
      expect(current.filter((c) => c.category === 'work' && /^在.+(的.+做|开了一家)/.test(c.statement)).length, `person ${pid} current jobs`).toBeLessThanOrEqual(1)
      expect(current.filter((c) => c.category === 'location' && c.statement.startsWith('住在')).length, `person ${pid} current homes`).toBeLessThanOrEqual(1)
      expect(new Set(cs.map((c) => c.statement)).size, `person ${pid} repeated statements`).toBe(cs.length)
      expect(cs.filter((c) => /^\d{4}年结婚$/.test(c.statement)).length, `person ${pid} weddings`).toBeLessThanOrEqual(1)
    }
    const byId = new Map(claims.map((c) => [c.id, c]))
    for (const old of claims.filter((c) => c.statusReason === 'superseded')) {
      const next = byId.get(old.supersededByClaimId!)!
      expect(old.validTo, `claim ${old.id} validTo`).not.toBeNull()
      if (next.validFrom) expect(old.validTo! <= next.validFrom, `claim ${old.id} ends before its successor starts`).toBe(true)
      expect(next.category).toBe(old.category)
      expect(next.learnedAt >= old.learnedAt || next.createdAt! >= old.createdAt!).toBe(true)
    }

    // the chat message evidencing an AI claim says it: it shares wording with the statement
    const ev = await db.select().from(schema.evidence).where(and(eq(schema.evidence.ownerId, owners.seed), eq(schema.evidence.targetType, 'claim'))).all()
    const msgs = new Map((await db.select({ id: schema.messages.id, body: schema.messages.body }).from(schema.messages).where(eq(schema.messages.ownerId, owners.seed)).all()).map((m) => [m.id, m.body]))
    const bigrams = (t: string) => {
      const x = t.replace(/[^\p{Script=Han}A-Za-z0-9]/gu, '')
      return new Set(Array.from({ length: Math.max(0, x.length - 1) }, (_, i) => x.slice(i, i + 2)))
    }
    const evBodies = new Map<number, string[]>()
    for (const e of ev) evBodies.set(e.targetId, [...(evBodies.get(e.targetId) ?? []), msgs.get(e.messageId) ?? ''])
    for (const c of claims.filter((x) => x.sourceKind === 'ai')) {
      const want = bigrams(c.statement)
      const said = (evBodies.get(c.id) ?? []).some((body) => [...bigrams(body)].some((g) => want.has(g)))
      expect(said, `claim ${c.id} "${c.statement}" is said by its evidence`).toBe(true)
    }

    const persons = new Map((await db.select().from(schema.persons).where(eq(schema.persons.ownerId, owners.seed)).all()).map((p) => [p.id, p]))
    const rels = await db.select().from(schema.relations).where(and(eq(schema.relations.ownerId, owners.seed), ne(schema.relations.status, 'rejected'))).all()
    const spouses = new Map<number, number>()
    for (const rel of rels) {
      const from = persons.get(rel.fromPersonId)!
      const to = persons.get(rel.toPersonId)!
      if (from.isSelf || to.isSelf) continue
      if (['爸爸', '哥哥', '弟弟', '姐姐', '妹妹', '堂弟', '堂妹'].includes(rel.label ?? '')) expect(surnameOf(from.label), `${from.label} is ${to.label}'s ${rel.label}`).toBe(surnameOf(to.label))
      if (rel.type === 'spouse') for (const id of [from.id, to.id]) spouses.set(id, (spouses.get(id) ?? 0) + 1)
    }
    for (const [id, n] of spouses) expect(n, `person ${id} spouses`).toBe(1)
    const long = first.datasets.seed!.refs.persons['long-profile'].id
    const husband = rels.find((x) => x.toPersonId === long && x.label === '老公')!
    const daughter = rels.find((x) => x.toPersonId === long && x.label === '女儿')!
    expect(surnameOf(persons.get(daughter.fromPersonId)!.label)).toBe(surnameOf(persons.get(husband.fromPersonId)!.label))
  })

  it('is idempotent and leaves other users untouched', async () => {
    const snapshot = async () => {
      const out: Record<string, number> = {}
      for (const key of DELETE_ORDER) {
        const table = (schema as unknown as Record<string, typeof schema.claims>)[key]
        out[key] = (await db.select({ n: sql<number>`count(*)` }).from(table).where(ne(table.ownerId, bystander)).get())!.n
      }
      return out
    }
    const before = await snapshot()
    const second = await seedAccounts(db, env.r2, owners, { today: TODAY, now: NOW })
    expect(await snapshot()).toEqual(before)
    expect(second.datasets.seed!.counts).toEqual(first.datasets.seed!.counts)
    expect(await count(schema.persons, eq(schema.persons.ownerId, bystander))).toBe(1)
    const otherChat = await db.select().from(schema.chats).where(eq(schema.chats.ownerId, bystander)).all()
    expect(otherChat).toHaveLength(1)
    const r2Keys = await db.select({ k: schema.attachments.r2Key }).from(schema.attachments).where(and(eq(schema.attachments.ownerId, owners.seed), isNotNull(schema.attachments.r2Key))).all()
    const listed = await env.r2.list({ prefix: `u/${owners.seed}/` })
    expect(listed.objects.map((o) => o.key).sort()).toEqual(r2Keys.map((r) => r.k).sort())
  }, 240_000)
})
