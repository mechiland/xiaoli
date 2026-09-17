# Core requests — review

## #1 Contracts: the `loop` variant of a review item, and the loop fields of a review patch
- status: **done** (integrator, 2026-09-16). All four landed. `patch.dueAt` is `PartialDate.nullable().optional()` as requested, `patch.text` max 300. Remove the `LoopReviewItem`/`ReviewPatch`/`asItem()` workarounds and test loop `edit` over HTTP.
- requested-by: review, wave 5, 2026-09-16
- kind: contract
- paths: `contracts/api/imports.ts`, `contracts/api/review.ts`
- change: ARCHITECTURE §2.4 already specifies all four; `TargetType`, `LoopDTOSchema` and `LOOP_EXPIRY_*` landed in wave 5, these did not.
  1. `ReviewItemSchema`: add `z.object({ type: z.literal('loop'), item: LoopDTOSchema })` to the discriminated union.
  2. `ImportReviewSectionSchema`: add `loops: z.array(ReviewItemSchema)` (SPEC §9.9 未结事项 group).
  3. `ReviewRequestSchema.patch`: add `text: z.string().trim().min(1).max(300).optional()`, `dueAt: PartialDate.nullable().optional()` (null clears the due date), `kind: LoopKind.optional()`, `direction: LoopDirection.optional()`.
  4. `ReviewResponseSchema.item`: add `LoopDTOSchema` to the union.
- why: `applyReview(db, ownerId, {type:'loop', id}, …)` and `getImportReview` are implemented and tested, and their JSON is already the ARCHITECTURE §2.4 shape. Without (3) the zod validator on `POST /api/review/:type/:id` strips the loop fields from the body, so an `edit` over HTTP answers 400 `没有要修改的内容` — **the 未结事项 改写 button on the import result page cannot work until this lands**. (1), (2) and (4) are type-level only: the response bodies are already correct, but import-result cannot read `sections[].loops` in a typed way.
- workaround: in `server/review` — `type LoopReviewItem` + `Section & { loops }` in `import-review.ts`, `ReviewPatch = NonNullable<ReviewRequest['patch']> & {text?, dueAt?, kind?, direction?}` and `asItem()` in `actions.ts`. All three are commented with this request number; delete them and the `as` casts when it lands. Loop `edit` is covered by a test that calls `applyReview` directly, because the route cannot carry the patch yet.
- blocking: yes for import-result's 未结事项 group (typed read) and for loop 改写 over HTTP; no for accept / reject / delete, which work today.
- Landed (coordinator, wave 5, 2026-09-16); review removed the workaround the same day: `LoopReviewItem`, the widened `ReviewPatch`, the `Section & { loops }` alias and `asItem()` are gone, `import-review.ts` narrows on `type === 'loop'` before reading `openedAt`, and loop `edit` now has a test that goes through the route.

## #2 `owned()` / `withOwner()` / `withOwnerLink()` do not accept the interaction tables
- status: **done** (integrator, 2026-09-16). `OwnedTable` gained `conversationSegments` + `loops`, `OwnedLinkTable` gained `segmentParticipants`. Delete the wrappers in `server/review/util.ts` and `server/import/delete.ts` and import from `@/server/db`.
- requested-by: review, wave 5, 2026-09-16
- kind: contract
- paths: `server/db/owned.ts`
- change: add `typeof schema.conversationSegments` and `typeof schema.loops` to `OwnedTable`, and `typeof schema.segmentParticipants` to `OwnedLinkTable`.
- why: every owner-scoped query on the three new tables is a type error today, and ARCHITECTURE §3 requires every business query to go through `owned()`. `getOwnedOr404`, `withOwner` and `withOwnerLink` are constrained by the same two unions, so inserts do not typecheck either. This hits every module that touches the interaction layer (interaction, extract, search, home, person, settings), not only review.
- workaround: a delegating wrapper with the wider parameter type — `owned` / `withOwnerRow` / `withOwnerLinkRow` in `server/review/util.ts`, and a local `owned` in `server/import/delete.ts`. It calls core's `owned()`, so the scoping rule is unchanged and `server/db/owned.lint.test.ts` still passes. When core widens the unions, delete both wrappers and switch those imports back to `@/server/db`.
- blocking: no (the wrappers work), but it should not be left to every module to re-invent.
- Landed (coordinator, wave 5, 2026-09-16); review removed both wrappers the same day and imports `owned` / `withOwner` / `withOwnerLink` from `@/server/db` everywhere again. `server/db/owned.lint.test.ts` still passes.

## #3 `deletePerson` must delete the person's loops and their `segment_participants` rows
- status: **done** (integrator, 2026-09-16). Implemented exactly as specified in `server/person/delete.ts`: loop evidence before loops, `segment_participants` dropped, segments kept and not recomputed, loop importIds added to the `syncImportStatus` sweep. Needs a test in `server/person/**`.
- requested-by: review, wave 5, 2026-09-16
- kind: other (person-owned: `server/person/delete.ts`, `deletePerson`)
- paths: `server/person/delete.ts`, `server/person/**` tests
- change: ARCHITECTURE §11 **Delete person** now also covers the interaction layer. In the same batched, ordered delete:
  1. `evidence` rows with `target_type = 'loop'` and `target_id` in this person's loops — before the loops themselves, so an interrupted delete never leaves evidence pointing at nothing.
  2. `loops` with `person_id = :id`. A loop belongs to one person, exactly like a claim, so it goes with them. Loops of *other* persons that happen to be opened or closed by a message this person sent are untouched (the message stays; only `sender_handle_id` is nulled).
  3. `segment_participants` with `person_id = :id`.
  4. **`conversation_segments` are kept.** A 段落 belongs to a chat, not to a person (SPEC §7 删除语义: "段落不属于任何人，保留，只删 segmentParticipants 行"). Do not recompute `message_count` either: the messages are all still there, only the person record is gone.
  Persons with `merged_into_id = :id` are deleted too, so their loops and participant rows follow the same path. `review_log` rows stay, as for every other type.
- why: `loops.person_id` and `segment_participants.person_id` are FK `on delete cascade`, so the rows would vanish anyway — but their `evidence` rows would not, leaving orphans that `GET /api/evidence/loop/:id` and the delete-all counters would still see. The evidence delete has to be explicit.
- workaround: none available from review; `server/person/**` is person's. Nothing in review depends on it.
- blocking: no
- Landed (coordinator, wave 5, 2026-09-16) in `server/person/delete.ts`, as specified, plus the loops' `importId`s folded into the `syncImportStatus` sweep. Review does not touch that file.
