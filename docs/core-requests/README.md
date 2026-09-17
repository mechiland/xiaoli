# Core requests

Builders may not edit paths owned by core (see ARCHITECTURE.md §1.1): package.json, lockfile, configs, `app/layout.tsx`, `app/(app)/layout.tsx`, `app/api/[[...route]]/route.ts`, `server/app.ts`, `server/auth.ts`, `server/middleware/**`, `server/routes/me.ts`, `server/routes/settings.ts`, `server/db/**`, `drizzle/**`, `contracts/**`, `lib/api-client.ts`, `lib/query.ts`, `lib/time.ts`, `lib/pinyin.ts`, `lib/lunar.ts`, `lib/links.ts`, `app/(app)/dev/layout.tsx`, shared `components/ui|loam|topbar`, `tests/helpers/**`, `.gitignore`, `README.md`, and (until wave 4) `wrangler.jsonc` / `open-next.config.ts`. Bootstrap placeholders that core creates once (overlay/picker/evidence components, placeholder pages) belong to their named module from the start: edit them directly, no request needed.

When you need a change there:

1. Append to `docs/core-requests/<your-module>.md` (create if missing; only your own file).
2. Work around it locally inside your own paths meanwhile (e.g. a local type mirroring the proposed schema, marked `// TODO(core-request #N)`), so your module keeps moving.
3. core (wave 1) or the integrator (later waves) processes requests, then marks them.

## Entry format

```md
## #<N> <short title>
- status: open            <!-- open | accepted | done | rejected — only core/integrator changes this -->
- requested-by: <module>, round <r>, <ISO date>
- kind: dependency | schema | contract | config | route-wiring | ui-slot | gitignore | other
- paths: <core-owned paths affected>
- change: <exact change; for deps give package@version and why; for schema give table/columns/indexes; for contracts give the zod diff>
- why: <what breaks or is impossible without it>
- workaround: <what you did meanwhile, and what to remove when done>
- blocking: yes | no
```

Rules:
- One request per entry; number sequentially per file.
- Schema changes: describe columns with SQL type, nullability, default, FK behaviour, and indexes. Core generates the migration; never hand-write files in `drizzle/`.
- Contract changes that alter an API used by another module must name that module; the integrator notifies it via the module's STATUS openIssues.
- Do not request anything that would put real data, names, or secrets into committed files.
