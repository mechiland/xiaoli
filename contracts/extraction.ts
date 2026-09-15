import { z } from 'zod'
import { Category, Id } from './common'

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
