# Core requests — import-result

## #1 List PATCH /api/people/:id among import-result's consumed routes
- status: done
- requested-by: import-result, round 1, 2026-09-15
- kind: other
- paths: ARCHITECTURE.md §1.10 "Consumes", §12.1 dependency walk
- change: add `PATCH /api/people/:id` (person, wave 3) to §1.10 Consumes and a row `import-result (3) | PATCH /api/people/:id | person (3)` to §12.1. SPEC §9.9 "新人物：label 可直接修改" needs it; it is the only route that renames a person.
- why: same-wave route dependency not recorded; until person lands its handler the rename answers 501.
- workaround: the page calls the route and shows "名字暂时改不了" on 501; showcase/actions stub the route. Nothing to remove later.
- blocking: no
- Resolution (integrator, wave 3 mid, 2026-09-15): Implemented as a docs change. ARCHITECTURE §1.10 Consumes now lists `PATCH /api/people/:id` (person), and §12.1 has the row `import-result (3) | PATCH /api/people/:id | person (3)` (same-wave route, 501 until person lands). No contract or code change: `PATCH /api/people/:id` is already in §2.4 and `contracts/api`, and person owns the handler (`server/person/patch.ts`). The workaround stays as it is.

## #2 List GET /api/people/:id among import-result's consumed routes
- status: done
- requested-by: import-result, overall-critic fix round 1, 2026-09-16
- kind: other
- paths: ARCHITECTURE.md §1.10 "Consumes", §12.1 dependency walk
- change: add `GET /api/people/:id` (person) to §1.10 Consumes and a row `import-result (3) | GET /api/people/:id | person (3)` to §12.1. The "其实是……" dialog reads the profile of same-label candidates and of the chosen target to show a context line (chats / alias count / claim count / creation date), so two people both labelled e.g. 王小明 can be told apart (overall critic r1, import-result issue 1).
- why: route dependency not recorded. The route and `ProfileResponse | ProfileRedirectResponse` are already in §2.4/`contracts/api/people.ts`; import-result reads it under `queryKeys.person(id)` with the same value shape the person page caches.
- workaround: none needed; a redirect or error just leaves the context line out.
- blocking: no
- note for person/core (optional, not requested): `persons.import_id` exists in the schema but not in `PersonDTO`; exposing it would let the dialog say "手动新建" instead of the derived "没有聊天记录 · 还没有信息".
- Resolution (integrator, wave 4, 2026-09-16): Done (text only). ARCHITECTURE §1.10 Consumes lists `GET /api/people/:id` (person; merge-dialog context line, `queryKeys.person(id)`, redirect/error leaves the line out) and §12.1 has the row `import-result (3) | GET /api/people/:id (merge-dialog context line) | person (3)`. No contract change. The optional `PersonDTO.importId` note is not taken: it would be a contract change affecting person/search/home, and the derived copy is accurate.

## #3 List the interaction routes among import-result's consumed routes
- status: **done** (integrator, 2026-09-16). Resolved by sharing, not by changing the prompt: `loopSentence` + `LOOP_KIND_LABEL` + `loopStateLabel` moved to `lib/loop-text.ts` (wave 1, pure); `components/import-result/format.ts` re-exports them and `components/interaction/LoopRow` now renders through `loopSentence` with a new required `personLabel` threaded from the person page. `loops.text` stays a bare fragment, per prompt v9 line 92. The probe that proved it: the same loop read "把露营装备清单发过去。" on one page and "你答应把露营装备清单发过去" on the other.
- requested-by: import-result, wave 5, 2026-09-16
- kind: other
- paths: ARCHITECTURE.md §1.10 "Consumes", §12.1 dependency walk
- change: add to §1.10 Consumes — `POST /api/loops/:id/close` (interaction; the "已经了结了" action of a 未结事项 row, SPEC §9.9) and `@/components/interaction` (`ImportConversations`, mounted between the bulk control and the review body, which fetches `GET /api/imports/:id/interaction` itself). Add the matching rows to §12.1: `import-result (3) | POST /api/loops/:id/close | interaction (5)` and `import-result (3) | @/components/interaction ImportConversations | interaction (5)`.
- why: wave 5 gave the page two new dependencies on interaction. §1.17 already says interaction owns the component and the route; §1.10 does not yet say the import result page consumes them. The review verbs on a loop (`POST /api/review/loop/:id`) are review's and already covered by the existing "review endpoints" entry.
- workaround: none needed — the endpoints exist. The showcase scenario stubs `GET /api/imports/:id/interaction` and `POST /api/loops/:id/close` so its screenshots do not depend on seed interaction data (the seed imports predate the layer).
- blocking: no

## #4 The same loop reads differently on the person page and on the import result page
- status: open
- requested-by: import-result, wave 5, 2026-09-16
- kind: other (cross-module consistency; not a request to change another module's file)
- paths: `components/interaction/LoopRow.tsx`, `components/interaction/format.ts` (interaction), `components/import-result/format.ts` (mine)
- observation: `loops.text` is written by the extraction as a bare fragment — `prompts/extract.v9.md` examples are "把露营装备清单发过去", "问了周六几点出发还没回", "约了周六中午一起吃饭" — and `direction` / `kind` carry who it is on. SPEC §9.5 and §9.9 both render a loop as a sentence a person would say ("你答应帮她看简历", "她问你国庆有没有空，你没回"). `LoopRow` (person page) prints `sentence(loop.text)` unchanged, so it shows "把露营装备清单发过去。" with no subject; the import result page renders `loopSentence(loop, personLabel)` in `components/import-result/format.ts`, which chooses the subject and the verb from `direction`/`kind` and leaves the verb out when the text already starts with it.
- change: interaction (as owner of both the person-page row and the shared wording) picks one of: (a) adopt the same rule and export the helper from `@/components/interaction` so both pages read identically, or (b) tighten `prompts/extract.v9.md` so `text` is already a full sentence from the user's side, after which my prefix should be removed. Either way one module should own the wording.
- why: the same unfinished thing must not read two ways on two pages. I cannot fix it from here: `components/interaction/**` is not mine.
- workaround: my page renders the sentence itself; nothing to remove if (a) lands, one function to delete if (b) does.
- blocking: no
