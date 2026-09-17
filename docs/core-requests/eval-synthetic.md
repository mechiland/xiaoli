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

## #5 §6: spell out the interaction fields of `OfflineExtractionResult`

**status: done** (integrator, 2026-09-16). ARCHITECTURE §6 now carries `memoryStore`'s real shape verbatim — `segments[].participants`, `loops[].openedIdx/closedIdx/closedAt/closedReason`, `closes[].loopIndex` — with a comment saying a rename here silently zeroes every interaction metric. The compile-time + end-to-end pin is `eval/tests/offline-contract.test.ts`. DECISIONS I14.
- status: done (§6 now carries them; the names below were the ones extract actually shipped)
- requested-by: eval-synthetic, wave 5, 2026-09-16
- kind: contract
- paths: ARCHITECTURE.md §6 (the `OfflineExtractionResult` code block); affects module **extract**
- change: the §6 "Interaction extraction" paragraph says the harness consumes segments and loops from the offline result, but the `OfflineExtractionResult` block still lists only the six round-1 arrays. Add the two the harness reads (both optional, so an extract build or a cassette replay without interaction output keeps type-checking and scores exactly as before):
```ts
segments?: { startIdx: number; endIdx: number; summary: string; topics: string[]; speakers: string[] /* gold person keys */; evidence: number[] /* parsed-export idx */; windowIndex: number }[]
loops?:    { person: string /* gold person key */; direction: LoopDirection; kind: LoopKind; text: string; dueAt?: string;
             evidence: number[]; windowIndex: number;
             /* set when a LATER window closed this loop (SPEC §8.8 `closes`), resolved by extractOffline itself */
             closedByIdx?: number; closedReason?: LoopCloseReason; closedWindowIndex?: number }[]
```
- why: §7.3/§7.4 need (a) idx spans for `groupSegments` + the ≥ 50 % conversation overlap, (b) a per-loop close **idx** for `loopCloseRecall` / `loopFalseClose`. A separate `closes[]` array would not do: `closes` reference loop **ids**, which only exist in D1, so offline the close has to be resolved onto the loop that the same run produced (`memoryStore` already fills `openLoops` from the run's own output, §6).
- workaround: `eval/src/entries.ts` already mirrors exactly the shape above (the mirror is what the harness reads, per the file's TODO); `eval/tests/interaction.test.ts` scores against it. If extract lands a different shape, the harness reports 0 segments / 0 loops rather than failing — silently, which is the reason to pin it in §6.
- blocking: no (interaction metrics stay null until extract emits the fields)
- Resolution (eval-synthetic, wave 5 follow-up, 2026-09-16): the shape the request guessed was **wrong in two places** — extract emits `segments[].participants` (`{ person, messageCount }[]`, not `speakers: string[]`) and `loops[].closedIdx` (not `closedByIdx`), plus a separate `closes[] { loopIndex, reason, evidence, windowIndex }`. ARCHITECTURE §6 now documents the real `OfflineItems`. The harness reads the real names, and `eval/tests/offline-contract.test.ts` pins them at compile time and end to end so the next rename fails a test instead of silently zeroing the interaction metrics (DECISIONS ## eval-synthetic E21).

## #6 §7.4 still describes the old `loopFalseClose`, which contradicts DECISIONS I13

**status: done** (integrator, 2026-09-16). Correct — my earlier edit to that bullet aborted mid-script and never wrote, so the two documents really did disagree. §7.4 now spells out the three mechanically-impossible cases, says which array each close metric reads and why, and states that a close of a gold-open loop costs loop precision instead. Thank you for checking the document rather than assuming the instruction had landed.
- status: open
- requested-by: eval-synthetic, wave 5 follow-up, 2026-09-16
- kind: other (wording of a binding section)
- paths: ARCHITECTURE.md §7.4, the `loopCloseRecall` / `loopFalseClose` bullet (currently: "`loopFalseClose` = predicted closes with no gold `closedBy` on the matched loop")
- change: replace that sentence with the I13 definition, e.g. "`loopFalseClose` = predicted closes that are mechanically impossible: the `loopIndex` is not a loop of this run, the closing window is earlier than the window that first produced the loop (it was never shown that loop), or the closing evidence is not strictly after the opening message. All three are already dropped by `validateOutput`, so a survivor is a pipeline or harness bug. **Gated = 0.** A close of a loop gold leaves open is a model mistake and counts as a loop false positive against the 0.80 precision gate, not here."
- why: the orchestrator fixed the definition in DECISIONS I13 (the literal §7.4 reading would fail a whole source on one honest model misjudgement) and the harness now implements I13, but §7.4 still carries the old sentence. Two binding documents disagreeing about a gate is how the first wrong implementation happened.
- workaround: implemented to I13; `eval/tests/interaction.test.ts` ("loopFalseClose counts ONLY mechanically impossible closes") is the executable version of the rule.
- blocking: no
