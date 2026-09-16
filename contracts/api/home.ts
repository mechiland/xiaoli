import { z } from 'zod'
import { DayString, Id } from '../common'
import { ClaimDTOSchema, PersonRefDTOSchema } from '../entities'
import { RecentImportSchema } from './imports'
import { PeopleIndexResponseSchema } from './people'

export const HomeResponseSchema = z.object({
  isEmpty: z.boolean(),
  needsOnboarding: z.boolean(),
  /** important dates and, from SPEC §9.4, plan loops with a dueAt — sorted together by `solar` asc */
  upcoming: z.array(
    z.object({
      person: PersonRefDTOSchema,
      kind: z.enum(['date', 'plan']),
      /** set when kind = 'date' */
      dateId: Id.nullable(),
      /** set when kind = 'plan' */
      loopId: Id.nullable(),
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
