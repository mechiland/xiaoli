# Core requests — architecture

## #1 Extend .gitignore for eval scratch and real judge cache
- status: done
- requested-by: architecture, round 1, 2026-09-15
- kind: gitignore
- paths: .gitignore
- change: add lines `eval/judge-cache/real/`, `eval/runs/`, `.dev/verify/` (already covered by `.dev/`, keep explicit comment), `playwright-report/`, `test-results/`
- why: judge cache for real data contains real claim text; eval run logs contain raw model output of real chats (ARCHITECTURE §7.1)
- workaround: none needed before eval-synthetic writes these dirs; eval-synthetic must not write real-source files until this is done (check `git check-ignore`)
- blocking: yes for eval on real data only
- Resolution (integrator, wave 2, 2026-09-15): Implemented by core in wave 1: .gitignore has `eval/judge-cache/real/`, `eval/runs/`, `playwright-report/`, `test-results/` and the `.dev/` coverage comment (checked by the wave 2 integrator).

## #2 Create `.dev.vars` from `.env.local` for wrangler contexts
- status: done
- requested-by: architecture, round 1, 2026-09-15
- kind: config
- paths: scripts/dev-ensure.ts, .dev.vars.example
- change: `pnpm dev:ensure` (and `withPlatform`) ensure `.dev.vars` exists with `NEXTJS_ENV=development`, `BETTER_AUTH_SECRET` (generated once locally), and load `DEEPSEEK_API_KEY` from `.env.local` at runtime without printing it
- why: getPlatformProxy/wrangler read `.dev.vars`, Next reads `.env.local` (DECISIONS A2/A3)
- workaround: n/a
- blocking: no
- Resolution (integrator, wave 2, 2026-09-15): Implemented by core in wave 1: `scripts/dev-ensure.ts` makes sure `.dev.vars` exists; `.dev.vars.example` is committed.

## #3 Allow committing synthetic ZIPs; ignore annotation views
- status: done
- requested-by: architecture, round 2, 2026-09-15
- kind: gitignore
- paths: .gitignore
- change: after the existing `*.zip` line add `!fixtures/synthetic/*.zip`; add comment that `.dev/annotate/` (annotation views of real chats) is covered by `.dev/`. Keep `eval/gold/real/` ignored; `eval/gold/LOCK.json` and `eval/gold/synthetic/**` stay committed.
- why: the global `*.zip` rule would silently exclude the committed synthetic ZIPs (ARCHITECTURE §1.15, §7.1)
- workaround: eval-synthetic checks `git check-ignore fixtures/synthetic/<zip>` and reports until done
- blocking: yes for committing eval-synthetic output (integrator)
- Resolution (integrator, wave 2, 2026-09-15): Implemented by core in wave 1: `!fixtures/synthetic/*.zip` comes after `*.zip`; `eval/gold/real/` stays ignored; `.dev/annotate/` is covered by `.dev/` (comment added).

## #4 package.json scripts named by ARCHITECTURE
- status: done
- requested-by: architecture, round 2, 2026-09-15
- kind: config
- paths: package.json
- change: add scripts (bodies point into the owning module's files): `dev:ensure`, `db:generate`, `db:migrate:local`, `db:reset` (core); `seed`, `verify`, `verify:list` (verify-seed: `tsx verify/cli.ts`, `tsx scripts/seed/index.ts`); `eval`, `eval:annotate-view`, `eval:gold-template`, `eval:validate-gold`, `eval:freeze-gold` (eval-synthetic: `tsx eval/src/cli.ts <cmd>`); `extract:offline` (`tsx scripts/extract-offline.ts`); `llm:usage` (`tsx scripts/llm-usage.ts`); `preview:prod` (`opennextjs-cloudflare build && opennextjs-cloudflare preview`, deploy may refine in wave 4)
- why: modules must not edit package.json, but their CLIs are part of the contract (§5, §7.5, §7.6, §8, §9)
- workaround: run `pnpm tsx <file>` directly until added
- blocking: no
- Resolution (integrator, wave 2, 2026-09-15): Implemented by core in wave 1: all the named scripts are in package.json (checked by the wave 2 integrator).

## #5 Core scope added in architecture round 2
- status: done
- requested-by: architecture, round 2, 2026-09-15
- kind: contract
- paths: server/routes/settings.ts, lib/links.ts, app/(app)/dev/layout.tsx, bootstrap placeholders (components/person-picker, components/evidence, pages p/imports/chats/settings/welcome/home), contracts (ExtractModel, IdParamSchema, PeopleIndexResponse, EvidenceResponse, highConfidence, uploads in GET import, AttachmentDTO.selected, attachments.selected column, imports.parser_version, llm error code 'deadline'), server/db getUserSettings, session middleware central 401 with /api/health exception, sign-up → /welcome redirect, README pinned versions
- change: implement as specified in ARCHITECTURE §1.1, §2, §3, §4.1
- why: architecture round 2 moved these into core to satisfy the wave rule (DECISIONS A5 #20, #21, #31)
- workaround: none; core wave 1 builds from the current ARCHITECTURE.md
- blocking: no (core has not started)
- Resolution (integrator, wave 2, 2026-09-15): Implemented by core in wave 1 from ARCHITECTURE §1.1, §2, §3 and §4.1.

## #6 Core scope added in architecture round 3
- status: done
- requested-by: architecture, round 3, 2026-09-15
- kind: contract
- paths: contracts/entities.ts, contracts/parsed-export.ts, contracts/api/settings.ts, contracts/api/imports.ts, server/env.ts, server/context.ts, server/middleware/session.ts, server/db/schema/{import,memory}.ts, server/db/owned.ts, lib/auth-client.ts, drizzle/**
- change:
  1. `SettingsDTO.extractModel: ExtractModel | null`; `PATCH /api/settings` accepts `extractModel: ExtractModel | null`; `getUserSettings` returns null when the column is null (no default fill). (ARCHITECTURE §2.2, §2.4)
  2. `StagedImportPayload` schema in `contracts/parsed-export.ts` (§2.3). Response docs for `POST /api/imports/check`, `POST /api/imports`, `PUT .../attachments/:name`, mapping 404/409 as in §2.4 (shapes unchanged).
  3. `server/env.ts`: `ServerEnvSchema` with `EXTRACT_MODEL: ExtractModel.optional()` (invalid value fails validation), `parseServerEnv(source)`; session middleware sets `c.var.env`; `AppEnv.Variables.env: ServerEnv`. (§1.1, §3)
  4. Link tables `import_messages`, `claim_mentions`, `event_participants`: add `owner_id text not null references user(id) on delete cascade`, `created_at text not null`, index `(owner_id)`; no surrogate id; `evidence` gets index `(owner_id)` too. `server/db/owned.ts`: `OwnedLinkTable`, `withOwnerLink`; `owned()` accepts link tables. (§3, §4.1)
  5. `lib/auth-client.ts`: `export const authClient = createAuthClient()` (better-auth/react, same origin) and re-export `signIn`, `signUp`, `signOut`, `useSession`; TopBar sign-out and `app/(auth)/**` use it. (§1.1)
- why: architecture round 3 fixes (parsed payload storage, env-based model default, owner_id on link tables, auth client owner)
- workaround: none; core wave 1 builds from the current ARCHITECTURE.md
- blocking: no (core has not started)
- Resolution (integrator, wave 2, 2026-09-15): Implemented by core in wave 1: nullable `extractModel` in settings, `server/env.ts`, owner_id on link tables plus `server/db/owned.ts`, and `lib/auth-client.ts`.
