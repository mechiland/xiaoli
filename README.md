# 小丽

从微信聊天记录里长出来的人物档案。Next.js (App Router) + Hono + Better Auth + Drizzle on Cloudflare D1/R2 (local via OpenNext dev bindings).

- Product spec: `SPEC.md` · process: `PLAN.md` · module boundaries and contracts: `ARCHITECTURE.md` · decisions: `docs/DECISIONS.md`

## Local development

```bash
pnpm install
pnpm dev:ensure        # creates .dev.vars, applies local D1 migrations, starts ONE dev server on :3000 (log: .dev/server.log)
pnpm typecheck
pnpm test              # vitest; backend tests use in-memory D1 (getPlatformProxy, persist: false)
```

Secrets: `DEEPSEEK_API_KEY` lives in `.env.local` (gitignored); `pnpm dev:ensure` mirrors it into `.dev.vars` (gitignored) together with a locally generated `BETTER_AUTH_SECRET`. Deploy uses `wrangler secret put`; nothing secret is written to `wrangler.jsonc`.

### Scripts

| script | what |
|---|---|
| `dev` / `dev:ensure` | Next dev server on :3000 / ensure exactly one is running |
| `build`, `typecheck`, `test` | `next build`, `tsc --noEmit`, `vitest run` |
| `db:generate` | `drizzle-kit generate` → `drizzle/` (core/integrator only) |
| `db:migrate:local` | `wrangler d1 migrations apply xiaoli --local` |
| `db:reset` | delete local D1 state + migrate (integrator only; dev server stopped) |
| `seed`, `verify`, `verify:list` | verify-seed module (`scripts/seed/index.ts`, `verify/cli.ts`) |
| `eval`, `eval:*` | eval-synthetic module (`eval/src/cli.ts`) |
| `extract:offline` | extract module (`scripts/extract-offline.ts`) |
| `llm:usage` | llm module (`scripts/llm-usage.ts`) |
| `preview:prod` | production build in a clean worktree, served by workerd on :8787 with local D1/R2 (`scripts/deploy/preview-prod.ts`, deploy; wired by core request deploy#1) |

Scripts that point at another module's entry print which module owns it when the file does not exist yet.

## Deploy (Cloudflare)

See `docs/DEPLOY.md`. `pnpm tsx scripts/deploy/setup.ts` prints the plan; `--apply --url <origin>` creates D1/R2, applies remote migrations, builds in a clean worktree (never in place: OpenNext would compile `.env.local` into the worker), deploys, sets secrets and runs `scripts/deploy/smoke.ts`.

## Pinned versions (checked 2026-09-15)

| package | version |
|---|---|
| node (local) | 24.21.0 |
| pnpm | 12.4.1 |
| next | 16.3.5 |
| react / react-dom | 19.3.0 |
| @opennextjs/cloudflare | 1.20.6 |
| wrangler | 4.131.2 (workerd 1.20260911.1) |
| Workers compatibility_date / flags | 2026-09-01 / `nodejs_compat`, `global_fetch_strictly_public` |
| better-auth / @better-auth/drizzle-adapter | 1.7.5 |
| hono | 4.13.8 |
| @hono/zod-validator | 0.9.1 |
| drizzle-orm / drizzle-kit | 0.45.2 / 0.31.10 |
| zod | 4.6.5 |
| @tanstack/react-query | 5.102.8 |
| tailwindcss / @tailwindcss/postcss | 4.3.3 |
| shadcn (CLI) / radix-ui | 4.21.0 / 1.6.7 |
| fflate | 0.8.3 |
| lunar-typescript | 1.8.6 |
| pinyin-pro | 3.29.4 |
| vitest | 5.0.0 |
| playwright / @playwright/test | 1.63.0 (system Chrome, `channel: 'chrome'`) |
| typescript | 5.9.3 |
| tsx | 4.23.13 |

Compatibility notes: @opennextjs/cloudflare 1.20.6 peers `next >=15.5.24 <16 || >=16.3.3` and `wrangler ^4.125.0`. No `proxy.ts`/middleware (Node middleware is unsupported on OpenNext Cloudflare); the auth gate lives in `app/(app)/layout.tsx` and in Hono's session middleware.
