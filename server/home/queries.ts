// Home data (ARCHITECTURE §1.9, §2.4 `GET /api/home`). One loader per page block so a failing block never takes the others down.
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm'
import type { HomeResponse } from '@/contracts'
import { DEFAULT_TZ, todayInTz } from '@/lib/time'
import { chats, claims, getUserSettings, importantDates, imports, owned, persons, type Db } from '@/server/db'
import { listPeopleIndex } from '@/server/search'
import { computeUpcoming } from './upcoming'

/** "最近导入" rows and the imports whose confirmed items feed "最近有新信息的人". */
export const RECENT_IMPORTS_LIMIT = 5
/** at most this many people in "最近有新信息的人" */
export const RECENTLY_UPDATED_LIMIT = 8

export const HOME_BLOCK_KEYS = ['upcoming', 'recentlyUpdated', 'pinned', 'index', 'recentImports', 'onboarding'] as const
export type HomeBlockKey = (typeof HOME_BLOCK_KEYS)[number]

export interface HomeBlocks {
  upcoming: HomeResponse['upcoming'] | null
  recentlyUpdated: HomeResponse['recentlyUpdated'] | null
  pinned: HomeResponse['pinned'] | null
  index: HomeResponse['index'] | null
  recentImports: HomeResponse['recentImports'] | null
}

export interface HomeBlocksResult {
  blocks: HomeBlocks
  /** blocks whose server fetch failed; the page renders a client fallback for them */
  failed: HomeBlockKey[]
  isEmpty: boolean
  needsOnboarding: boolean
  today: string
}

export interface HomeOptions {
  tz?: string
  /** 'YYYY-MM-DD'; defaults to today in tz */
  today?: string
  /** development-only failure injection for the showcase (page passes it only when NEXTJS_ENV=development) */
  fail?: readonly HomeBlockKey[]
}

const visiblePerson = (ownerId: string) => and(eq(persons.ownerId, ownerId), isNull(persons.mergedIntoId), eq(persons.isSelf, false))

export async function loadUpcoming(db: Db, ownerId: string, today: string): Promise<HomeResponse['upcoming']> {
  const rows = await db
    .select({
      dateId: importantDates.id,
      personId: importantDates.personId,
      personLabel: persons.label,
      kind: importantDates.kind,
      label: importantDates.label,
      calendar: importantDates.calendar,
      month: importantDates.month,
      day: importantDates.day,
      isLeapMonth: importantDates.isLeapMonth,
    })
    .from(importantDates)
    .innerJoin(persons, eq(persons.id, importantDates.personId))
    .where(owned(importantDates, ownerId, eq(importantDates.status, 'confirmed'), visiblePerson(ownerId)))
    .all()
  return computeUpcoming(rows, today)
}

async function recentImportIds(db: Db, ownerId: string): Promise<number[]> {
  const rows = await db
    .select({ id: imports.id })
    .from(imports)
    .where(owned(imports, ownerId, ne(imports.status, 'mapping')))
    .orderBy(desc(imports.createdAt), desc(imports.id))
    .limit(RECENT_IMPORTS_LIMIT)
    .all()
  return rows.map((r) => r.id)
}

/**
 * People with confirmed claims from the last few imports, newest confirmation first, each with that latest claim.
 * Sensitive claims ("提供过手机号" placeholders, SPEC §8 / ARCHITECTURE §6 guard) are not information to show here, so they
 * neither become `latest` nor bring a person into the list on their own (DECISIONS home H10).
 */
export async function loadRecentlyUpdated(db: Db, ownerId: string): Promise<HomeResponse['recentlyUpdated']> {
  const ids = await recentImportIds(db, ownerId)
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: claims.id, statement: claims.statement, category: claims.category, personId: persons.id, label: persons.label })
    .from(claims)
    .innerJoin(persons, eq(persons.id, claims.personId))
    .where(owned(claims, ownerId, inArray(claims.importId, ids), eq(claims.status, 'confirmed'), eq(claims.sensitive, false), visiblePerson(ownerId)))
    .orderBy(desc(claims.statusChangedAt), desc(claims.id))
    .all()
  const seen = new Set<number>()
  const out: HomeResponse['recentlyUpdated'] = []
  for (const r of rows) {
    if (seen.has(r.personId)) continue
    seen.add(r.personId)
    out.push({ person: { id: r.personId, label: r.label }, latest: { id: r.id, statement: r.statement, category: r.category } })
    if (out.length >= RECENTLY_UPDATED_LIMIT) break
  }
  return out
}

export async function loadPinned(db: Db, ownerId: string): Promise<HomeResponse['pinned']> {
  return db
    .select({ id: persons.id, label: persons.label })
    .from(persons)
    .where(owned(persons, ownerId, eq(persons.pinned, true), isNull(persons.mergedIntoId), eq(persons.isSelf, false)))
    .orderBy(asc(persons.labelSort), asc(persons.label), asc(persons.id))
    .all()
}

export async function loadRecentImports(db: Db, ownerId: string): Promise<HomeResponse['recentImports']> {
  return db
    .select({
      id: imports.id,
      chatTitle: chats.title,
      dateFrom: imports.dateFrom,
      dateTo: imports.dateTo,
      createdAt: imports.createdAt,
      status: imports.status,
    })
    .from(imports)
    .leftJoin(chats, and(eq(chats.id, imports.chatId), eq(chats.ownerId, ownerId)))
    .where(owned(imports, ownerId, ne(imports.status, 'mapping')))
    .orderBy(desc(imports.createdAt), desc(imports.id))
    .limit(RECENT_IMPORTS_LIMIT)
    .all()
}

/** Empty home (SPEC §9.12) until the first import exists; a person created by hand also counts as content. */
export function computeIsEmpty(recentImports: HomeBlocks['recentImports'], index: HomeBlocks['index']): boolean {
  if (recentImports === null || index === null) return false
  return recentImports.length === 0 && index.total === 0
}

/** Server Component first paint: every block loads independently (per-block error states, ARCHITECTURE §3). */
export async function getHomeBlocks(db: Db, ownerId: string, opts: HomeOptions = {}): Promise<HomeBlocksResult> {
  const today = opts.today ?? todayInTz(opts.tz ?? DEFAULT_TZ)
  const fail = new Set(opts.fail ?? [])
  const run = <T>(key: HomeBlockKey, fn: () => Promise<T>): Promise<T> =>
    fail.has(key) ? Promise.reject(new Error(`simulated failure: ${key}`)) : fn()

  const keys = ['upcoming', 'recentlyUpdated', 'pinned', 'index', 'recentImports', 'onboarding'] as const
  const settled = await Promise.allSettled([
    run('upcoming', () => loadUpcoming(db, ownerId, today)),
    run('recentlyUpdated', () => loadRecentlyUpdated(db, ownerId)),
    run('pinned', () => loadPinned(db, ownerId)),
    run('index', () => listPeopleIndex(db, ownerId)),
    run('recentImports', () => loadRecentImports(db, ownerId)),
    run('onboarding', async () => (await getUserSettings(db, ownerId)).onboardedAt === null),
  ])
  const failed: HomeBlockKey[] = []
  const value = <T>(i: number): T | null => {
    const s = settled[i]
    if (s.status === 'fulfilled') return s.value as T
    failed.push(keys[i])
    if (!fail.has(keys[i])) {
      console.log(JSON.stringify({ level: 'error', msg: 'home block failed', block: keys[i], error: s.reason instanceof Error ? s.reason.message.slice(0, 200) : 'unknown' }))
    }
    return null
  }
  const blocks: HomeBlocks = {
    upcoming: value(0),
    recentlyUpdated: value(1),
    pinned: value(2),
    index: value(3),
    recentImports: value(4),
  }
  const needsOnboarding = value<boolean>(5) ?? false
  return { blocks, failed, isEmpty: computeIsEmpty(blocks.recentImports, blocks.index), needsOnboarding, today }
}

/** GET /api/home: all blocks or an error (the client fallback retries the whole response). */
export async function getHome(db: Db, ownerId: string, opts: Omit<HomeOptions, 'fail'> = {}): Promise<HomeResponse> {
  const today = opts.today ?? todayInTz(opts.tz ?? DEFAULT_TZ)
  const [upcoming, recentlyUpdated, pinned, index, recentImports, settings] = await Promise.all([
    loadUpcoming(db, ownerId, today),
    loadRecentlyUpdated(db, ownerId),
    loadPinned(db, ownerId),
    listPeopleIndex(db, ownerId),
    loadRecentImports(db, ownerId),
    getUserSettings(db, ownerId),
  ])
  return {
    isEmpty: computeIsEmpty(recentImports, index),
    needsOnboarding: settings.onboardedAt === null,
    upcoming,
    recentlyUpdated,
    pinned,
    index,
    recentImports,
  }
}
