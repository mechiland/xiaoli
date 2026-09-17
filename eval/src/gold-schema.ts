// Gold file + LOCK schemas (ARCHITECTURE §7.2, §7.6). Human documentation: eval/src/GOLD_FORMAT.md.
import { z } from 'zod'
import { Category, ChatKind, IsoString, LoopCloseReason, LoopDirection, LoopKind, PartialDate } from '@/contracts'

/**
 * Version written by `eval:gold-template`. Version 2 adds the optional interaction arrays (`loops`,
 * `conversations`, ARCHITECTURE §7.2). It is purely additive: a version-1 file stays valid and scores exactly as
 * before, and a file without a `loops` / `conversations` key contributes nothing to the interaction metrics
 * (§7.4) instead of scoring 0 (DECISIONS eval-synthetic E21).
 */
export const GOLD_VERSION = 2
export const SUPPORTED_GOLD_VERSIONS = [1, 2] as const
/** Gold version required for a file that carries `loops` or `conversations`. */
export const INTERACTION_GOLD_VERSION = 2

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

/**
 * 未结事项 (SPEC §7 交互层, §8.8). `evidence` is the message that opens it; `closedBy` the idx of the message that
 * closes it, when the export contains one. goldVersion 2.
 */
export const GoldLoopSchema = z
  .object({
    id: ItemId,
    person: PersonKey,
    direction: LoopDirection,
    kind: LoopKind,
    text: z.string().min(2).max(200),
    dueAt: PartialDate.optional(),
    /** the message(s) that open it */
    evidence: Evidence,
    /** idx of the message that closes it, if any */
    closedBy: Idx.optional(),
    closedReason: LoopCloseReason.optional(),
    optional: z.boolean().optional(),
  })
  .strict()

/** A conversation = segments of one chat less than SESSION_GAP_HOURS apart (SPEC §7 交互层). goldVersion 2. */
export const GoldConversationSchema = z
  .object({
    id: ItemId,
    startIdx: Idx,
    endIdx: Idx,
    /** the topics a summary of this conversation must cover */
    topics: z.array(z.string().min(1).max(30)).min(1),
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
    goldVersion: z.union([z.literal(1), z.literal(2)]),
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
    // ---- interaction (goldVersion 2, additive). Absent ≠ empty: a file without the key is not annotated for that
    // type and is left out of the interaction metrics entirely (§7.4, DECISIONS eval-synthetic E21).
    loops: z.array(GoldLoopSchema).optional(),
    conversations: z.array(GoldConversationSchema).optional(),
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
export type GoldLoop = z.infer<typeof GoldLoopSchema>
export type GoldConversation = z.infer<typeof GoldConversationSchema>
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
