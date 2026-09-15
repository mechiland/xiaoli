import { and, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import type { SearchResponse, SearchTypes } from '@/contracts'
import { sortKey } from '@/lib/pinyin'
import { claims, handles, owned, persons, type Db } from '@/server/db'
import { highlightRanges, isLatinQuery, likeContains, normalize, normalizeQuery, pinyinKeys, splitTerms } from './text'

export interface SearchOptions {
  /** per group, default 20 */
  limit?: number
  types?: SearchTypes
}

type PersonRow = { id: number; label: string; labelSort: string; pinned: boolean; lastMessageAt: string | null }
type Match = { score: number; alias: string | null }

// Match tiers (higher wins). Label matches beat alias matches of the same kind; pinyin sits between prefix and contains.
const SCORE = {
  labelExact: 100,
  aliasExact: 90,
  labelPrefix: 80,
  aliasPrefix: 70,
  pinyinInitialsExact: 66,
  pinyinFullPrefix: 62,
  pinyinInitialsPrefix: 58,
  labelContains: 50,
  aliasContains: 40,
} as const

function tier(hay: string, needle: string, exact: number, prefix: number, contains: number): number {
  if (hay === needle) return exact
  if (hay.startsWith(needle)) return prefix
  if (hay.includes(needle)) return contains
  return 0
}

/** Scores one person against the normalized query (label, pinyin) — aliases are merged in by the caller. */
export function scoreLabel(p: Pick<PersonRow, 'label' | 'labelSort'>, qn: string): number {
  const label = normalize(p.label)
  let best = tier(label, qn, SCORE.labelExact, SCORE.labelPrefix, SCORE.labelContains)
  if (best < SCORE.labelPrefix && isLatinQuery(qn)) {
    const keys = pinyinKeys(p.label, p.labelSort || sortKey(p.label))
    const compact = qn.replace(/ /g, '')
    if (keys) {
      if (keys.initials === compact) best = Math.max(best, SCORE.pinyinInitialsExact)
      else if (compact.length >= 2 && keys.full.startsWith(compact)) best = Math.max(best, SCORE.pinyinFullPrefix)
      else if (keys.initials.startsWith(compact)) best = Math.max(best, SCORE.pinyinInitialsPrefix)
    }
  }
  return best
}

/** Stable ranking: score, then pinned, then most recent contact, then pinyin order. */
export function comparePeople(a: PersonRow & Match, b: PersonRow & Match): number {
  return (
    b.score - a.score ||
    Number(b.pinned) - Number(a.pinned) ||
    (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '') ||
    (a.labelSort || a.label).localeCompare(b.labelSort || b.label) ||
    a.id - b.id
  )
}

async function searchPeople(db: Db, ownerId: string, qn: string, limit: number): Promise<(PersonRow & Match)[]> {
  const [people, aliasRows] = await Promise.all([
    db
      .select({ id: persons.id, label: persons.label, labelSort: persons.labelSort, pinned: persons.pinned, lastMessageAt: persons.lastMessageAt })
      .from(persons)
      .where(owned(persons, ownerId, isNull(persons.mergedIntoId), eq(persons.isSelf, false)))
      .all(),
    db
      .select({ personId: handles.personId, value: handles.value, valueNorm: handles.valueNorm })
      .from(handles)
      .where(
        owned(
          handles,
          ownerId,
          isNotNull(handles.personId),
          inArray(handles.status, ['confirmed', 'proposed']),
          sql`${handles.valueNorm} like ${likeContains(qn)} escape '\\'`,
        ),
      )
      .limit(1000)
      .all(),
  ])

  const bestAlias = new Map<number, Match>()
  for (const h of aliasRows) {
    if (h.personId == null) continue
    const score = tier(h.valueNorm, qn, SCORE.aliasExact, SCORE.aliasPrefix, SCORE.aliasContains)
    if (!score) continue
    const prev = bestAlias.get(h.personId)
    if (!prev || score > prev.score || (score === prev.score && h.value.length < (prev.alias?.length ?? Infinity))) {
      bestAlias.set(h.personId, { score, alias: h.value })
    }
  }

  const matched: (PersonRow & Match)[] = []
  for (const p of people) {
    const labelScore = scoreLabel(p, qn)
    const alias = bestAlias.get(p.id)
    if (!labelScore && !alias) continue
    // A label match (of any tier ≥ the alias's) is shown without "又名"; an alias equal to the label adds nothing.
    if (alias && alias.score > labelScore && normalize(alias.alias ?? '') !== normalize(p.label)) {
      matched.push({ ...p, score: alias.score, alias: alias.alias })
    } else {
      matched.push({ ...p, score: Math.max(labelScore, alias?.score ?? 0), alias: null })
    }
  }
  return matched.sort(comparePeople).slice(0, limit)
}

/** Confirmed claims whose statement contains every term, optionally restricted to some persons; shorter statements first. */
async function queryClaims(db: Db, ownerId: string, terms: string[], cap: number, personIds?: number[]) {
  const likeConds: SQL[] = terms.map((t) => sql`${claims.statementNorm} like ${likeContains(t)} escape '\\'`)
  return db
    .select({ id: claims.id, personId: claims.personId, statement: claims.statement, label: persons.label })
    .from(claims)
    .innerJoin(persons, and(eq(persons.id, claims.personId), eq(persons.ownerId, ownerId)))
    .where(
      owned(
        claims,
        ownerId,
        eq(claims.status, 'confirmed'),
        isNull(persons.mergedIntoId),
        personIds ? inArray(claims.personId, personIds) : undefined,
        ...likeConds,
      ),
    )
    .orderBy(sql`length(${claims.statement})`, desc(claims.id))
    .limit(cap)
    .all()
}

type ClaimRow = Awaited<ReturnType<typeof queryClaims>>[number]
const toHit = (r: ClaimRow, terms: string[]) => ({
  person: { id: r.personId, label: r.label },
  claimId: r.id,
  statement: r.statement,
  highlights: highlightRanges(r.statement, terms),
})

/**
 * Every term must appear in the statement. With several terms, terms that name a person (label/alias/pinyin) may instead
 * select that person: "林知夏 茶具" → 林知夏's claims containing 茶具. Those person-scoped hits come first.
 */
async function searchClaims(db: Db, ownerId: string, terms: string[], limit: number) {
  const cap = Math.min(200, limit * 4)
  const hits: ReturnType<typeof toHit>[] = []
  const seen = new Set<number>()
  if (terms.length > 1) {
    const perTerm = await Promise.all(terms.map(async (t) => ({ t, people: await searchPeople(db, ownerId, t, 20) })))
    const personTerms = perTerm.filter((x) => x.people.length > 0)
    const rest = terms.filter((t) => !personTerms.some((x) => x.t === t))
    if (personTerms.length && rest.length) {
      const personIds = [...new Set(personTerms.flatMap((x) => x.people.map((p) => p.id)))]
      for (const r of await queryClaims(db, ownerId, rest, cap, personIds)) {
        seen.add(r.id)
        hits.push(toHit(r, rest))
      }
    }
  }
  if (hits.length < limit) {
    for (const r of await queryClaims(db, ownerId, terms, cap)) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      hits.push(toHit(r, terms))
    }
  }
  return hits.slice(0, limit)
}

/**
 * GET /api/search (ARCHITECTURE §1.8, §2.4): persons by label, pinyin (Latin queries) and every confirmed/proposed
 * handle (`matchedAlias` when only an alias matched); confirmed claims by statement with highlight ranges.
 * Merged persons and the self person are excluded from `people`; everything is owner-scoped.
 */
export async function searchAll(db: Db, ownerId: string, q: string, opts: SearchOptions = {}): Promise<SearchResponse> {
  const limit = Math.max(1, Math.min(100, opts.limit ?? 20))
  const types = opts.types ?? 'all'
  const qn = normalizeQuery(q)
  if (!qn) return { q, people: [], claims: [] }

  const [people, claimHits] = await Promise.all([
    types === 'claims' ? [] : searchPeople(db, ownerId, qn, limit),
    types === 'people' ? [] : searchClaims(db, ownerId, splitTerms(qn), limit),
  ])

  return {
    q,
    people: people.map((p) => ({ person: { id: p.id, label: p.label }, matchedAlias: p.alias })),
    claims: claimHits,
  }
}
