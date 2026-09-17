// PATCH /api/people/:id (label, pinned) and the self-person lookup used by the page.
import { eq } from 'drizzle-orm'
import type { PatchPersonRequest, PersonDTO } from '@/contracts'
import { sortKey } from '@/lib/pinyin'
import { nowIso } from '@/lib/time'
import { owned, persons, type Db } from '@/server/db'
import { errors } from '@/server/errors'

export async function patchPerson(db: Db, ownerId: string, personId: number, body: PatchPersonRequest): Promise<PersonDTO> {
  const p = await db.select().from(persons).where(owned(persons, ownerId, eq(persons.id, personId))).get()
  if (!p) throw errors.notFound('没有找到这个人物')
  if (p.mergedIntoId != null) throw errors.conflict('这个人物已经合并到其他人物', { mergedIntoId: p.mergedIntoId })
  const set: Partial<typeof persons.$inferInsert> = {}
  if (body.label !== undefined) {
    const label = body.label.trim()
    if (!label) throw errors.validation('名字不能为空')
    set.label = label
    set.labelSort = sortKey(label)
  }
  if (body.pinned !== undefined) set.pinned = body.pinned
  if (Object.keys(set).length === 0) throw errors.validation('没有要修改的内容')
  const [row] = await db
    .update(persons)
    .set({ ...set, updatedAt: nowIso() })
    .where(owned(persons, ownerId, eq(persons.id, personId)))
    .returning()
  return {
    id: row.id,
    label: row.label,
    isSelf: row.isSelf,
    mergedIntoId: row.mergedIntoId,
    pinned: row.pinned,
    avatarUrl: null,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function getSelfPersonId(db: Db, ownerId: string): Promise<number | null> {
  const row = await db.select({ id: persons.id }).from(persons).where(owned(persons, ownerId, eq(persons.isSelf, true))).get()
  return row?.id ?? null
}
