import { z } from 'zod'
import { Id } from '../common'
import { PersonRefDTOSchema } from '../entities'
import { InteractionSearchHitSchema } from './interaction'

export const SearchTypesSchema = z.enum(['all', 'people', 'claims', 'interaction'])
export type SearchTypes = z.infer<typeof SearchTypesSchema>

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  types: SearchTypesSchema.optional(),
})
export type SearchQuery = z.infer<typeof SearchQuerySchema>

export const SearchResponseSchema = z.object({
  q: z.string(),
  people: z.array(z.object({ person: PersonRefDTOSchema, matchedAlias: z.string().nullable() })),
  claims: z.array(
    z.object({
      person: PersonRefDTOSchema,
      claimId: Id,
      statement: z.string(),
      highlights: z.array(z.tuple([z.number().int(), z.number().int()])),
    }),
  ),
  /** SPEC §9.8「来往」: segment summaries and loop texts. Last group — it matches more loosely than the others. */
  interaction: z.array(InteractionSearchHitSchema),
})
export type SearchResponse = z.infer<typeof SearchResponseSchema>
