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
