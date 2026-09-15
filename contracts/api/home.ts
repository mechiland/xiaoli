import { z } from 'zod'
import { DayString, Id } from '../common'
import { ClaimDTOSchema, PersonRefDTOSchema } from '../entities'
import { RecentImportSchema } from './imports'
import { PeopleIndexResponseSchema } from './people'

export const HomeResponseSchema = z.object({
  isEmpty: z.boolean(),
  needsOnboarding: z.boolean(),
  upcoming: z.array(
    z.object({
      person: PersonRefDTOSchema,
      dateId: Id,
      label: z.string(),
      solar: DayString,
      lunarLabel: z.string().nullable(),
      days: z.number().int().nonnegative(),
    }),
  ),
  recentlyUpdated: z.array(
    z.object({ person: PersonRefDTOSchema, latest: ClaimDTOSchema.pick({ id: true, statement: true, category: true }) }),
  ),
  pinned: z.array(PersonRefDTOSchema),
  index: PeopleIndexResponseSchema,
  /** last 5 with status ≠ 'mapping' */
  recentImports: z.array(RecentImportSchema),
})
export type HomeResponse = z.infer<typeof HomeResponseSchema>
