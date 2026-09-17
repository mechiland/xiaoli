import { z } from 'zod'
import { Category, HandleKind, Id, MsgTime, PartialDate, TargetType } from '../common'
import {
  CalendarSchema,
  ChatDTOSchema,
  ClaimDTOSchema,
  EventDTOSchema,
  HandleDTOSchema,
  ImportantDateDTOSchema,
  PersonDTOSchema,
  PersonRefDTOSchema,
  RelationDTOSchema,
} from '../entities'

export const PeopleIndexQuerySchema = z.object({ index: z.literal('pinyin').optional() })
export type PeopleIndexQuery = z.infer<typeof PeopleIndexQuerySchema>

export const PeopleIndexResponseSchema = z.object({
  groups: z.array(
    z.object({ letter: z.string(), people: z.array(PersonRefDTOSchema.extend({ pinned: z.boolean() })) }),
  ),
  total: z.number().int().nonnegative(),
})
export type PeopleIndexResponse = z.infer<typeof PeopleIndexResponseSchema>

export const CreatePersonRequestSchema = z.object({ label: z.string().trim().min(1).max(60) })
export type CreatePersonRequest = z.infer<typeof CreatePersonRequestSchema>
export const PersonResponseSchema = z.object({ person: PersonDTOSchema })
export type PersonResponse = z.infer<typeof PersonResponseSchema>

export const ProfileResponseSchema = z.object({
  person: PersonDTOSchema,
  aliases: z.array(z.object({ kind: HandleKind, items: z.array(HandleDTOSchema) })),
  infobox: z.object({
    relationToMe: z.object({ value: z.string(), relationId: Id }).nullable(),
    city: z.object({ value: z.string(), claimId: Id }).nullable(),
    work: z.object({ value: z.string(), claimId: Id }).nullable(),
    school: z.object({ value: z.string(), claimId: Id }).nullable(),
    birthday: ImportantDateDTOSchema.nullable(),
    otherDates: z.array(ImportantDateDTOSchema),
    chats: z.array(
      z.object({
        chat: ChatDTOSchema.pick({ id: true, title: true, kind: true }),
        messageCount: z.number().int().nonnegative(),
        lastMessageAt: MsgTime.nullable(),
      }),
    ),
    lastContactAt: MsgTime.nullable(),
  }),
  /** confirmed + proposed */
  sections: z.array(z.object({ category: Category, claims: z.array(ClaimDTOSchema) })),
  relations: z.array(RelationDTOSchema),
  events: z.array(EventDTOSchema),
  /** superseded + outdated + edited-before, desc */
  history: z.array(ClaimDTOSchema),
})
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>

export const ProfileRedirectResponseSchema = z.object({ redirectTo: Id })
export type ProfileRedirectResponse = z.infer<typeof ProfileRedirectResponseSchema>

export const PatchPersonRequestSchema = z
  .object({ label: z.string().trim().min(1).max(60).optional(), pinned: z.boolean().optional() })
  .strict()
export type PatchPersonRequest = z.infer<typeof PatchPersonRequestSchema>

export const DeletePersonResponseSchema = z.object({ deleted: z.literal(true) })
export type DeletePersonResponse = z.infer<typeof DeletePersonResponseSchema>

export const MergePersonRequestSchema = z.object({ intoId: Id })
export type MergePersonRequest = z.infer<typeof MergePersonRequestSchema>
export const MergePersonResponseSchema = z.object({
  /** the target */
  person: PersonDTOSchema,
  moved: z.record(TargetType, z.number().int().nonnegative()),
})
export type MergePersonResponse = z.infer<typeof MergePersonResponseSchema>

export const SplitPersonRequestSchema = z.object({
  handleId: Id,
  into: z
    .union([
      z.object({ personId: Id }),
      z.object({ newPerson: z.object({ label: z.string().trim().min(1).max(60) }) }),
    ])
    .optional(),
})
export type SplitPersonRequest = z.infer<typeof SplitPersonRequestSchema>
export const SplitPersonResponseSchema = z.object({
  person: PersonDTOSchema,
  movedEvidenceCandidates: z.array(z.object({ targetType: TargetType, targetId: Id })),
})
export type SplitPersonResponse = z.infer<typeof SplitPersonResponseSchema>

export const AddClaimRequestSchema = z.object({
  statement: z.string().trim().min(1).max(500),
  category: Category,
  validFrom: PartialDate.optional(),
})
export type AddClaimRequest = z.infer<typeof AddClaimRequestSchema>
export const AddClaimResponseSchema = z.object({ claim: ClaimDTOSchema })

export const AddDateRequestSchema = z.object({
  kind: z.string().min(1).max(20),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  year: z.number().int().optional(),
  calendar: CalendarSchema,
  isLeapMonth: z.boolean().optional(),
  label: z.string().max(40).optional(),
})
export type AddDateRequest = z.infer<typeof AddDateRequestSchema>
export const AddDateResponseSchema = z.object({ date: ImportantDateDTOSchema })

export const AddRelationRequestSchema = z.object({
  toPersonId: Id,
  type: z.string().min(1).max(30),
  label: z.string().max(30).optional(),
})
export type AddRelationRequest = z.infer<typeof AddRelationRequestSchema>
export const AddRelationResponseSchema = z.object({ relation: RelationDTOSchema })

export const AddEventRequestSchema = z.object({
  summary: z.string().trim().min(1).max(200),
  happenedAt: PartialDate.optional(),
  place: z.string().max(60).optional(),
  participantIds: z.array(Id),
})
export type AddEventRequest = z.infer<typeof AddEventRequestSchema>
export const AddEventResponseSchema = z.object({ event: EventDTOSchema })

