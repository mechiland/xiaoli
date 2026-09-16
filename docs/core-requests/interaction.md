# core requests — interaction

## 1. `owned()` does not accept the interaction tables (core, `server/db/owned.ts`)

**Observed**: `owned(loops, ownerId, …)`, `owned(conversationSegments, …)` and `owned(segmentParticipants, …)` do not typecheck. `OwnedTable` lists the wave-1/2 entity tables and `OwnedLinkTable` the four wave-1/2 link tables; the three tables added for the interaction layer in `server/db/schema/interaction.ts` were never added to either union. The same applies to `withOwner<typeof loops>` and `getOwnedOr404(db, loops, …)`.

**Ask**: add `typeof schema.loops` and `typeof schema.conversationSegments` to `OwnedTable`, and `typeof schema.segmentParticipants` to `OwnedLinkTable`.

**Resolved during the same round**: `server/db/owned.ts` now lists `conversationSegments` / `loops` in `OwnedTable` and `segmentParticipants` in `OwnedLinkTable`. The temporary wrapper interaction had written was removed; every query in `server/interaction/**` calls core's `owned()` directly.

- status: resolved (no action needed)

## 2. Search's pure text helpers are not on its public entry (search, `server/search/index.ts`)

**Observed**: `server/search/text.ts` (`normalize`, `normalizeQuery`, `splitTerms`, `likeContains`, `highlightRanges`) is exactly what the 来往 group of the overlay needs so its highlight ranges line up with the 人物 and 信息 groups, but `@/server/search` only exports `searchAll` and `listPeopleIndex`, and cross-module deep imports are banned (ARCHITECTURE §0).

**Ask**: re-export those five from `@/server/search` (the file already says it has no server/DB imports and is used from the client).

**Until then**: `server/interaction/text.ts` is a copy (it also means the two groups can silently disagree about what "matched"). It should be collapsed as soon as the export exists.

- status: **done** (integrator, 2026-09-16). `@/server/search` now re-exports `normalize`, `normalizeQuery`, `splitTerms`, `likeContains`, `highlightRanges`; `server/interaction/text.ts` is a one-line re-export of them. One matching rule for all three overlay groups.

## 3. `InteractionSection` needs the person page's footnote number to continue (integrator mount)

**Observed**: `EvidenceMark`'s `index` is documented as page-scoped and 1-based in render order, and the person page computes it with `numberMarks(profile)` — which knows about claims, relations, dates, events and handles, but not about loops (the 来往 section fetches its own data). Mounted as `<InteractionSection personId={p.person.id} />`, the loops restart the footnote numbering at 1, so a person page can show two different "¹".

**Ask**: pass the continuation when mounting, e.g. `<InteractionSection personId={p.person.id} markStart={markCount(p) + 1} />`, where `markCount` is the number `numberMarks` handed out (person would need to expose it — one extra return value).

**Until then**: `InteractionSection` takes an optional `markStart` (default 1) and every mark inside the section is numbered from it, so the section is internally consistent and the fix is a one-line mount change.

- status: **done** (integrator, 2026-09-16). `numberMarks` now returns a `MarkFn` carrying `count`, and the mount passes `markStart={markOf.count + 1}`. Loop numbers therefore follow 历史/别名 rather than sitting strictly where the section renders — the same pragmatic ordering `numberMarks` already uses for 别名; noted in its doc comment.

## 4. `deleteImport` must reopen loops closed by deleted messages (import, ARCHITECTURE §11 step 7)

**Note, not a blocker**: interaction derives `state` from `closed_message_id` / `closed_reason`, so "the sentence that closed it is gone → the item is open again" is automatic *once those columns are cleared*. Clearing them (and recomputing / deleting segments) is `server/import/delete.ts`'s step 7, which interaction does not own and, as of this round, `server/import/delete.ts` does not implement (its `TargetType` maps still list only the five wave-2 types, which is also why it does not typecheck against the widened `TargetType`).

**Ask**: implement §11 step 7 in import's round, and cover it with the SPEC M7 acceptance (reverse-order import, delete-reopen). `loopState()` and its unit tests are ready for it: `server/interaction/__tests__/pure.test.ts` asserts that a loop with `closedMessageId: null, closedReason: null` reads `open` again.

**Resolved during the same round**: `server/import/delete.ts` now deletes segments whose evidence is entirely in M, drops their `segment_participants`, and clears `closed_message_id` / `closed_at` / `closed_reason` for every loop closed by a deleted message (`server/import/delete-interaction.test.ts`).

- status: resolved (no action needed)

## 5. Two copies of the loop-state derivation (review, `server/review/loops.ts`)

**Observed**: ARCHITECTURE §1.17 gives interaction the loop-state derivation, but review (wave 2) cannot import a wave-5 module and needs the same rule for the LoopDTOs in `GET /api/imports/:id/review`, so it wrote its own `deriveLoop` / `dueDay`. Its own comment says interaction should import `dueDay` "rather than re-deriving it" — but neither function is exported from `@/server/review`, and deep imports are banned (ARCHITECTURE §0).

Two copies of `expired` is not a style problem: the import result page and the person page would disagree about the same row at the threshold. (They already did for one round: review used `> 14`, interaction `>= 14`. Interaction has been changed to match review — `> LOOP_EXPIRY_DAYS_WITH_DUE`, threshold day not yet expired — and now also stops `daysOpen` at `closedAt` the way review does.)

**Ask** (either works):
- (a) export `deriveLoop` and `dueDay` from `@/server/review`; interaction deletes `server/interaction/loop-state.ts`'s body and re-exports them, keeping its own tests as the shared contract's test suite; or
- (b) move the derivation into a wave-1 shared place (`lib/` or `contracts/`) that both import.

Until then both copies must be changed together; `server/interaction/__tests__/pure.test.ts` pins the boundary (14 days → not expired, 15 → expired; 90 → not expired, 91 → expired) so a future divergence fails a test.

- status: **done** (integrator, 2026-09-16), by option (b). The derivation moved to `lib/loop-state.ts` (wave 1, pure): `deriveLoop`, `dueDay`, `dueDayStart`, `daysPastDue`, `dayOf`. `server/review/loops.ts` and `server/interaction/loop-state.ts` are now thin re-exports, so there is one definition and the boundary cannot drift again. Both modules' tests still pass unchanged (86 tests).
