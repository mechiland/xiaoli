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
