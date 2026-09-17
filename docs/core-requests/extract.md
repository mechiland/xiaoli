# Core requests — extract

## #1 Script aliases for prompt generation and failure cassettes
- status: done
- requested-by: extract, round 1, 2026-09-15
- kind: config
- paths: package.json
- change: add `"extract:gen-prompts": "tsx scripts/run-owned.ts server/extract/scripts/gen-prompts.ts extract --"` and `"extract:cassettes": "tsx scripts/run-owned.ts server/extract/__fixtures__/build-cassettes.ts extract --"`
- why: every prompt change must regenerate `server/extract/prompts.generated.ts` (Workers cannot read `prompts/*.md` at runtime, DECISIONS ## extract X1), and rendering changes must regenerate the hand-written failure cassettes (X15). Tests fail when either is stale; a discoverable command helps the next prompt version.
- workaround: `node --import tsx server/extract/scripts/gen-prompts.ts` and `node --import tsx server/extract/__fixtures__/build-cassettes.ts`
- blocking: no
- Resolution (integrator, wave 2, 2026-09-15): Added both scripts to package.json exactly as requested (routed through run-owned). Usage `pnpm extract:gen-prompts` / `pnpm extract:cassettes`.

## #2 Record the additive extract contract details in ARCHITECTURE §6
- status: done
- requested-by: extract, round 1, 2026-09-15
- kind: contract
- paths: ARCHITECTURE.md §6
- change: (a) `WindowInput.messages[].context?: boolean` (existing message outside the new range; prompt marks it, items resting only on context are dropped); (b) `validateOutput` drop reasons also include `invalid_item | context_only | self_loop`; (c) `WindowOutcome` carries optional `raw`, `attemptMs`, `usage` (on errors too), `sensitiveRewritten`, `dropped`; (d) `renderExtractPrompt(input, version?)` takes an optional prompt version (eval `--prompt/--compare`). Shapes of the required fields are unchanged.
- why: keeps the binding document in line with what `@/server/extract` exports; no other module needs to change.
- workaround: documented in DECISIONS ## extract X3, X4, X12
- blocking: no
- Resolution (integrator, wave 2, 2026-09-15): ARCHITECTURE §6 updated to match `server/extract/types.ts`: `WindowInput.messages[].context?: boolean`; drop reasons add `invalid_item | context_only | self_loop`; `WindowOutcome` done branch adds optional `raw`, `attemptMs`, `sensitiveRewritten`, `dropped`, error branch adds optional `raw`, `usage`, `attemptMs`; `renderExtractPrompt(input, version?)`. Additive only; no other module affected.

## #3 Record window packing and the round-2 validation rules in ARCHITECTURE §6
- status: done
- requested-by: extract, round 2, 2026-09-15
- kind: contract (documentation only)
- paths: ARCHITECTURE.md §6
- change:
  (a) Windowing: add `packWindows(plans, msgs, maxMessages): WindowPlan[]` (exported from `@/server/extract`) and `promptFeatures(version): { packMaxMessages: number | null; gapMarkers: boolean }` (server/extract/prompt-version.ts). From `extract.v4` on, `createJobsForImport` and `extractOffline` pack consecutive plans into one window when the second plan starts at the message right after the first ends and the merged span holds ≤ 40 messages. Sessions (> 3 h gap), the 150/20 split of long sessions and the ±20 context are unchanged; overlapping or non-adjacent plans are never merged. From `extract.v4` on the prompt shows a `—— 间隔约N小时/天，以下是新的一段对话 ——` line between messages more than 3 h apart. `extract.v1–v3` keep one window per plan and the old rendering, so their cassettes replay unchanged.
  (b) `validateOutput`:
    - `unknown_supersedes` also covers a `supersedesClaimId` that belongs to another person's confirmed claim.
    - `invalid_item` also covers an `other` relation with no label or with a person's name as its label, and a solar date next to a lunar date of the same person and kind resting on the same messages.
    - parent/child relations with an extended-kin label (爷/奶/外公/外婆/姥/孙/叔/伯/姑/舅/姨/婶/侄/表/堂/亲家/公公/婆婆/岳) are typed `relative`.
    - a claim contained in a more specific claim about the same person in the same window merges into it.
  (c) Sensitive guard:
    - new-person labels are neutralised (sensitive digits and address parts cut out), or the person is dropped together with its items;
    - a mobile number becomes "提供过手机号"; other phone numbers keep "提供过联系方式".
- why: SPEC §8.5 only fixes sessions and the 150/20 split. With one call per 3-hour session the synthetic eval made 180 calls for 804 messages (median 4 messages per call, about 95 % of input tokens were the repeated system prompt). A full eval cost about 0.65 M tokens, more than one loop's remaining budget allowed. Packed windows cut that to about 27 calls (about 0.16 M) and give the model the earlier conversation for person resolution. The in-app deadline is unaffected: 40-message windows produce well under 1 000 output tokens at about 250 tokens/s.
- workaround: implemented inside server/extract; recorded in DECISIONS ## extract X20–X23
- blocking: no
- Resolution (integrator, wave 2, 2026-09-15): ARCHITECTURE §6 updated (text only): `packWindows` and `promptFeatures` signatures in the code block; new paragraphs "Window packing & gap markers" (X20) and "`validateOutput` rules beyond the schema" (X21); sensitive guard paragraph adds 提供过手机号 for mobiles and new-person label neutralisation/drop. Checked against `server/extract/{windowing,prompt-version,index}.ts`. No other module affected.

## #4 Record the round-3 validation rules and drop reasons in ARCHITECTURE §6
- status: done
- requested-by: extract, round 3, 2026-09-15
- kind: contract (documentation only)
- paths: ARCHITECTURE.md §6
- change:
  (a) `DropReason` (server/extract/types.ts) adds `low_confidence | momentary | ambiguous_handle | redundant` (additive).
  (b) Extend the paragraph "`validateOutput` rules beyond the schema":
    - `address_term` handles whose value is a parent/child vocative (爸/爸爸/老爸/爹/妈/妈妈/老妈/娘/儿子/女儿/闺女/儿) are dropped in group chats (`ambiguous_handle`); private chats keep them.
    - claims below confidence 0.85 are dropped (`low_confidence`); statements with a momentary time word (这两天/今天/明天/刚才/这周…) or a leading 将/将要/即将/准备/打算 are dropped (`momentary`).
    - the generic student status ("在上学，是学生") is dropped (`redundant`) next to a grade or class of the same person (window, confirmed claims, or — in `extractWindow` — this import's proposed claims), or when none of its evidence messages mentions schooling.
    - an `other` relation is invalid when its label contains either person's name (was: equals); a claim of `from` with that label as statement on the same messages is dropped with it.
    - a claim starting with 儿子/女儿/孩子 moves to the child when the window has exactly one parent/child relation from that person.
  (c) §7 note (optional): `server/extract/scripts/eval-fill.ts` is a top-up eval that replays extract cassettes and records only dedup/judge misses, for pipeline changes that keep extract requests unchanged.
- why: keeps the binding document in line with `@/server/extract` after the round-3 precision fixes; no other module is affected (DropReason is only used inside server/extract).
- workaround: implemented inside server/extract; recorded in DECISIONS ## extract X26, X27
- blocking: no
- Resolution (integrator, wave 2, 2026-09-15): ARCHITECTURE §6 updated (text only): `validateOutput` drop reasons add `low_confidence | momentary | ambiguous_handle | redundant`; new "Round-3 rules" sentence after the round-2 rules paragraph covers group-chat vocative handles, the 0.85 confidence floor, momentary statements, redundant student status, `other` label containing a name (plus the duplicate claim), and moving 儿子/女儿/孩子 claims to the child. §7.5 has a note on `server/extract/scripts/eval-fill.ts`. Checked against `server/extract/types.ts` and DECISIONS X26/X27. No other module affected.

## #5 Record extract.v7 and its version-bound validation rules in ARCHITECTURE §6/§7.5
- status: done
- requested-by: extract, overall critic fix round 2, 2026-09-16
- kind: contract (documentation only)
- paths: ARCHITECTURE.md §6 (promptFeatures signature, validateOutput rules), §7.5 (eval-fill note)
- change:
  (a) `promptFeatures(version)` returns `{ packMaxMessages, gapMarkers, milestoneRules }`; `milestoneRules` is true from `extract.v7`. `validateOutput(json, input, opts?: { milestoneRules?: boolean })`; `extractWindow` passes `promptFeatures(version).milestoneRules`. Earlier versions validate exactly as before (extract.v5 replay identical to report `20260915-171445`).
  (b) Rules applied only with `milestoneRules` (DECISIONS ## extract X30):
    - private chat: a new person whose every `address_term` handle is said by self, in messages containing the term, resolves to the other sender;
    - group chat: a new person known only by `real_name` equal to its label (plus "提供过…" claims), with no relations, dates or events, is dropped with its items;
    - an `other` relation whose label is a partner word (伴侣/女朋友/男朋友/对象/恋人/未婚夫/未婚妻/老婆/老公/妻子/丈夫/爱人) is typed `spouse`;
    - an item whose evidence messages are all voice/image/video/sticker/video call/recall/transfer is dropped (`invalid_item`);
    - an event with a plan word (计划/打算/准备/将要/即将/明天/后天/下周/下个月/明年) or a `happenedAt` after the window's last message is dropped (`momentary`); a malformed `happenedAt` is removed.
  (c) §7.5 note: `server/extract/scripts/eval-fill.ts --allow-extract-misses` records extract calls only on cassette misses of the current prompt version (a rule that changes new persons changes later windows' known-person lists).
- why: extract.v7 (events for completed milestones, overall critic r2 #1) is registered with cassettes but is not `PROMPT_VERSION`; its rules must not change the outputs of the verified current version.
- workaround: implemented inside server/extract; recorded in DECISIONS ## extract X30
- blocking: no
- Resolution (integrator, wave 4, 2026-09-16): Done (text only). ARCHITECTURE §6: `promptFeatures` returns `milestoneRules` (true from extract.v7), `validateOutput(json, input, opts?: { milestoneRules?: boolean })`, and a new "extract.v7 rules" paragraph after the round-3 rules lists the five X30 rules. The word lists are copied from `server/extract/validate.ts`, which also has 女友/男友 and 下星期. §7.5 notes `--allow-extract-misses`. Checked against `server/extract/{prompt-version,validate,pipeline}.ts` and `scripts/eval-fill.ts`. No other module affected.

## #6 Record the item-level safe defaults and `DroppedItem.fields` in ARCHITECTURE §6
- status: done
- requested-by: extract, overall critic fix round 3, 2026-09-16
- kind: contract (documentation only)
- paths: ARCHITECTURE.md §6 (`validateOutput` rules; the X4 normalisation sentence "Before the strict parse …")
- change:
  (a) Before each item's strict parse, `validateOutput` applies safe defaults (all prompt versions): `claims.sensitive` missing → `false` (strings "true"/"false" → boolean; the sensitive guard still flags and rewrites matching statements); `dates.calendar` missing → `lunar` when an evidence message states a lunar date (农历/阴历/正月/腊月/"三月初八"-type), else `solar`; `newPersons.evidence` missing or empty → the in-window evidence of the items referencing that tempId. `confidence`, `category`, relation `type`, date `kind`, person refs, `participants` and item `evidence` get no default.
  (b) `DroppedItem` gains optional `fields: string[]` on schema `invalid_item` drops: field paths and zod issue codes (e.g. `sensitive:invalid_type`, `<key>:unrecognized_keys`), never values. `processNextJob` logs them per window (`level: 'warn'`, `msg: 'extract items dropped (invalid_item)'`, `{path, fields}` only).
  (c) §6/§7.5 note: `prompts/extract.v8.md` (= v7 + known-sender rule + partner words as spouse) is registered, not `PROMPT_VERSION`; `promptFeatures('extract.v8')` equals v7's.
- why: overall critic r3 #1 — a live claim without `sensitive` was dropped as `invalid_item`, losing a person's only education facts; the cassettes always carry the key, so eval could not show it.
- workaround: implemented inside server/extract; recorded in DECISIONS ## extract X31
- blocking: no
- Resolution (integrator, wave 4, 2026-09-16): Done (text only). ARCHITECTURE §6 has a new "Safe item defaults" paragraph after the extract.v7 rules, covering (a) the defaults and the non-defaulted fields, (b) `DroppedItem.fields` and the per-window warn log, and (c) extract.v8 registered with v7's `promptFeatures`. The code block adds `export interface DroppedItem { path; reason; fields? }`, and the `promptFeatures` comment notes v8. §7.5 notes that registered versions are run with `--prompt`. The requested "Before the strict parse" X4 sentence does not exist in ARCHITECTURE, so the text went in as a new paragraph. Checked against `server/extract/{validate,types,jobs,prompt-version}.ts`. Additive, no other module affected. DECISIONS integrator I19.

## #7 `owned()` / `withOwner()` do not accept the wave-5 interaction tables
- status: done (landed while this wave was in flight)
- requested-by: extract, wave 5 (interaction layer), 2026-09-16
- kind: contract (types in core-owned code)
- paths: server/db/owned.ts (`OwnedTable`, `OwnedLinkTable`)
- change: add `typeof schema.conversationSegments` and `typeof schema.loops` to `OwnedTable`, and `typeof schema.segmentParticipants` to `OwnedLinkTable`.
- why: `server/db/schema/interaction.ts` exists and is migrated (`drizzle/0002_swift_butterfly.sql`), but the two unions in `server/db/owned.ts` still list only the wave-1 tables. Every owner-scoped query on the interaction tables — `owned(loops, ownerId, …)` in `d1Store.loadWindow` / `findSimilarLoops` / `countProposed`, `owned(segmentParticipants, …)` for `lastContact` — fails to typecheck, and `withOwner<typeof loops>(…)` fails the same way in tests. The interaction module (§1.17) will hit exactly the same wall on every one of its reads.
- workaround: a local `ownedInteraction()` cast; **removed again** — core landed the two unions during this wave, and `server/extract/{d1-store,jobs,jobs.test}.ts` now call `owned()` / `withOwner<>()` directly.
- blocking: no
- Resolution (extract, wave 5, 2026-09-16): `server/db/owned.ts` now lists `conversationSegments` and `loops` in `OwnedTable` and `segmentParticipants` in `OwnedLinkTable`. Nothing left to do.

## #8 ARCHITECTURE wording for the interaction layer inside the extraction pipeline
- status: obsolete — superseded by #10 (extract, 2026-09-16). It described the interaction layer folded into the
  extraction call (`promptFeatures(...).interaction`, `validateOutput(..., { interaction })`, `PROMPT_VERSION =
  extract.v9`). That version measured worse than extract.v8 on the same frozen gold and was retired (DECISIONS I15,
  I17). Do not apply (a) or (f). (b)–(e) are still true and are repeated in #10.
- status-was: open
- requested-by: extract, wave 5 (interaction layer), 2026-09-16
- kind: contract (documentation only)
- paths: ARCHITECTURE.md §6 (promptFeatures signature, `WindowInput`/`LoadedWindow`, `validateOutput` opts, `ExtractStore`, `OfflineExtractionResult`)
- change:
  (a) `promptFeatures(version)` returns `{ packMaxMessages, gapMarkers, milestoneRules, interaction }`; `interaction` is true from `extract.v9`. `validateOutput(json, input, opts?: { milestoneRules?, interaction? })`; `extractWindow` passes both from the version.
  (b) `LoadedWindow` = `WindowInput & { seqMap; chatId: number; span: { startSeq; endSeq; startedAt; endedAt } }`. The span is the window's own first/last message `seq` and `sentAt`; it is the segment's natural key together with `chatId`.
  (c) `ExtractStore` gains optional `findSimilarLoops(personId, importId): Promise<{ id: number; text: string }[]>` — the loop dedup candidates that ride the one dedup call.
  (d) `ResolvedItems.loops` / `.closes` are required arrays (`segment` stays optional); their element shapes are `ResolvedLoop` / `ResolvedClose` in `server/extract/types.ts`.
  (e) `OfflineExtractionResult` gains `segments`, `loops`, `closes` with the shapes in `server/extract/memory-store.ts` (`OfflineItems`); message refs are parsed-export idx, and `closes[].loopIndex` points into `loops` the way a claim's `supersedes` points into `claims`.
  (f) `PROMPT_VERSION` is now `extract.v9` (see DECISIONS ## extract X33 for the eval consequence).
- why: §6 already describes the interaction extraction in prose; these are the exact signatures the code now has.
- workaround: implemented inside server/extract; recorded in DECISIONS ## extract X33
- blocking: no

## #9 `LlmPurposeSchema` has no value for the interaction call

**status: done** (integrator, 2026-09-16). `LlmPurposeSchema` and the `llm_calls.purpose` column enum both gained `interaction`; `INTERACTION_PURPOSE` now returns it. No migration (SQLite text enums are a TS-level constraint).
- status: open
- requested-by: extract, wave 5 fix round (the split), 2026-09-16
- kind: contract
- paths: contracts/llm.ts (`LlmPurposeSchema`), eval/src/entries.ts (the mirrored `LlmJsonRequest.purpose` union, eval-synthetic)
- change: add `'interaction'` to `z.enum(['extract', 'dedup', 'judge', 'other'])`, and the same literal to the mirror in `eval/src/entries.ts`.
- why: since the interaction layer became its own model call (ARCHITECTURE §6, DECISIONS I17), every window makes two model calls. `llm_calls.purpose` is what cost and latency are grouped by (`server/llm/usage.ts` `byPurpose`), so the second call needs a purpose of its own or its tokens are invisible next to the extraction call's. The enum is core-owned and the value is also validated on read: `CassetteSchema.purpose` is `LlmPurposeSchema`, so a hand-written cassette carrying `purpose: 'interaction'` fails to parse until the enum grows. `llm_calls.purpose` is a plain `text NOT NULL` column, so no migration is needed.
- workaround: **in place now** — `INTERACTION_PURPOSE` in `server/extract/prompt-version.ts` is `'other'`, which is still distinct from `extract` and `dedup`, and the call carries `promptVersion: 'interaction.v1'`, which identifies it exactly. Everything that needs to tell the two apart already does so by prompt version. Changing the constant to `'interaction'` is the only edit on extract's side once the enum lands; the hand-written cassettes then need one `pnpm extract:cassettes`.
- blocking: no (cost is readable today; the purpose name is just wrong)

## #10 ARCHITECTURE §6: the interaction layer is a second, parallel call (replaces the pending #8)

**status: done** (integrator, 2026-09-16). ARCHITECTURE §6 now documents the fourth `WindowOutcome.interaction` value `not_needed` and the attempt-clock rule for two concurrent calls (`latencyMs` sums the cost, `attemptMs` takes the max, because p95WindowMs is a wall-clock budget).
- status: open
- requested-by: extract, wave 5 fix round (the split), 2026-09-16
- kind: contract (documentation only)
- paths: ARCHITECTURE.md §6
- change: §6 already describes the split in prose (the "Interaction extraction" paragraph). These are the exact signatures the code now has, and they differ from #8, which described the folded-in version and is obsolete:
  (a) `promptFeatures(version)` returns `{ packMaxMessages, gapMarkers, milestoneRules }` — **no `interaction` flag**; `validateOutput(json, input, opts?: { milestoneRules?: boolean })` is back to its extract.v8 signature and behaviour, and `segment`/`loops`/`closes` fail it as unknown top-level keys like any other.
  (b) `ExtractDeps` gains `interactionPromptVersion?: string` (default `INTERACTION_PROMPT_VERSION`).
  (c) `WindowOutcome` (done branch) gains `interaction: 'ok' | 'skipped_deadline' | 'failed' | 'not_needed'`. **`not_needed` is a fourth value beyond the three §6 names**: it is the empty-window early return, where no call is made at all, and it matches `dedup`'s vocabulary.
  (d) `OfflineExtractionResult` gains `interactionPromptVersion: string` and `windows[].interaction?: string`; `extractOffline` gains `interactionPromptVersion?: string`.
  (e) Attempt time with two concurrent calls: the pair is charged **once, as `max`**, not as the sum — in `live`/`record` the window waited for the slower call, and in `replay` the recorded latencies of two calls that ran at the same time must not be added. §6's "Σ recorded `latencyMs` of the calls replayed in that attempt" now means Σ over *stages*, max within a stage. `WindowOutcome.latencyMs` still sums both calls: that is what they cost, not how long the window waited.
  (f) `ResolvedItems.loops` / `.closes` stay required arrays and `segment` optional; `ExtractStore.findSimilarLoops?` is unchanged; loop dedup still rides the one dedup call per window.
- why: keeps the binding document in line with `@/server/extract` after the split; no other module changes.
- workaround: implemented inside server/extract; recorded in DECISIONS ## extract X40–X44
- blocking: no

## #11 `tests/integration/m7-interaction.test.ts` still answers both calls with one JSON (routed to the interaction module)

**status: done** (integrator, 2026-09-16). `tests/integration/m7-interaction.test.ts` is integrator-owned; its fake model now dispatches on the prompt (the extraction call rejects unknown top-level keys, so one combined reply failed every window). 3/3 green again.
- status: open
- requested-by: extract, wave 5 fix round (the split), 2026-09-16
- kind: test fix in another module's file
- paths: tests/integration/m7-interaction.test.ts (untracked; not extract-owned)
- change: its `base` constant is `{ newPersons, handles, relations, claims, events, dates, segment: null, loops: [], closes: [] }` and its fake LLM answers every non-dedup request with it. A window is two calls now, so the extraction call gets `segment`/`loops`/`closes` — unknown top-level keys — and fails validation, and the interaction call gets the six extraction keys and fails too. Fix: branch on the request, e.g. `const isInteraction = (req) => req.promptVersion.startsWith('interaction.')`, answer it with `{ segment, loops, closes }` and answer the extraction call with the six-key object. `opensLoop` / `closesLoop` become interaction answers; `closesLoop` keeps parsing the loop id out of the rendered prompt, which is now the **interaction** prompt (`server/extract/prompt.ts` renders `- [loop N] …` there).
- why: 3 failing tests in `pnpm test`, all in that one file; every other suite is green. The same pattern is already applied in `server/extract/{offline,jobs}.test.ts` and in `eval/tests/offline-contract.test.ts` (which the eval builder updated during this round), so there is a worked example to copy.
- workaround: none; the file is not extract-owned so extract did not touch it.
- blocking: yes for a green `pnpm test`
