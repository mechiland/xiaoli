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
