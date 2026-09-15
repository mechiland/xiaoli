# Core requests — eval-synthetic

## #1 Script for the synthetic fixture generator
- status: done
- requested-by: eval-synthetic, round 1, 2026-09-15
- kind: config
- paths: package.json
- change: add `"synthetic:generate": "tsx scripts/synthetic/generate.ts"` (the `--check` flag verifies committed files match a fresh generation)
- why: convenience and discoverability; ARCHITECTURE §1.15 names the generator but no script runs it
- workaround: `pnpm tsx scripts/synthetic/generate.ts [--check]`; also covered by `eval/tests/synthetic.test.ts`
- blocking: no
- Resolution (integrator, wave 1, 2026-09-15): Added `"synthetic:generate": "tsx scripts/run-owned.ts scripts/synthetic/generate.ts eval-synthetic --"` (pass `-- --check`). Routed through run-owned like the other module CLIs.

## #2 State the relation direction in the extraction contract
- status: done
- requested-by: eval-synthetic, round 1, 2026-09-15
- kind: contract
- paths: ARCHITECTURE.md §2.5 (ExtractionOutputSchema relations), §7.2 (gold relations); affects module **extract** (prompt) and the annotator
- change: add one sentence to both places: "relation reads: `from` 是 `to` 的 `type`（例：from=外公, to=外孙, type=parent）". Shapes unchanged.
- why: the eval matcher accepts the reverse direction only with the inverse type (parent↔child) or for symmetric types. If extract's prompt uses the opposite reading, every asymmetric relation counts as a false positive and the relations precision gate (≥ 0.90) fails for a convention mismatch rather than an extraction error. `eval/src/GOLD_FORMAT.md` already documents this reading for annotators.
- workaround: documented in eval/src/GOLD_FORMAT.md and DECISIONS eval-synthetic E4
- blocking: no (blocks a meaningful relations score once extract lands)
- Resolution (integrator, wave 1, 2026-09-15): ARCHITECTURE §2.5 and §7.2 now say `from` 是 `to` 的 `type` (外公/外孙 example). §2.5 also pins `label` to the same reading (label names `from` as seen from `to`, as in GOLD_FORMAT.md). The seed stored the reverse (`to` is `from`'s type/label), so the integrator swapped the stored endpoints in `scripts/seed/dataset.ts` `relation()` and the self-relation assertion in `seed.test.ts` (DECISIONS ## integrator I2). extract must use this reading in its prompt.

## #3 Let the annotator read the gold format doc
- status: done
- requested-by: eval-synthetic, round 1, 2026-09-15
- kind: other
- paths: ARCHITECTURE.md §7.6 (annotator "may read ONLY" list)
- change: add `eval/src/GOLD_FORMAT.md`, `eval/src/gold-schema.ts` and `fixtures/synthetic/README.md` to the allowed reads. They describe the file format and which ZIP is which chat type; none of them mentions pipeline output or planted content.
- update (round 2): round 1's GOLD_FORMAT.md used values planted in the synthetic chats as examples and the README listed planted trap categories per ZIP. Both are fixed: examples are invented (a badminton club that appears in no fixture), the README purpose column is chat type + computed overlap only. `eval/tests/synthetic.test.ts` ("annotator-readable docs stay blind") fails if any planted text/value/label, negative description/forbidden or sensitive value from `*.intent.json` appears in these three files.
- note for core: ARCHITECTURE §2.5 uses "老爸" as the relation `label` example; that word is also a planted address term in a synthetic chat. It is generic Chinese, so harmless, but a neutral example (e.g. "外公") would keep the annotator's allowed reads fully blind.
- why: the annotator needs the field-level format (relation direction, optional, acceptTypes, sensitive handling) to write gold that validate-gold accepts
- workaround: none needed if the orchestrator passes these paths in the annotator's prompt
- blocking: no
- Resolution (integrator, wave 1, 2026-09-15): ARCHITECTURE §7.6 allowed reads now include `eval/src/GOLD_FORMAT.md`, `eval/src/gold-schema.ts` and `fixtures/synthetic/README.md`. The §2.5 label example "老爸" is now "外公".

## #4 §7.2: a created person named like a sender is a duplicate, not the sender
- status: done
- requested-by: eval-synthetic, overall critic r2 fix round, 2026-09-16
- kind: other (wording of a binding section; no contract shape change)
- paths: ARCHITECTURE.md §7.2 (person mapping sentence)
- change: after "for `new:<label>` persons, by normalized label/alias match (NFKC, strip spaces, case-fold) against `persons[].label/aliases`" add: "; a `new:` person whose label matches the label/alias of a sender person (`mapping.senders[].person` or `mapping.self`) is a duplicate of that sender: its items never match gold and count as FPs labelled `wrong_person` (deterministic), reported as `duplicateSenderPersons`".
- why: overall critic r2 (eval-synthetic item). The pipeline always knows every sender, so a created person carrying a sender's name is a duplicate person in the app; scoring its real_name handle as the sender's TP hides a regression of extract's fold (DECISIONS ## extract X28).
- workaround: implemented in eval/src/score.ts and documented in DECISIONS ## eval-synthetic E20; `eval/src/GOLD_FORMAT.md` mentions it for annotators.
- blocking: no
- Resolution (integrator, wave 4, 2026-09-16): Done (text only). ARCHITECTURE §7.2 person-mapping sentence has the requested duplicate-of-sender clause, worded exactly as asked. Checked against `eval/src/score.ts` (`duplicateOf` → FP `wrong_person`, `counts.duplicateSenderPersons`). No contract change.
