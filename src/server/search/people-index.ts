import { eq, isNull } from 'drizzle-orm'
import type { PeopleIndexResponse } from '@/contracts'
import { indexLetter, sortKey } from '@/lib/pinyin'
import { owned, persons, type Db } from '@/server/db'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

type Row = { id: number; label: string; labelSort: string; pinned: boolean }

/** Groups rows by index letter (DECISIONS A6): A–Z in order, then '#'; within a group by pinyin sort key, then label, then id. */
export function groupPeople(rows: Row[]): PeopleIndexResponse {
  const groups = new Map<string, (Row & { key: string })[]>()
  for (const r of rows) {
    const letter = indexLetter(r.label)
    const list = groups.get(letter) ?? []
    list.push({ ...r, key: r.labelSort || sortKey(r.label) })
    groups.set(letter, list)
  }
  const order = [...LETTERS, '#']
  return {
    groups: order
      .filter((l) => groups.has(l))
      .map((letter) => ({
        letter,
        people: groups
          .get(letter)!
          .sort((a, b) => a.key.localeCompare(b.key) || a.label.localeCompare(b.label, 'zh-Hans-CN') || a.id - b.id)
          .map((r) => ({ id: r.id, label: r.label, pinned: r.pinned })),
      })),
    total: rows.length,
  }
}

/** GET /api/people?index=pinyin and home's "全部人物": visible persons (not merged, not self) of the owner. */
export async function listPeopleIndex(db: Db, ownerId: string): Promise<PeopleIndexResponse> {
  const rows = await db
    .select({ id: persons.id, label: persons.label, labelSort: persons.labelSort, pinned: persons.pinned })
    .from(persons)
    .where(owned(persons, ownerId, isNull(persons.mergedIntoId), eq(persons.isSelf, false)))
    .all()
  return groupPeople(rows)
}
