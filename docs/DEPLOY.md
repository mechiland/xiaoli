# Deploying 小丽 to Cloudflare

Runbook for the owner. Owned by the deploy module (ARCHITECTURE §1.13). Everything below was checked locally on
2026-09-15: build, size, dry-run, production preview and smoke. The steps that touch Cloudflare (sections 3–7) were
**not** executed, because they need your account.

## 0. What gets deployed

- One Worker `xiaoli`, built by `@opennextjs/cloudflare`, serving the Next.js app and the Hono API (`/api/*`).
- D1 database `xiaoli` (binding `DB`, migrations in `drizzle/`) and R2 bucket `xiaoli-files` (binding `R2`, attachments and staged imports).
- `wrangler.jsonc` has two targets:
  - **top level = local.** `next dev`, tests and the production preview use it. Its all-zero `database_id` is the key of your local D1 data; leave it alone.
  - **`env.production` = Cloudflare.** Every remote command in this document takes `--env production`. `REPLACE_WITH_…` values are placeholders that `setup.ts` fills in.

### Pinned versions

| tool | version |
|---|---|
| node | 24.21.0 (engines ≥ 24) |
| pnpm | 12.4.1 |
| wrangler | 4.131.2 (bundled workerd 1.20260911.1) |
| @opennextjs/cloudflare | 1.20.6 |
| next | 16.3.5 |
| better-auth | 1.7.5 |
| compatibility_date / flags | `2026-09-01` / `nodejs_compat`, `global_fetch_strictly_public` |

The rest are listed in `README.md`. Do not bump the compatibility date past the bundled workerd's date.

### Which Cloudflare plan

Measured with `wrangler deploy --dry-run` on 2026-09-15: **13.4 MiB raw, 2.88 MiB gzip.** That is under the Free
plan's 3 MiB limit, with only about 120 KiB to spare. **Use Workers Paid ($5/month):**
- the Free plan allows 10 ms of CPU per request, which rendering person pages and the extraction step (`jobs/next`: JSON validation, dedup, D1 writes) will exceed;
- one more dependency would push the bundle over 3 MiB.

`scripts/deploy/size-check.ts` reports the current numbers on every build.

## 1. Prerequisites (once)

```bash
pnpm install
pnpm exec wrangler login            # or export CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ACCOUNT_ID) for a token
```

Find your workers.dev subdomain in the Cloudflare dashboard (Workers & Pages → Overview, right-hand side: "Subdomain").
The app's public origin is then `https://xiaoli.<subdomain>.workers.dev`. With a custom domain, use that origin instead.

Have your DeepSeek API key ready. You will be prompted for it; it is never written to a file.

## 2. See the plan (safe, changes nothing)

```bash
pnpm tsx scripts/deploy/setup.ts
```

This prints every command the setup would run and lists the placeholders still left in `wrangler.jsonc`. Without
`--apply` it never calls Cloudflare, never edits a file and never builds.

## 3. First deployment

```bash
pnpm tsx scripts/deploy/setup.ts --apply --url https://xiaoli.<subdomain>.workers.dev
# optional: --d1-location apac --r2-location apac   (closest regions for users in China)
```

It asks you to type `yes` (skip with `--yes`), then runs these steps in order. Every step is idempotent, so re-running after a failure is safe.

| step | what it does | manual equivalent |
|---|---|---|
| `whoami` | checks the login | `pnpm exec wrangler whoami` |
| `d1` | finds or creates the D1 database and writes its id into `env.production` | `pnpm exec wrangler d1 create xiaoli`, then paste the id into `wrangler.jsonc` |
| `r2` | finds or creates the bucket | `pnpm exec wrangler r2 bucket create xiaoli-files` |
| `url` | writes `BETTER_AUTH_URL` into `env.production.vars` | edit `wrangler.jsonc` |
| `migrate` | applies all migrations to the remote D1 | `pnpm exec wrangler d1 migrations apply xiaoli --remote --env production` |
| `build` | clean git worktree `../xiaoli-deploy-build` at `HEAD` plus your current `wrangler.jsonc`/`open-next.config.ts` → `pnpm install --frozen-lockfile` → `opennextjs-cloudflare build` → secret scan → size check | `pnpm tsx scripts/deploy/build.ts` |
| `deploy` | uploads the worker and static assets | `cd ../xiaoli-deploy-build && pnpm exec opennextjs-cloudflare deploy --env production` |
| `secrets` | sets the secrets that are missing (see §4) | `pnpm exec wrangler secret put DEEPSEEK_API_KEY --env production` |
| `smoke` | runs the smoke test against the URL (see §6) | `pnpm tsx scripts/deploy/smoke.ts --base <url>` |

Commit the updated `wrangler.jsonc` afterwards. The D1 id and the URL are not secret.

On the first deploy, secrets are set right after the upload (setting a secret needs an existing worker). The site
answers with errors for those few seconds.

**Why the build runs in a separate worktree:** OpenNext compiles `.env`, `.env.local` and `.env.production(.local)`
into the worker bundle (`.open-next/cloudflare/next-env.mjs`). Your main checkout's `.env.local` holds the DeepSeek
key for local development, so an in-place build would upload the key inside the code. The worktree contains only
committed files. `build.ts --in-place` refuses to run while any env file there holds a secret. After every build, all
of `.open-next` is searched for the values of `DEEPSEEK_API_KEY` and `BETTER_AUTH_SECRET`; if one is found, the build
fails and only the variable name is reported.

## 4. Secrets and variables

Secrets (`wrangler secret put <NAME> --env production`; the value comes from stdin and is never echoed):

| name | source |
|---|---|
| `DEEPSEEK_API_KEY` | prompted (hidden input), or taken from `$DEEPSEEK_API_KEY` in your shell if set |
| `BETTER_AUTH_SECRET` | 32 random bytes generated by `setup.ts`. Rotating it signs everyone out. |

Rotate: `pnpm tsx scripts/deploy/setup.ts --apply --only secrets --rotate-secrets DEEPSEEK_API_KEY`.
List names (values are never shown): `pnpm exec wrangler secret list --env production`.

Variables (`env.production.vars` in `wrangler.jsonc`; they take effect on the next deploy):

| name | value | meaning |
|---|---|---|
| `BETTER_AUTH_URL` | `https://xiaoli.<subdomain>.workers.dev` | Better Auth base URL and only trusted origin. A wrong value makes sign-up and sign-in fail with an origin error. |
| `LLM_BUDGET_TOKENS` | `3000000` | token budget (input + output) for the deployed app. Extraction stops with a budget error once `llm_calls` since `LLM_BUDGET_SINCE` reach it. |
| `LLM_BUDGET_SINCE` | unset | ISO datetime with offset, e.g. `2026-10-01T00:00:00+08:00`. The budget counts calls since then; unset = start of the current month. |
| `EXTRACT_MODEL` | `deepseek-flash` | default extraction model. Users can override it in settings. |
| `APP_TZ` | `Asia/Shanghai` | message timezone |

Do not set `LLM_MODE` in production. The default `live` is correct; `record`/`replay` need a filesystem, which the Worker does not have.

## 5. Later deployments

```bash
git pull                                              # or commit your changes
pnpm exec wrangler d1 migrations apply xiaoli --remote --env production   # only if drizzle/ has new migrations
pnpm tsx scripts/deploy/setup.ts --apply --only build,deploy,smoke --yes
```

Apply migrations **before** deploying code that needs them. Migrations only add to the schema, so the old code keeps
running against the new schema.

**Once, after the first deploy of parser `wechat-export@2`** (only for a D1 that already holds messages from an older
deploy): recompute stored message fingerprints so re-exports of the same chat align on image/video messages. It is
idempotent and prints counts only.

```bash
npx tsx lib/wechat-export/scripts/backfill-fingerprints.ts --remote --env production
```

## 6. Smoke test

```bash
pnpm tsx scripts/deploy/smoke.ts --base https://xiaoli.<subdomain>.workers.dev
```

Without calling the model, it checks:
- `/api/health` (DB reachable), 401 for unauthenticated API calls, `/sign-in` and a static asset;
- sign-up of a throwaway user `smoke+<timestamp>@xiaoli.test`;
- import of the synthetic export `fixtures/synthetic/聊天记录_20260405_223012.zip` through the API: parse, `POST /api/imports`, mapping (the busiest sender → 我, the others → new people), one image uploaded to R2 and read back;
- that `/`, `/imports/:id`, `/chats/:id`, `/p/:id` and `/settings` render, plus the chat, person, home and search APIs.

At the end it deletes everything the user created (`DELETE /api/data`). The empty throwaway account itself remains.
Options: `--keep` skips the cleanup, `--json` prints a machine-readable result, and `--extract 3` also runs three
extraction windows, which **spends DeepSeek tokens** on your key.

## 7. Online acceptance (SPEC §11 M6)

Not executed by the build agents; it needs your account. After the smoke passes:
1. Open the URL, sign up with your real email, and drag in a WeChat export ZIP.
2. Map the senders and start. The import result page processes the windows one request at a time; keep the tab open until the progress completes.
3. Review: accept a few items, reject one, edit one; open a person page and click an evidence marker through to the chat.
4. Search for an alias. Check that the browser console shows no errors and the network panel no failed requests.
5. Check token usage (the app has no usage page yet): `pnpm exec wrangler d1 execute xiaoli --remote --env production --command "select sum(input_tokens+output_tokens) from llm_calls"`.

## 8. Rollback

```bash
pnpm exec wrangler deployments list --env production           # recent versions
pnpm exec wrangler rollback <version-id> --env production -m "reason"   # omit the id for the previous version
```

A rollback changes only the worker code. The D1 schema and data stay as they are. That is safe here because
migrations only add to the schema. To undo a destructive **data** change, use D1 Time Travel, which covers the last
30 days on Paid:
`pnpm exec wrangler d1 time-travel info xiaoli --env production` and
`pnpm exec wrangler d1 time-travel restore xiaoli --timestamp <unix-or-iso> --env production`. R2 objects are not versioned.

To take the site down: `pnpm exec wrangler delete --env production`. This removes the worker; D1 and R2 stay.

## 9. Production build locally (no Cloudflare)

```bash
pnpm tsx scripts/deploy/preview-prod.ts            # = pnpm preview:prod once core request deploy#1 lands
pnpm tsx scripts/deploy/smoke.ts --base http://localhost:8787
```

It builds in the worktree and applies migrations to the worktree's own empty local D1. It then serves the production
worker in workerd on `http://localhost:8787` with `NEXTJS_ENV=production`, so `/dev/*` showcase pages are hidden. It
has no DeepSeek key, so extraction answers with an error. `--share-dev-state` uses the repo's local D1/R2 instead,
for `pnpm verify _smoke/perf-budgets --base http://localhost:8787` with seed accounts. `--skip-build` reuses the last
build. It needs about 3 GB of free memory and stops with Ctrl+C.

Other local checks: `pnpm tsx scripts/deploy/build.ts` (build + secret scan + size; report in
`.dev/deploy/build-report.json`), `pnpm tsx scripts/deploy/size-check.ts --dir ../xiaoli-deploy-build`, and
`pnpm tsx scripts/deploy/build.ts --remove-worktree`.

## 10. Troubleshooting

| symptom | cause / fix |
|---|---|
| sign-up returns 403 "invalid origin" | `BETTER_AUTH_URL` differs from the address in the browser. Fix the var and redeploy. |
| every API call returns 500, log shows `invalid server env: BETTER_AUTH_SECRET` | the secret is missing: `setup.ts --apply --only secrets` |
| extraction fails with `unauthorized` / budget errors | wrong `DEEPSEEK_API_KEY` (rotate it), or `LLM_BUDGET_TOKENS` is used up (raise it or move `LLM_BUDGET_SINCE`) |
| `D1_ERROR: no such table` | remote migrations were not applied (§5) |
| build refused: "secret found in build output" | an env file with a secret got into the build dir. Build from the worktree (default), not `--in-place`. |
| size check says `paid` or `too-large` | Workers Paid is needed above 3 MiB gzip; above 10 MiB, remove dependencies |
| logs | `pnpm exec wrangler tail --env production` (observability is enabled in `env.production`) |

## 排查：导入后每段对话都「没有读取成功」

结果页现在会在失败计数后面写明原因。最常见的是配置问题：

- **「抽取服务没有配置好：DEEPSEEK_API_KEY 缺失、无效，或账户余额不足」**：本地看 `.env.local`（仓库里没有这个文件，克隆后要自己建），线上用 `wrangler secret put DEEPSEEK_API_KEY`。自检：`pnpm llm:smoke --live`，它只打印错误码，不打印密钥。
- **「token 预算已经用完」**：`pnpm llm:usage` 看用量，`pnpm llm:usage --reset` 开新一轮。
- **「模型返回的内容不是合法的 JSON」/「读取超时」**：临时性故障，点「重试」即可；连续出现请看 `.dev/server.log`。
