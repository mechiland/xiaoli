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
