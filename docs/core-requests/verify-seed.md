# Core requests — verify-seed

## #1 `test:e2e` script for Playwright specs
- status: done
- requested-by: verify-seed, round 1, 2026-09-15
- kind: config
- paths: package.json
- change: add `"test:e2e": "playwright test"` (config `playwright.config.ts` at repo root, owned by verify-seed: system Chrome via `channel: 'chrome'`, 1 worker, projects 1440 and 390, global setup checks `/api/health` + seed manifest)
- why: modules own `tests/e2e/<module>/**` specs (ARCHITECTURE §1.4) but there is no script to run them; `pnpm exec playwright test` works meanwhile
- workaround: `pnpm exec playwright test`
- blocking: no
- Resolution (integrator, wave 1, 2026-09-15): Added `"test:e2e": "playwright test"`.
