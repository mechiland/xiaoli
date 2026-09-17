import { z } from 'zod'
import { DayString, Id, LoopDirection, LoopKind } from '../common'
import { ClaimDTOSchema, PersonRefDTOSchema } from '../entities'
import { RecentImportSchema } from './imports'
import { PeopleIndexResponseSchema } from './people'

export const HomeResponseSchema = z.object({
  isEmpty: z.boolean(),
  needsOnboarding: z.boolean(),
  /** Important dates and dated open matters, sorted together by solar day. */
  upcoming: z.array(
    z.object({
      person: PersonRefDTOSchema,
      kind: z.enum(['date', 'plan', 'loop']),
      /** set when kind = 'date' */
      dateId: Id.nullable(),
      /** set for plans and other unfinished matters */
      loopId: Id.nullable(),
      loopKind: LoopKind.optional(),
      direction: LoopDirection.optional(),
      status: z.enum(['proposed', 'confirmed']).optional(),
      /** Original precision; a month-level date must not be presented as an exact deadline. */
      dueAt: z.string().optional(),
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
