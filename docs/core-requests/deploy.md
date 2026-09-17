# Core requests — deploy

## #1 Wire deploy scripts in package.json (preview:prod body)
- status: done
- requested-by: deploy, round 1, 2026-09-15
- kind: config
- paths: package.json
- change: replace `"preview:prod": "opennextjs-cloudflare build && opennextjs-cloudflare preview"` with `"preview:prod": "tsx scripts/deploy/preview-prod.ts"` and add
  `"deploy:setup": "tsx scripts/deploy/setup.ts"`, `"deploy:build": "tsx scripts/deploy/build.ts"`, `"deploy:size": "tsx scripts/deploy/size-check.ts"`, `"deploy:smoke": "tsx scripts/deploy/smoke.ts"`.
- why: the current body builds in place. (a) `next build` rewrites `.next`, which the running dev server on :3000 uses. (b) OpenNext compiles `.env`, `.env.local`, `.env.production(.local)` into `.open-next/cloudflare/next-env.mjs`, inside the worker bundle. From the main checkout that inlines `DEEPSEEK_API_KEY` from `.env.local`; the variable name was checked with OpenNext's own `extractProjectEnvVars`, the value was never printed. `preview-prod.ts` builds in a clean git worktree, scans the output for secret values, and serves on :8787 with local D1/R2.
- workaround: run `pnpm tsx scripts/deploy/<script>.ts` directly (docs/DEPLOY.md does).
- blocking: no
- Resolution (integrator, wave 4, 2026-09-16): Done exactly as requested. `preview:prod` → `tsx scripts/deploy/preview-prod.ts`; added `deploy:setup`, `deploy:build`, `deploy:size`, `deploy:smoke` (plain tsx). Usage `pnpm preview:prod -- --share-dev-state`. docs/DEPLOY.md can drop the "once deploy#1 lands" note.

## #2 ARCHITECTURE §8 wording for the production preview
- status: done
- requested-by: deploy, round 1, 2026-09-15
- kind: other
- paths: ARCHITECTURE.md §8 (verify tool, "Production-like confirmation"), §1.13
- change: replace "`pnpm preview:prod` = `opennextjs-cloudflare build && opennextjs-cloudflare preview` (… using the same local `.wrangler/state` D1/R2)" with "`pnpm preview:prod` = `scripts/deploy/preview-prod.ts`: builds in a clean git worktree (`../xiaoli-deploy-build`), refuses secrets in the build output, applies local migrations and serves the worker with `wrangler dev` on :8787. The default state is the worktree's own empty D1/R2. `--share-dev-state` uses the repo's `.wrangler/state`, so seed accounts work for `pnpm verify _smoke/perf-budgets --base http://localhost:8787`." Text only.
- why: the documented command would leak the API key into the bundle and clobber the dev server's `.next` (see #1).
- workaround: none needed; docs/DEPLOY.md describes the real behaviour.
- blocking: no
- Resolution (integrator, wave 4, 2026-09-16): Done (text only). ARCHITECTURE §8 uses the requested wording, plus how to pass the flag. The §4 local-state line no longer says `opennextjs-cloudflare preview` shares `.wrangler/state`; it names `--share-dev-state`. §1.13 already says "`pnpm preview:prod` script body (§8)", so it is unchanged.

## #3 (for the integrator to route to llm) Turbopack whole-project trace from `server/llm/node/file-budget.ts`
- status: accepted
- requested-by: deploy, round 1, 2026-09-15
- kind: other
- paths: server/llm/node/file-budget.ts:25 (llm-owned, not core)
- change: `path.resolve(process.cwd(), p ?? DEFAULT_BUDGET_PATH)` → `path.resolve(/*turbopackIgnore: true*/ process.cwd(), p ?? DEFAULT_BUDGET_PATH)` (the opt-out Turbopack's warning suggests).
- why: `next build` warns "Dynamic filesystem access causes tracing of the whole project". Turbopack then copies every project file into `.open-next/server-functions/default` (fixtures, eval, docs, …). The uploaded `worker.js` does not contain them: the dry-run bundle has no fixture paths and the secret scan is clean. But a build in the main checkout would put local copies of `fixtures/real`, `eval/gold/real`, `artifacts` and env files under `.open-next`, and it slows builds. Deploy's scripts avoid this by building in a clean worktree.
- workaround: build only in a clean worktree (scripts/deploy/build.ts default).
- blocking: no
- Resolution (integrator, wave 4, 2026-09-16): Not core-owned, so routed. Added to llm's `openIssues` in docs/STATUS.json with the exact one-line change. Non-blocking: deploy's worktree build stays the default. DECISIONS integrator I16.
- Follow-up (integrator, wave 4 end, 2026-09-16): llm had not applied it, so the integrator made the one-line seam fix in `server/llm/node/file-budget.ts` (`path.resolve(/*turbopackIgnore: true*/ process.cwd(), …)`). Typecheck and tests pass. Not re-built here: the dev server shares `.next`, and deploy builds in a worktree anyway. Status stays accepted until a deploy build confirms the warning is gone. DECISIONS integrator I20.
