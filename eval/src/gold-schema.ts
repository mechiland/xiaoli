// Gold file + LOCK schemas (ARCHITECTURE §7.2, §7.6). Human documentation: eval/src/GOLD_FORMAT.md.
import { z } from 'zod'
import { Category, ChatKind, IsoString } from '@/contracts'

export const GOLD_VERSION = 1

const Idx = z.number().int().nonnegative()
const Evidence = z.array(Idx).min(1)
const PersonKey = z.string().min(1).max(60)
const ItemId = z.string().min(1).max(60)

export const NegativeKind = z.enum(['transactional', 'coordination', 'inference_trap', 'sensitive', 'invisible_content'])
export type NegativeKind = z.infer<typeof NegativeKind>

export const GoldHandleSchema = z
  .object({
    id: ItemId,
    person: PersonKey,
    kind: z.enum(['mentioned', 'real_name', 'address_term']),
    value: z.string().min(1).max(60),
    evidence: Evidence,
    optional: z.boolean().optional(),
  })
  .strict()

export const GoldRelationSchema = z
  .object({
    id: ItemId,
    /** read as: `from` 是 `to` 的 `type`（例：from=外公 to=外孙 type=parent） */
    from: PersonKey,
    to: PersonKey,
    type: z.string().min(1).max(30),
    acceptTypes: z.array(z.string().min(1).max(30)).optional(),
    label: z.string().max(30).optional(),
    evidence: Evidence,
    optional: z.boolean().optional(),
  })
  .strict()

export const GoldClaimSchema = z
  .object({
    id: ItemId,
    person: PersonKey,
    statement: z.string().min(2).max(200),
    category: Category,
    acceptCategories: z.array(Category).optional(),
    sensitive: z.boolean(),
    evidence: Evidence,
    optional: z.boolean().optional(),
    /** id of an earlier gold claim (same file) this one replaces */
    supersedes: ItemId.optional(),
  })
  .strict()

export const GoldDateSchema = z
  .object({
    id: ItemId,
    person: PersonKey,
    kind: z.string().min(1).max(20),
    month: z.number().int().min(1).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
    year: z.number().int().optional(),
    calendar: z.enum(['solar', 'lunar']),
    isLeapMonth: z.boolean().optional(),
    evidence: Evidence,
    optional: z.boolean().optional(),
  })
  .strict()

export const GoldEventSchema = z
  .object({
    id: ItemId,
    summary: z.string().min(2).max(200),
    participants: z.array(PersonKey).min(1),
    evidence: Evidence,
    optional: z.boolean().optional(),
  })
  .strict()

export const GoldNegativeSchema = z
  .object({
    id: ItemId,
    kind: NegativeKind,
    evidence: Evidence,
    description: z.string().min(1).max(200),
    forbidden: z.string().max(200).optional(),
  })
  .strict()

export const GoldPersonSchema = z
  .object({
    key: PersonKey,
    label: z.string().min(1).max(60),
    aliases: z.array(z.string().min(1).max(60)).optional(),
    inChat: z.boolean(),
  })
  .strict()

export const GoldFileSchema = z
  .object({
    goldVersion: z.literal(GOLD_VERSION),
    /** ZIP file name including `.zip` (no directory) */
    zip: z.string().min(1),
    /** agent role id, never a real name */
    annotator: z.string().min(1).max(60),
    annotatedAt: IsoString,
    notes: z.string().optional(),
    parserVersion: z.string().min(1),
    messageCount: z.number().int().nonnegative(),
    messagesSha256: z.string().regex(/^[0-9a-f]{64}$/),
    anchors: z.array(z.object({ idx: Idx, fingerprint: z.string().min(1) }).strict()),
    mapping: z
      .object({
        chat: z.object({ title: z.string().min(1).max(80), kind: ChatKind }).strict(),
        /** `person` may be '' only in a fresh template; validate-gold rejects it */
        senders: z.array(z.object({ senderName: z.string(), person: z.string() }).strict()),
        self: z.string(),
      })
      .strict(),
    persons: z.array(GoldPersonSchema),
    handles: z.array(GoldHandleSchema),
    relations: z.array(GoldRelationSchema),
    claims: z.array(GoldClaimSchema),
    dates: z.array(GoldDateSchema),
    events: z.array(GoldEventSchema),
    negatives: z.array(GoldNegativeSchema),
    sensitiveValues: z.array(z.string().min(1)),
  })
  .strict()
export type GoldFile = z.infer<typeof GoldFileSchema>
export type GoldMapping = GoldFile['mapping']
export type GoldClaim = z.infer<typeof GoldClaimSchema>
export type GoldHandle = z.infer<typeof GoldHandleSchema>
export type GoldRelation = z.infer<typeof GoldRelationSchema>
export type GoldDate = z.infer<typeof GoldDateSchema>
export type GoldEvent = z.infer<typeof GoldEventSchema>
export type GoldNegative = z.infer<typeof GoldNegativeSchema>

export const GoldLockVersionSchema = z
  .object({ goldSha256: z.string().regex(/^[0-9a-f]{64}$/), messagesSha256: z.string().regex(/^[0-9a-f]{64}$/), frozenAt: IsoString })
  .strict()
export const GoldLockSchema = z
  .object({
    lockVersion: z.literal(2),
    entries: z.record(
      z.string(),
      z.object({ source: z.enum(['synthetic', 'real']), versions: z.array(GoldLockVersionSchema).min(1) }).strict(),
    ),
  })
  .strict()
export type GoldLock = z.infer<typeof GoldLockSchema>

/** Parse a gold file; returns readable issues instead of throwing. */
export function parseGold(json: unknown): { ok: true; gold: GoldFile } | { ok: false; issues: string[] } {
  const r = GoldFileSchema.safeParse(json)
  if (r.success) return { ok: true, gold: r.data }
  return { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }
}
