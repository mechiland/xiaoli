import { z } from 'zod'
import { Category, Id, LoopCloseReason, LoopDirection, LoopKind } from './common'

// Extraction output (ARCHITECTURE §2.5, SPEC §8.6). Strict.

export const PersonRefSchema = z.union([
  z.object({ personId: Id }).strict(),
  z.object({ tempId: z.string().min(1).max(40) }).strict(),
])
export type PersonRef = z.infer<typeof PersonRefSchema>

/** window-local seq numbers (§6) */
export const EvidenceSchema = z.array(z.number().int().nonnegative()).min(1)
export type Evidence = z.infer<typeof EvidenceSchema>

export const ExtractionOutputSchema = z
  .object({
    newPersons: z
      .array(z.object({ tempId: z.string(), label: z.string().min(1).max(60), evidence: EvidenceSchema }).strict())
      .default([]),
    handles: z
      .array(
        z
          .object({
            person: PersonRefSchema,
            kind: z.enum(['mentioned', 'real_name', 'address_term']),
            value: z.string().min(1).max(60),
            evidence: EvidenceSchema,
          })
          .strict(),
      )
      .default([]),
    relations: z
      .array(
        z
          .object({
            from: PersonRefSchema,
            to: PersonRefSchema,
            type: z.string().min(1).max(30),
            label: z.string().max(30).optional(),
            evidence: EvidenceSchema,
          })
          .strict(),
      )
      .default([]),
    claims: z
      .array(
        z
          .object({
            person: PersonRefSchema,
            statement: z.string().min(2).max(200),
            category: Category,
            validFrom: z.string().max(20).optional(),
            confidence: z.number().min(0).max(1),
            sensitive: z.boolean(),
            supersedesClaimId: Id.optional(),
            evidence: EvidenceSchema,
          })
          .strict(),
      )
      .default([]),
    events: z
      .array(
        z
          .object({
            summary: z.string().min(2).max(200),
            happenedAt: z.string().max(20).optional(),
            place: z.string().max(60).optional(),
            participants: z.array(PersonRefSchema).min(1),
            evidence: EvidenceSchema,
          })
          .strict(),
      )
      .default([]),
    dates: z
      .array(
        z
          .object({
            person: PersonRefSchema,
            kind: z.string().min(1).max(20),
            day: z.number().int().min(1).max(31).optional(),
            month: z.number().int().min(1).max(12).optional(),
            year: z.number().int().optional(),
            calendar: z.enum(['solar', 'lunar']),
            isLeapMonth: z.boolean().optional(),
            evidence: EvidenceSchema,
          })
          .strict(),
      )
      .default([]),
  })
  .strict()
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>

/**
 * Interaction layer output (SPEC §8.8) — a SEPARATE model call from `ExtractionOutputSchema`, issued in parallel
 * over the same window.
 *
 * It used to be three extra sections on the extraction output. Measured on the same 4 synthetic zips with the same
 * frozen gold, that cost the extraction its gates: claims precision 0.90 → 0.76, claims recall 0.77 → 0.66, handles
 * 1.00 → 0.875, transactional-as-claim 0.04 → 0.073, while claims COUNT rose 50 → 55 — the model was not routing
 * momentary content away, it was doing its original job worse with three more tasks in the same call. Splitting the
 * call is the fix (DECISIONS I15, I17; it overturns I6, whose "no second call" argument was about latency, not quality).
 */
export const InteractionOutputSchema = z
  .object({
    segment: z
      .object({
        summary: z.string().min(4).max(300),
        topics: z.array(z.string().min(1).max(20)).max(6).default([]),
        speakers: z.array(PersonRefSchema).default([]),
        evidence: EvidenceSchema,
      })
      .strict()
      .nullable()
      .default(null),
    loops: z
      .array(
        z
          .object({
            person: PersonRefSchema,
            direction: LoopDirection,
            kind: LoopKind,
            text: z.string().min(2).max(200),
            dueAt: z.string().max(20).optional(),
            evidence: EvidenceSchema,
          })
          .strict(),
      )
      .default([]),
    closes: z
      .array(z.object({ loopId: Id, reason: LoopCloseReason, evidence: EvidenceSchema }).strict())
      .default([]),
  })
  .strict()
export type InteractionOutput = z.infer<typeof InteractionOutputSchema>

export const DedupOutputSchema = z
  .object({
    duplicates: z.array(z.object({ newIndex: z.number().int(), existingClaimId: Id })).default([]),
  })
  .strict()
export type DedupOutput = z.infer<typeof DedupOutputSchema>

/** Prompt-guided vocabularies (not enforced). */
export const RELATION_TYPES = [
  'parent',
  'child',
  'spouse',
  'sibling',
  'relative',
  'friend',
  'colleague',
  'classmate',
  'service_provider',
  'client',
  'other',
] as const
export const DATE_KINDS = ['birthday', 'anniversary', 'memorial', 'other'] as const
