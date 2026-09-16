# ARCHITECTURE.md — 小丽 v1

Binding contract for all builders. SPEC.md = product spec, PLAN.md = process. Where this file and a builder's intuition disagree, this file wins; where this file is wrong, file a core request and record in docs/DECISIONS.md.

Stack (pinned, see DECISIONS.md A1): next 16.3.5 (App Router, Node runtime only), react 19.3.0, @opennextjs/cloudflare 1.20.6, wrangler 4.131.2, better-auth 1.7.5 (+ @better-auth/drizzle-adapter 1.7.5), hono 4.13.8 (+ @hono/zod-validator 0.9.1), drizzle-orm 0.45.2, drizzle-kit 0.31.10, zod 4.6.5, @tanstack/react-query 5.102.8, tailwindcss 4.3.3, shadcn 4.21.0 (CLI, components copied into repo), fflate 0.8.3, lunar-typescript 1.8.6, pinyin-pro 3.29.4, vitest 5.0.0, @playwright/test 1.63.0, typescript 5.9.3, tsx 4.23.13. Core also writes these pinned versions into `README.md` (SPEC §4).

---

## 0. Global rules

- Every module owns an exact, disjoint set of paths (§1). You may only create/modify files inside your paths. Anything else: `docs/core-requests/<module>.md`.
- Shared appends: `docs/DECISIONS.md` (append under `## <module>`, re-read right before editing), `docs/core-requests/<module>.md` (own file only). `docs/STATUS.json` is written only by the orchestrator/integrator.
- Nobody commits. Integrator commits.
- One dev server: `pnpm dev:ensure` (port 3000). Only core/integrator restarts it.
- Import aliases: `@/` = repo root. Cross-module imports are allowed ONLY through the "public entry" listed per module (e.g. `@/lib/wechat-export`, `@/server/llm`, `@/server/extract`, `@/components/evidence`). Never deep-import another module's internals.
- A module's public entry file is created by that module **first thing in its round 1**, with the exact signatures of this document (bodies may throw `ApiError(501,'not_implemented')`), so same-wave consumers compile immediately.
- Tests live inside the owning module's paths (co-located `*.test.ts` or the module's `tests/` dir). Vitest config (core) picks up `**/*.test.ts(x)` excluding `tests/e2e/`, `node_modules`, `.next`, `.open-next`.
- **Rule of waves**: a module may only depend on public entries owned by modules of the same or an earlier wave (walk in §12.1). Same-wave dependencies are covered by a core bootstrap placeholder (§1 "Bootstrap placeholders") or by the first-thing public-entry rule above.

---

## 1. Modules and ownership

Notation: paths are globs relative to repo root. "Public entry" = the only file other modules import.

### 1.1 core (wave 1)
**Owns**
- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `drizzle.config.ts`, `components.json`, `eslint.config.mjs`, `.prettierrc`, `cloudflare-env.d.ts`, `README.md` (incl. pinned-versions table), `.gitignore`, `.dev.vars.example`
- `scripts/dev-ensure.ts`, `scripts/db-reset.ts`, `scripts/with-platform.ts`
- `app/layout.tsx`, `app/globals.css`, `app/providers.tsx`, `app/not-found.tsx`, `app/error.tsx`
- `app/(auth)/**` (sign-in, sign-up pages; **sign-up success redirects to `/welcome`**, sign-in success to `/`)
- `app/(app)/layout.tsx`, `app/(app)/error.tsx`, `app/(app)/loading.tsx`, `app/(app)/dev/layout.tsx` (calls `notFound()` unless `NEXTJS_ENV=development`; hosts module showcase pages, see §8)
- `app/api/[[...route]]/route.ts`
- `server/app.ts`, `server/auth.ts`, `server/auth.config.ts`, `server/env.ts`, `server/context.ts`, `server/errors.ts`, `server/middleware/**`
- `server/db/**` (schema, client, owner helpers), `drizzle/**` (generated migrations)
- `server/routes/_stub.ts`, `server/routes/me.ts`, `server/routes/settings.ts`, and the INITIAL 501 stub of every other `server/routes/<file>.ts` (after creation, ownership transfers to the owner in the table below)
- `contracts/**` (all zod schemas + inferred types)
- `lib/api-client.ts`, `lib/auth-client.ts`, `lib/query.ts`, `lib/time.ts`, `lib/pinyin.ts`, `lib/lunar.ts`, `lib/cn.ts`, `lib/links.ts`
- `components/ui/**` (shadcn primitives, Loam-themed), `components/loam/**` (typography, BlockBoundary, BlockError, Skeleton, Page shell), `components/topbar/**` (TopBar)
- `styles/**` (tokens)
- `tests/helpers/**`, `verify/scenarios/core/**` (top bar + auth showcase)
- **Bootstrap placeholders** (created once by core in wave 1 so the app compiles and every link resolves; ownership = the named module from the start; the module overwrites them):
  - `components/import-overlay/index.tsx` (import), `components/search-overlay/index.tsx` (search), `components/person-picker/index.tsx` (search), `components/evidence/index.tsx` (review) — export exactly the §2.8 names/props with minimal behaviour (overlay hosts render nothing; `PersonPicker` = plain list of `candidates` + "新建人物"; `EvidenceRow` renders children; `EvidenceMark` renders the superscript number, no block).
  - Pages `app/(app)/page.tsx` (home), `app/(app)/p/[id]/page.tsx` (person), `app/(app)/imports/[id]/page.tsx` (import-result), `app/(app)/chats/[id]/page.tsx` (chat), `app/(app)/settings/page.tsx` (settings), `app/(app)/welcome/page.tsx` (home): each renders the Loam page shell with a serif title ("人物 #12", "导入 #3", …) and one line "这一页还在建设中", HTTP 200, no client fetches, no console output. Wave-2 overlays/scenarios navigate to these.
  - `wrangler.jsonc`, `open-next.config.ts` (deploy, from wave 4; changes go through core requests until then).

**Responsibilities**: scaffold; Loam theme & tokens (SPEC §9.1); root & app layouts (auth gate); top bar; Hono assembly with all SPEC §10 routes pre-wired; Better Auth; Drizzle schema & migrations (§4); contracts (§2); owner-scoping helpers; error envelope; `pnpm dev:ensure`; `GET /api/me`, `GET /api/health`, `GET/PATCH /api/settings` (settings API lives in core because wave-2 import overlay and wave-3 home/welcome/import-result all read or write it); README with pinned versions.

**Public entries**: `@/contracts`, `@/server/db` (`getDb`, schema tables, `owned`, `getOwnedOr404`, `withOwner`, `getUserSettings(db, ownerId): Promise<SettingsDTO>`), `@/server/context` (`AppEnv`, `requireUser`, `getR2`; `c.var.env: ServerEnv`), `@/server/env` (`ServerEnvSchema`, `type ServerEnv`, `parseServerEnv(source: Record<string, unknown>): ServerEnv` — used by CLI scripts on `process.env`), `@/server/errors` (`ApiError`, `errors.*`), `@/lib/api-client` (`api`, `unwrap`), `@/lib/auth-client` (`authClient` = `createAuthClient()` from `better-auth/react`, same-origin base URL; re-exports `signIn`, `signUp`, `signOut`, `useSession`; `authClient.changePassword` used by settings, `signOut` by the TopBar account menu, `signIn/signUp` by `app/(auth)/**`), `@/lib/query` (`queryKeys`), `@/lib/time`, `@/lib/pinyin`, `@/lib/lunar`, `@/lib/links`, `@/components/ui/*`, `@/components/loam`, `@/components/topbar`.

**Pure helpers core provides (signatures fixed)**
```ts
// lib/time.ts
nowIso(): string                                   // new Date().toISOString()
parseWechatTime(s: 'YYYY年MM月DD日 HH:MM'): string    // -> 'YYYY-MM-DD HH:MM'
minutesBetween(a: MsgTime, b: MsgTime): number      // MsgTime = 'YYYY-MM-DD HH:MM'
formatMsgTime(t: MsgTime, style: 'full'|'short'|'date'): string
todayInTz(tz?: string): 'YYYY-MM-DD'
// lib/pinyin.ts
indexLetter(label: string): 'A'..'Z' | '#'
sortKey(label: string): string
// lib/lunar.ts
lunarToSolar(year: number, month: number, day: number, isLeap?: boolean): 'YYYY-MM-DD' | null
nextOccurrence(d: { calendar: 'solar'|'lunar'; month: number; day: number; isLeapMonth?: boolean }, today: 'YYYY-MM-DD'): { solar: 'YYYY-MM-DD'; lunarLabel?: string; days: number }
// lib/links.ts  — the ONLY way modules build in-app URLs
personHref(id: number, anchor?: { type: 'claim'|'relation'|'date'|'event'|'handle'; id: number }): string  // '/p/12' | '/p/12#claim-345'
anchorId(type: 'claim'|'relation'|'date'|'event'|'handle', id: number): string                          // 'claim-345' (DOM id)
chatHref(chatId: number, messageId?: number): string     // '/chats/4' | '/chats/4?at=987'
importHref(importId: number): string                     // '/imports/3'
```

### 1.2 parser (wave 1)
**Owns**: `lib/wechat-export/**`
**Responsibilities**: pure TS parser of the WeChat export (SPEC §6) usable in browser and Workers; no Node APIs (`fs`, `Buffer`, `crypto` from node). ZIP unzip via fflate; SHA-256 via `crypto.subtle`; fingerprint.
**Public entry**: `@/lib/wechat-export`
```ts
parseExportZip(zip: Uint8Array | ArrayBuffer, opts?: { fileName?: string; onProgress?: (p: number) => void }): Promise<ParsedExport>  // throws ParseError
parseExportText(txt: string, opts?: { fileName?: string; mediaFiles?: MediaFileInfo[] }): ParsedExport   // pure, no zip
readMediaFiles(zip: Uint8Array | ArrayBuffer, names: string[]): Promise<Map<string, Uint8Array>>          // bytes of selected media (import upload queue)
sha256Hex(bytes: Uint8Array): Promise<string>
fingerprint(m: { senderName: string; sentAt: string; body: string; kind: MessageKind }): string // FNV-1a 64 hex of `${senderName}${sentAt}${kind}${fingerprintBody(kind, body)}`, sync
fingerprintBody(kind: MessageKind, body: string): string // image/video: each generated media file name `微信(图片|视频)_\d{8,14}(_\d+)?.<ext>` → `微信图片_*` / `微信视频_*` (re-exports rename media by export time; SPEC §8.4); every other kind: `body` (parser P14)
messagesDigest(msgs: { senderName: string; sentAt: string; body: string }[]): Promise<string> // sha256 hex of idx-ordered lines `${senderName}\t${sentAt}\t${body}` joined by '\n' (kind deliberately excluded) — gold freeze, §7.2
classifyBody(body: string): { kind: MessageKind; meta: MessageMeta }
extractMentions(body: string): { name: string; addressTerm?: string }[]    // "@显示名 称呼"
summarize(p: ParsedExport): ExportPreview                                   // for the import overlay step 1
PARSER_VERSION: string                                                      // bump on any change affecting idx/body/sender/time/kind/fingerprint; currently `wechat-export@2`
class ParseError extends Error { code: 'not_zip'|'no_txt'|'no_messages'|'bad_encoding' }
```
Fingerprint changes (`wechat-export@2`, core request parser#1): stored `messages.fingerprint` rows are rewritten once per D1 with `npx tsx lib/wechat-export/scripts/backfill-fingerprints.ts [--remote [--env <name>]]` (idempotent, prints counts only; deploy runbook); any other code computing a fingerprint imports `fingerprint` from this entry rather than copying the formula. Output shape = `ParsedExportSchema` (§2.3). Dependencies: core `contracts` (types only), core `lib/time.parseWechatTime` (`lib/time.ts` is pure; parser must not import anything that imports server code).

### 1.3 llm (wave 1)
**Owns**: `server/llm/**`, `scripts/llm-usage.ts`, the cassette **format and directory layout** under `fixtures/cassettes/**`. Cassette *files* under `fixtures/cassettes/synthetic/**` and `fixtures/cassettes/real/**` are generated artifacts written only by record-mode runs (llm tests, `pnpm eval --live`, `pnpm extract:offline --live`); nobody hand-edits them. Hand-written cassettes for failure tests live inside the testing module (e.g. extract: `server/extract/__fixtures__/cassettes/**`) and are loaded by passing that `cassetteDir`.
**Responsibilities**: adapter interface, DeepSeek impl (fetch, no SDK), JSON mode, timeouts/deadline, transport-level retries, call logging (D1 in app, JSONL in CLI), cassette record/replay, token budget (file in dev/CLI, D1 sum when deployed), usage totals + loop reset for STATUS.json.
**Public entry**: `@/server/llm` — see §5.

### 1.4 import (wave 2)
**Owns**: `server/routes/imports.ts` (whole file), `server/routes/chats-list.ts`, `server/import/**`, `components/import-overlay/**`, `app/(app)/dev/import/**`, `tests/e2e/import/**`, `verify/scenarios/import/**`
**Responsibilities**: `POST /api/imports/check`, `POST /api/imports`, `PUT /api/imports/:id/attachments/:name`, `GET /api/imports/:id`, `POST /api/imports/:id/mapping`, `DELETE /api/imports/:id` (delete semantics §11), `POST /api/imports/:id/jobs/next` and `/jobs/retry` (route wiring; bodies fixed below, delegate to extract), `GET /api/chats` (chat list + recommendation), **the staged parsed payload between POST and mapping** (below), message dedup/LCS alignment (SPEC §8.4), job creation (calls `extract.createJobsForImport`), attachment row creation, R2 attachment writes, import overlay UI (3 steps), global drag-and-drop layer, **the client attachment upload queue and its status UI** (SPEC §8.2, §9.7 step 3 "上传…在结果页上继续"), **abandoned-import handling** (below). The delete-import *button* is import-result's (§1.10); import owns the route and `deleteImport`.
Fixed handler bodies in `imports.ts` (import owns the file; these two bodies are contractual):
```ts
.post('/imports/:id/jobs/next', validator('param', IdParamSchema), validator('json', JobsNextRequestSchema), async (c) => {
  const user = requireUser(c); const { id } = c.req.valid('param')
  const deadlineAt = Date.now() + 28_000
  return c.json(await processNextJob(c.var.db, await getAppLlm(c), user.id, id, { deadlineAt, env: c.var.env }))
})
.post('/imports/:id/jobs/retry', validator('param', IdParamSchema), validator('json', JobsRetryRequestSchema), async (c) => {
  const user = requireUser(c); const { id } = c.req.valid('param')
  return c.json(await retryFailedJobs(c.var.db, user.id, id, c.req.valid('json').jobIds))
})
```
**Public entries**: `@/components/import-overlay` → `ImportOverlayHost`, `useImportOverlay`, `AttachmentUploadStatus`, `useAttachmentUploads` (full props §2.8). `@/server/import` → `alignMessages`, `deleteImport`.
```ts
alignMessages(existing: { id: number; seq: number; fingerprint: string; sentAt?: MsgTime }[], incoming: ParsedMessage[]): { reuse: { incomingIdx: number; messageId: number }[]; insert: { incomingIdx: number; seq: number }[]; resequence: { messageId: number; seq: number }[]; newSeqRanges: [number, number][] }
deleteImport(db: Db, r2: R2Bucket, ownerId: string, importId: number): Promise<DeleteImportResult>
// existing[].sentAt (optional): unmatched incoming messages are placed by time between matched anchors (after the last stored message sent at or before them); without it a disjoint later export would land before the stored messages. DECISIONS import I1.
// resequence: a rank renumber (stored message k, 0-based in seq order → (k+1)·unit), never a multiplication of old seqs. DECISIONS import I15.
// server/import/staging.ts (import-internal, not a public entry)
stagedPayloadKey(ownerId: string, importId: number): string   // `u/${ownerId}/imp/${importId}/parsed.json`
putStagedPayload(r2: R2Bucket, ownerId: string, importId: number, p: StagedImportPayload): Promise<void>
getStagedPayload(r2: R2Bucket, ownerId: string, importId: number): Promise<StagedImportPayload | null>   // null → mapping answers 409 `conflict` "请重新选择这份文件"
deleteStagedPayload(r2: R2Bucket, ownerId: string, importId: number): Promise<void>                      // idempotent
```
**Import data lifecycle (storage between step 1 and step 2)** — option "R2 staging"; DECISIONS A7 #1:
1. `POST /api/imports` (end of overlay step 1) validates `CreateImportRequest`, inserts the `imports` row (status `mapping`, `chat_id` null, `message_count`, `date_from/to`, `stats` computed from the body), then writes `StagedImportPayload` (§2.3: `{ formatVersion: 1, importId, parserVersion, messages, media, selectedAttachments }`, JSON) to R2 at `u/<ownerId>/imp/<importId>/parsed.json` (§11 key layout). **No `messages`, `import_messages` or `attachments` rows exist yet.** If the R2 put fails, the import row is deleted and the route returns 500. Reason: `messages.chat_id`/`seq` need the chat chosen in step 2; a 50k-message body (~10–15 MB) exceeds D1's per-value/row size limit, so it cannot sit in a D1 column; and keeping the body server-side lets step 2 be retried without re-uploading.
2. `POST /api/imports/:id/mapping` (status guard: conditional claim `mapping → parsed`, so `parsed` marks a mapping request in flight; any failure deletes the rows it inserted, restores re-pointed handles, re-selected attachments, renumbered seqs and job windows (DECISIONS import I16), and returns the status to `mapping`, keeping the staged payload for retry — DECISIONS import I2) → `getStagedPayload` → resolves/creates the chat and sender persons/handles → `alignMessages(existing messages of that chat, payload.messages)` (so `incoming` = the staged `messages`) → batched writes in this order: resequence: when a gap is too small the chat is renumbered to rank × unit (unit a power of two ≥ (largest gap + 1)·1024; seqs ≤ 2^52), in one atomic batch that first moves the extraction job windows of the chat's other imports onto the new numbering (same messages), then updates messages two-phase; runs **before** the inserts, new seqs are computed against the renumbered values, new `messages` (with `first_import_id`), `import_messages` for every incoming message (reused + inserted), **then `attachments` rows** for every *inserted* message whose `attachmentName` is non-null (or whose kind is image/video/file with a null name → `file_name` null, `selected` 0); `selected = 1` iff the name is in `payload.selectedAttachments`. For a *reused* message that already has an attachment row with `selected = 0`, `uploaded = false`, and the name is now selected → set `selected = 1`. Then link `imports.chat_id` (must happen **before** jobs: `createJobsForImport` reads the import's chat and answers 409 while it is null — DECISIONS import I3), `createJobsForImport(newSeqRanges)`, set `new_message_count`, status → `extracting` (last statement of the final batch), then `deleteStagedPayload` (failure only logged; `deleteImport` and delete-all also remove the prefix).
3. `PUT /api/imports/:id/attachments/:name` finds the row via `attachments ⋈ import_messages (import_id = :id) where file_name = :name and selected = 1`; therefore it is only valid after mapping (409 `conflict` while status is `mapping`).
**Abandoned imports (closed at step 2)** — DECISIONS A7 #2:
- Overlay: closing the overlay (×, Esc, backdrop) while on step 2 of an import it created calls `DELETE /api/imports/:id` (`fetch(..., { keepalive: true })`, fire-and-forget) and removes the id from `upload-store`. No confirm dialog (nothing the user entered is lost except step-2 picks).
- Server safety net for a tab closed mid-step-2: `POST /api/imports/check` returns `{ duplicate: false }` when the only row with that sha has status `mapping` or `parsed` (both stale, never a duplicate); `POST /api/imports` with such a sha first runs `deleteImport` on the stale `mapping` row (it has no messages; this removes the row and its staged payload), then creates the new import. Only rows with status ∉ {`mapping`, `parsed`} count as duplicates (409). A concurrent tab still mapping the old id gets 404 on mapping → its overlay returns to step 1 with "这份文件在别处重新开始导入了".
- `mapping` imports never appear in `GET /api/home` `recentImports` (home filters `status != 'mapping'`) or chat import lists (they have no chat). `/imports/:id` for a `mapping` import renders import-result's "unfinished" state (§1.10).
**Attachment upload lifecycle (import owns end to end)**
1. Step 1: the overlay keeps the ZIP `File` object (not the unzipped bytes) in a **module-level store** `components/import-overlay/upload-store.ts`: `Map<importId, { file: File; sha256: string; names: string[] }>`, filled after `POST /api/imports` returns the import id. The store lives in JS module scope, so it survives the overlay closing and client-side route changes (`app/(app)/layout.tsx` never unmounts).
2. After `POST /api/imports/:id/mapping` succeeds, the overlay calls `startUploads(importId)` (module-level async runner, not tied to any component): reads selected media via `readMediaFiles`, then `PUT /api/imports/:id/attachments/:name` sequentially (1 at a time, 2 retries each), skipping names the server reports as already uploaded (`GET /api/imports/:id` → `uploads.pendingNames`). The overlay then closes and navigates to `importHref(id)`.
3. `/imports/:id` (import-result) mounts `<AttachmentUploadStatus importId />`, which subscribes to the store via `useAttachmentUploads(importId)` and renders a single quiet line ("正在上传图片 3 / 12", "图片已上传", or the reload state below). Extraction does not wait for uploads.
4. **Reload / new tab**: the store is empty; server state is authoritative — attachment rows keep `selected=1, r2_key=null` (`AttachmentDTO.uploaded=false`). `useAttachmentUploads` returns `phase: 'needs_file'` when `uploads.pendingNames.length > 0` and no file is in the store; the status line shows "有 N 张图片还没有上传 · 重新选择这份文件继续" — clicking opens a file picker inside the component, verifies `sha256` equals `import.fileSha256` (mismatch → "这不是同一份文件"), then resumes. If ignored, those attachments show "图片未导入" on the chat page. No blocking, no notification.

### 1.5 extract (wave 2)
**Owns**: `server/extract/**` (incl. `server/extract/__fixtures__/**` hand-written test cassettes), `prompts/**`, `scripts/extract-offline.ts`
**Responsibilities**: windowing (SPEC §8.5 + §8.4 context), prompt rendering, LLM call via `@/server/llm`, zod validation (`ExtractionOutputSchema`), evidence-in-window check, tempId resolution, semantic dedup (one LLM call per person with candidates), deterministic sensitive guard, supersede linking, persistence to D1, job claiming, retry reset & progress, per-request deadline. Retry policy for windows (max 2 retries, then failed).
**Public entry**: `@/server/extract` — see §6.

### 1.6 review (wave 2)
**Owns**: `server/routes/review.ts`, `server/routes/evidence.ts`, `server/routes/imports-review.ts`, `server/routes/people-actions.ts`, `server/review/**`, `components/evidence/**`, `app/(app)/dev/review/**`, `verify/scenarios/review/**`
**Responsibilities**: `POST /api/review/:type/:id`, `POST /api/review/bulk`, `GET /api/evidence/:type/:id`, `GET /api/imports/:id/review` (grouping query), `POST /api/people` (create person), `POST /api/people/:id/merge`, `POST /api/people/:id/split`, manual add `POST /api/people/:id/claims|dates|relations|events`, reviewLog writes, supersede on confirm, merge/split data moves, hard delete of items, **the shared Evidence UI component** (SPEC §9.6; used by person, import-result, anything else).
**Public entries**: `@/server/review` → `applyReview(db, ownerId, target, action, patch?)`, `mergePersons(db, ownerId, fromId, intoId)`, `splitHandle(db, ownerId, personId, handleId, into?)`, `getEvidence(db, ownerId, type, id, context=2)`, `getImportReview(db, ownerId, importId)`, `createPerson(db, ownerId, label)`. `@/components/evidence` → `EvidenceRow`, `EvidenceMark`, `EvidenceBlock`, `useEvidence` (§2.8).

### 1.7 person (wave 3)
**Owns**: `app/(app)/p/**`, `components/person/**`, `server/routes/people.ts`, `server/person/**`, `app/(app)/dev/person/**`, `verify/scenarios/person/**`
**Responsibilities**: `GET /api/people/:id` (profile aggregate incl. infobox derivation), `PATCH /api/people/:id` (label, pinned), `DELETE /api/people/:id` (delete semantics §11), person page UI (SPEC §9.5) using `@/components/evidence` (review) and `@/components/person-picker` (search, for "合并到其他人物"), **anchor handling**: on load and on `hashchange`, if `location.hash` = `#claim-<id>` (or `#relation-|#date-|#event-|#handle-<id>`), expand the containing collapsed region (history / alias list / narrow-screen infobox), `scrollIntoView({ block: 'center' })` the element whose DOM id is `anchorId(type, id)`, and set `data-highlight="true"` for 2 s (Loam low-saturation background fade). Every claim/relation/date/event/handle row rendered by person carries `id={anchorId(type, id)}`.
**Public entries**: `@/server/person` → `getProfile(db, ownerId, personId)`, `deletePerson(db, r2, ownerId, personId)`.

### 1.8 search (wave 2)
**Owns**: `server/routes/search.ts`, `server/routes/people-index.ts`, `server/search/**`, `components/search-overlay/**`, `components/person-picker/**`, `app/(app)/dev/search/**`, `verify/scenarios/search/**`
**Responsibilities**: `GET /api/search?q=&types=` (persons by label + handles; confirmed claims by statement; LIKE on normalized text, pinyin initials for Latin queries; merged persons excluded), `GET /api/people?index=pinyin` (people index), search overlay (⌘K / Ctrl K / `/`), keyboard nav, claim result link = `personHref(personId, { type: 'claim', id: claimId })` (SPEC §9.8 scroll + highlight is performed by person), "新建人物『q』" empty-state action (calls `POST /api/people`, owned by review, then navigates to `personHref(id)`), **the shared PersonPicker component** (used by import overlay step 2, import-result "其实是……", person merge).
**Public entries**: `@/components/search-overlay` → `SearchOverlayHost`, `useSearchOverlay`, `SearchTrigger`; `@/components/person-picker` → `PersonPicker`, `usePersonSearch` (§2.8); `@/server/search` → `searchAll(db, ownerId, q, opts)`, `listPeopleIndex(db, ownerId): Promise<PeopleIndexResponse>`.

### 1.9 home (wave 3)
**Owns**: `app/(app)/page.tsx`, `app/(app)/_home/**`, `app/(app)/welcome/**`, `components/home/**`, `server/routes/home.ts`, `server/home/**`, `app/(app)/dev/home/**`, `verify/scenarios/home/**`
**Responsibilities**: `GET /api/home` (upcoming dates 30d w/ lunar conversion, recently-updated persons, pinned, people index via `@/server/search.listPeopleIndex`, recent imports, `isEmpty`, `needsOnboarding`), home page sections (SPEC §9.4), first-run onboarding `/welcome` (SPEC §9.12; route not in SPEC §9.2 list — DECISIONS A5 #21; core's sign-up redirects there; "保存" and "跳过" both `PATCH /api/settings { onboarded: true, … }` then go to `/`; `(app)/layout` does NOT force-redirect on `needsOnboarding`), empty-state dropzone (its own UI; click/drop calls `useImportOverlay().open({ file })`).

### 1.10 import-result (wave 3)
**Owns**: `app/(app)/imports/**`, `components/import-result/**`, `app/(app)/dev/import-result/**`, `verify/scenarios/import-result/**`
**Responsibilities**: page `/imports/:id` (SPEC §9.9): progress loop calling `POST /api/imports/:id/jobs/next` sequentially while mounted, fades in new items, per-person sections, confirm/reject/edit, bulk confirm (threshold from `GET /api/me` settings; count = `highConfidenceCount`), "变化" two-column, "其实是……" merge via `PersonPicker` + `POST /api/people/:id/merge`, retry failed windows (`POST /api/imports/:id/jobs/retry`), finished states. **Mounts `<AttachmentUploadStatus importId />` (import) below the subtitle**; does not implement uploading.
**Delete this import (the only UI for `DELETE /api/imports/:id`; PLAN §5 final flow)**: a quiet small gray text button "删除这次导入" at the very foot of the page (below "已全部处理"/item list, never in the header; available in every state incl. extracting — the progress loop stops first). Click → shadcn `AlertDialog`: title "删除这次导入？", body "这次导入首次带来的消息会被删除；只由这些消息支持的信息也会一起删除，还有其他证据的信息会保留。", buttons "取消" / "删除" (destructive). On confirm: `DELETE /api/imports/:id` → on 200 `queryClient.invalidateQueries()` → `router.replace('/')`; on error an inline BlockError-style line inside the dialog, dialog stays open. No undo, no toast.
**Unfinished import state**: when `GET /api/imports/:id` returns `import.status = 'mapping'` (user left during overlay step 2 and the overlay's cleanup did not run), the page renders only the title "这次导入没有完成", one line "可以重新导入这份文件。" and the same "删除这次导入" control; no progress loop, no review query.
Consumes: `GET /api/imports/:id`, `GET /api/imports/:id/review`, `DELETE /api/imports/:id`, review endpoints, `PATCH /api/people/:id` (person; rename of a new person, SPEC §9.9 — until person's handler lands it answers 501 and the page shows "名字暂时改不了"), `GET /api/people/:id` (person; context line for same-label candidates and the chosen target in the "其实是……" dialog, cached under `queryKeys.person(id)`; a redirect or error leaves the line out), `@/components/evidence` (review), `@/components/person-picker` (search), `@/components/import-overlay` (import).

### 1.11 chat (wave 3)
**Owns**: `app/(app)/chats/**`, `components/chat/**`, `server/routes/chats.ts`, `server/chat/**`, `app/(app)/dev/chat/**`, `verify/scenarios/chat/**`
**Responsibilities**: `GET /api/chats/:id`, `GET /api/chats/:id/messages`, `GET /api/attachments/:id`; chat page `/chats/:id?at=:msgId` (SPEC §9.10), windowed message loading around a message, attachment thumbnails via R2 streaming route, "导入新的记录" (calls `useImportOverlay().open({ chatId })`). (`GET /api/chats` list is import's `chats-list.ts`.)

### 1.12 settings (wave 3)
**Owns**: `app/(app)/settings/**`, `components/settings/**`, `server/routes/export.ts`, `server/settings/**`, `app/(app)/dev/settings/**`, `verify/scenarios/settings/**`
**Responsibilities**: settings page UI (reads/writes core's `GET/PATCH /api/settings`), `GET /api/export` (full JSON dump, table list §11), `DELETE /api/data` (delete all owner data, table list §11; typed confirmation `"删除全部数据"`), account section (change password via `authClient.changePassword` from `@/lib/auth-client` (core), sign out via `signOut`). The model select shows "默认（deepseek-flash）" for `extractModel: null` and PATCHes `null` to reset.

### 1.13 deploy (wave 4)
**Owns**: `wrangler.jsonc`, `open-next.config.ts` (from wave 4; core bootstraps), `scripts/deploy/**`, `docs/DEPLOY.md`, `.github/**`
**Responsibilities**: remote D1/R2 creation, remote migrations, `wrangler secret put DEEPSEEK_API_KEY`, `opennextjs-cloudflare build/deploy`, worker size check (≤ 10 MiB gz paid / 3 MiB free), deploy smoke script, `pnpm preview:prod` script body (§8).

### 1.14 verify-seed (infra, wave 1c)
**Owns**: `verify/lib/**`, `verify/cli.ts`, `verify/scenarios/_smoke/**`, `verify/scenarios/auth/**`, `verify/scenarios/e2e/**`, `scripts/seed/**`, `playwright.config.ts`, `tests/e2e/_support/**`
**Responsibilities**: `pnpm verify <scenario>` (§8), `pnpm verify:list`, `pnpm seed` (§9), seed accounts, scenario discovery, JSON log, perf measurement (`_smoke/perf-budgets`), re-seed after `destructive` scenarios (§8), `e2e/blind-shots` screenshot scenario for the blind comparison (§12.2).

### 1.15 eval-synthetic (infra, wave 1b)
**Owns**: `fixtures/synthetic/**` (ZIPs + `*.intent.json`), `scripts/synthetic/**` (generator), `eval/src/**`, `eval/prompts/**`, `eval/tests/**` (hand-built mini gold + predictions for metric unit tests; not real gold), `eval/judge-cache/**`, `eval/reports/**`, `eval/runs/**` (gitignored scratch).
**Does NOT own `eval/gold/**`** — gold (synthetic and real) is written only by the **annotator** role (§7.6).
**Responsibilities**: synthetic ZIP generator + committed ZIPs covering all SPEC §6 kinds and edge cases, each with an `intent.json` (what the generator planted; annotator must not read it before freezing, §7.6); gold zod schema; annotation tools (`eval:annotate-view`, `eval:gold-template`, `eval:validate-gold`, `eval:freeze-gold`); `pnpm eval` harness (§7), LLM judge with cache, metric computation, report writing, prompt-version comparison.

### 1.16 annotator (role, not a code module; wave 2 start)
**Owns**: `eval/gold/synthetic/**` (committed), `eval/gold/real/**` (gitignored), `eval/gold/LOCK.json` (committed; the single append-only lock for both sources, real entries keyed by hash only, §7.6), `## annotator` section in DECISIONS.md.
Protocol in §7.6. Not in STATUS.json modules (no critic); gold validity is checked by `pnpm eval:validate-gold` and by the extract critic before gating.

### Ownership of `server/routes/*` (core creates each as 501 stub, then the owner owns it)

| file | owner | routes |
|---|---|---|
| `server/routes/me.ts` | core | `GET /api/me`, `GET /api/health` |
| `server/routes/settings.ts` | core | `GET /api/settings`, `PATCH /api/settings` |
| `server/routes/imports.ts` | import | `POST /api/imports/check`, `POST /api/imports`, `GET/DELETE /api/imports/:id`, `PUT /api/imports/:id/attachments/:name`, `POST /api/imports/:id/mapping`, `POST /api/imports/:id/jobs/next`, `POST /api/imports/:id/jobs/retry` |
| `server/routes/chats-list.ts` | import | `GET /api/chats` |
| `server/routes/imports-review.ts` | review | `GET /api/imports/:id/review` |
| `server/routes/review.ts` | review | `POST /api/review/bulk`, `POST /api/review/:type/:id` (bulk registered first) |
| `server/routes/people-actions.ts` | review | `POST /api/people`, `POST /api/people/:id/merge`, `POST /api/people/:id/split`, `POST /api/people/:id/claims`, `/dates`, `/relations`, `/events` |
| `server/routes/people-index.ts` | search | `GET /api/people` |
| `server/routes/evidence.ts` | review | `GET /api/evidence/:type/:id` |
| `server/routes/people.ts` | person | `GET/PATCH/DELETE /api/people/:id` |
| `server/routes/chats.ts` | chat | `GET /api/chats/:id`, `GET /api/chats/:id/messages`, `GET /api/attachments/:id` |
| `server/routes/home.ts` | home | `GET /api/home` |
| `server/routes/search.ts` | search | `GET /api/search` |
| `server/routes/export.ts` | settings | `GET /api/export`, `DELETE /api/data` |

Each router file default-exports a Hono sub-app built with **chained** calls (required for RPC type inference):
```ts
// server/routes/home.ts
import { Hono } from 'hono'
import type { AppEnv } from '@/server/context'
const route = new Hono<AppEnv>()
  .get('/home', async (c) => { const user = requireUser(c); ... return c.json(data satisfies HomeResponse) })
export default route
```
`server/app.ts` (core) mounts under `/api` in this order: (1) Better Auth handler on `/auth/*`; (2) `Server-Timing` middleware; (3) **session middleware**: sets `c.var.env` (`parseServerEnv(getCloudflareContext().env)`, cached per isolate; invalid env → 500 `internal` with the variable name logged, never its value), resolves the session and sets `c.var.user` (or null) and `c.var.db`; for every path except `/api/auth/*` and `/api/health` it returns the 401 envelope when there is no user (so no route can forget auth); `requireUser(c)` returns the non-null user; (4) routers: me, settings, imports, chats-list, imports-review, review, people-actions, people-index, evidence, people, chats, home, search, export. Route files must not define paths owned by another file. More specific paths (`/people/:id/merge`) are registered in `people-actions` BEFORE `people`.

The 501 stub (core): `server/routes/_stub.ts` exports `notImplemented(c)` returning the error envelope with code `not_implemented`, status 501. Stubs declare every route with its zod validator so `AppType` is complete from day one.

### UI slots (core)
`components/topbar/TopBar.tsx` renders: left 产品名 link `/`; center `<SearchTrigger variant="topbar" />` (the component itself collapses to an icon under 640px); right `导入` button (`useImportOverlay().open()`) + account menu (设置 → `/settings`, 退出). Overlay hosts are mounted once in `app/(app)/layout.tsx`:
```tsx
<QueryProvider>
  <TopBar />
  <main>{children}</main>
  <ImportOverlayHost />   {/* @/components/import-overlay (import) — includes the global drag-and-drop layer */}
  <SearchOverlayHost />   {/* @/components/search-overlay (search) */}
</QueryProvider>
```
Overlay open state lives in each host module's own module-level store (`useSyncExternalStore`), so `useImportOverlay()` / `useSearchOverlay()` work from any client component without a provider.

---

## 2. Shared contracts (`contracts/`, owned by core)

All zod v4. Each file exports schemas `XxxSchema` and types `type Xxx = z.infer<typeof XxxSchema>`. `contracts/index.ts` re-exports all. Contracts import nothing from server/ or app/. (UI component prop types, §2.8, are TypeScript interfaces exported from the owning component module, not zod.)

### 2.1 Primitives — `contracts/common.ts`
```ts
Id = z.number().int().positive()
IdParamSchema = z.object({ id: z.coerce.number().int().positive() })
IsoString = z.string().datetime({ offset: true })        // 2026-09-15T08:00:00.000Z
MsgTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
PartialDate = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)
Status = z.enum(['proposed','confirmed','rejected','superseded'])
SourceKind = z.enum(['ai','manual'])
Category = z.enum(['work','location','education','family','preference','life_event','other'])
TargetType = z.enum(['handle','relation','claim','event','date'])
MessageKind = z.enum(['text','sticker_code','image','video','voice','transfer','red_packet','mini_program','channels','animated_sticker','video_call','quote','recall','system','file','link','location','contact_card','forward','unknown'])
HandleKind = z.enum(['display_private','display_group','mentioned','real_name','address_term'])
ChatKind = z.enum(['private','group'])
ImportStatus = z.enum(['parsed','mapping','extracting','reviewing','done','failed'])
JobStatus = z.enum(['pending','running','done','failed'])
ReviewAction = z.enum(['accept','reject','edit','merge','split','supersede','delete'])
ExtractModel = z.enum(['deepseek-flash','deepseek-v4-pro'])
ApiErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }) })
Progress = { total: number, done: number, failed: number, pending: number, running: number, failures?: { code: string /* WindowErrorCode */, n: number }[] /* additive; present only when failed > 0, so the result page can name the cause (DECISIONS ## import-result) */ }
```

### 2.2 Entity DTOs — `contracts/entities.ts` (API-facing; `ownerId` never serialized)
```ts
ChatDTO        { id, title, kind: ChatKind, note: string|null, messageCount: number, lastMessageAt: MsgTime|null, createdAt, updatedAt }
ImportDTO      { id, chatId: Id|null, fileName, fileSha256, exportedAt: IsoString|null, status: ImportStatus, messageCount, newMessageCount, dateFrom: MsgTime|null, dateTo: MsgTime|null, stats: ImportStats, error: string|null, createdAt, updatedAt }
ImportStats    { byKind: Partial<Record<MessageKind, number>>, bySender: Record<string, number>, images: {count, bytes}, videos: {count, bytes} }
MessageDTO     { id, chatId, seq, sentAt: MsgTime, kind: MessageKind, body: string, meta: MessageMeta|null, senderHandleId: Id|null, senderName: string, senderPersonId: Id|null, senderLabel: string|null, attachments: AttachmentDTO[] }
MessageMeta    { durationSec?: number; title?: string; url?: string; fileName?: string; label?: string; transferState?: string; greeting?: string; quoted?: {senderName: string; body: string} }
AttachmentDTO  { id, messageId, kind: 'image'|'video'|'file', fileName: string|null, selected: boolean, uploaded: boolean, byteSize: number|null, mime: string|null, url: string|null /* /api/attachments/:id when uploaded */ }
PersonDTO      { id, label, isSelf, mergedIntoId: Id|null, pinned, avatarUrl: string|null, lastMessageAt: MsgTime|null, createdAt, updatedAt }
PersonRefDTO   { id, label }
HandleDTO      { id, personId: Id|null, kind: HandleKind, value, chatId: Id|null, chatTitle: string|null, status: Status, importId: Id|null, sourceKind, evidenceCount: number, createdAt }
RelationDTO    { id, fromPersonId, toPersonId, from: PersonRefDTO, to: PersonRefDTO, type: string, label: string|null, status, importId, sourceKind, evidenceCount, createdAt }
ClaimDTO       { id, personId, statement, category, validFrom: PartialDate|null, validTo: PartialDate|null, learnedAt: IsoString, confidence: number|null /* null for manual */, sensitive: boolean, status, supersedesClaimId: Id|null, supersededByClaimId: Id|null, importId: Id|null, sourceKind, mentions: PersonRefDTO[], evidenceCount, createdAt, statusChangedAt: IsoString, statusReason: 'superseded'|'outdated'|'edited'|null }
EventDTO       { id, summary, happenedAt: PartialDate|null, place: string|null, status, importId, sourceKind, participants: PersonRefDTO[], evidenceCount, createdAt }
ImportantDateDTO { id, personId, kind: string, day: number|null, month: number|null, year: number|null, calendar: 'solar'|'lunar', isLeapMonth: boolean, label: string|null, status, importId, sourceKind, next: { solar: 'YYYY-MM-DD', lunarLabel: string|null, days: number } | null, evidenceCount, createdAt }
ExtractionJobDTO { id, importId, windowStartSeq, windowEndSeq, status: JobStatus, attempts, model: string|null, promptVersion: string|null, error: string|null }
ReviewLogDTO   { id, targetType, targetId, action, before: unknown, after: unknown, createdAt }
SettingsDTO    { selfDisplayNames: string[], extractModel: ExtractModel | null /* null = not chosen → env EXTRACT_MODEL → 'deepseek-flash' (resolveExtractModel, §6); getUserSettings never fills a default */, highConfidenceThreshold: number /*0..1, default 0.8*/, onboardedAt: IsoString|null }
EvidenceItemDTO{ messageId, chatId, chatTitle, messages: (MessageDTO & { isEvidence: boolean })[] }   // evidence msg + `context` before/after
LlmCallDTO     { see §2.6 }
```
`claim.mentions` is derived from the `claim_mentions` table (§4), filled by extract (and review for manual claims) when a claim statement contains another person's label. Person UI links the first occurrence of each mentioned label.

### 2.3 Parsed export — `contracts/parsed-export.ts` (produced by parser, uploaded by import)
```ts
ParsedMessage   { idx: number /*0-based order in file*/, senderName: string, sentAt: MsgTime, kind: MessageKind, body: string, meta: MessageMeta|null, fingerprint: string, attachmentName: string|null }
MediaFileInfo   { name: string, path: string, kind: 'image'|'video'|'file', byteSize: number, mime: string, referenced: boolean }
ParsedExport    { formatVersion: 1, parserVersion: string, fileName: string, exportedAt: IsoString|null /*from 聊天记录_YYYYMMDD_HHMMSS, Asia/Shanghai local → ISO Z*/, sha256: string, messages: ParsedMessage[], senders: {name: string, count: number}[], media: MediaFileInfo[], dateFrom: MsgTime|null, dateTo: MsgTime|null, warnings: {line: number, code: string}[] }
ExportPreview   { messageCount, dateFrom, dateTo, senders, byKind, images: {count, bytes}, videos: {count, bytes} }
StagedImportPayload { formatVersion: 1, importId: Id, parserVersion: string, messages: ParsedMessage[], media: MediaFileInfo[], selectedAttachments: string[] }   // R2 `u/<ownerId>/imp/<importId>/parsed.json`, written by POST /api/imports, read by mapping, deleted after status → extracting (§1.4)
```
`attachmentName` resolution: parser matches `[图片] 微信图片_...jpg` to `media[].name`; empty filename → null (attachment row still created with `fileName: null`, `selected: false`).

### 2.4 API request/response — `contracts/api/*.ts` (one file per route group)

Every non-2xx response body is `ApiErrorBody`. All JSON unless noted. **All routes require a session except `/api/auth/*` and `GET /api/health`** (enforced centrally by core's session middleware, §1).

| Method & path | Request (zod) | Response 2xx |
|---|---|---|
| `GET /api/health` | – | `{ ok: true, db: boolean }` |
| `GET /api/me` | – | `{ user: {id: string, email, name}, settings: SettingsDTO }` |
| `GET /api/settings` | – | `{ settings: SettingsDTO }` |
| `PATCH /api/settings` | `{ selfDisplayNames?: string(1..40)[] (max 10), extractModel?: ExtractModel \| null /*null = back to default*/, highConfidenceThreshold?: number(0.5..1), onboarded?: true }` | `{ settings: SettingsDTO }` |
| `POST /api/imports/check` | `{ sha256: string }` | `{ duplicate: false } \| { duplicate: true, importId: Id }` — only imports with status ≠ `mapping` count; a stale `mapping` row with that sha → `{ duplicate: false }` (it is replaced by the next POST, §1.4) |
| `POST /api/imports` | `CreateImportRequest { fileName, sha256, exportedAt: IsoString\|null, parserVersion: string, messages: ParsedMessage[] (max 50k), media: MediaFileInfo[], selectedAttachments: string[] /*names*/ }` | 201 `{ import: ImportDTO /*status 'mapping'*/, suggestions: MappingSuggestions }`; body staged in R2, no message rows yet (§1.4); 409 `duplicate_import` with `details: {importId}` only for a non-`mapping` import; a stale `mapping` import with the same sha is deleted first |
| `PUT /api/imports/:id/attachments/:name` | raw body (bytes), header `content-type`; `:name` URL-encoded; must match an attachment row of this import with `selected = 1` (rows are created by mapping); import status `mapping` → 409 `conflict`; max 20 MB image / 100 MB video | `{ attachment: AttachmentDTO }` (idempotent: already uploaded → 200 same DTO) |
| `GET /api/imports/:id` | – | `{ import: ImportDTO, chat: ChatDTO\|null, progress: Progress, uploads: { selected: number, uploaded: number, pendingNames: string[] }, persons: PersonRefDTO[] }` |
| `POST /api/imports/:id/mapping` | `MappingRequest { chat: {existingChatId: Id} \| {new: {title: string(1..80), kind: ChatKind}}, senders: { senderName: string, target: {self: true} \| {personId: Id} \| {newPerson: {label: string(1..60)}} }[] }` | `{ import: ImportDTO, chat: ChatDTO, jobsCreated: number, newMessageCount: number }`; 409 `conflict` if status ≠ `mapping` or the staged payload is missing; 404 if the import was deleted/replaced |
| `POST /api/imports/:id/jobs/next` | `JobsNextRequest {}` | `JobsNextResponse { processed: {jobId, status: JobStatus, itemsCreated: number, code?: string} \| null, progress: Progress, importStatus: ImportStatus }` |
| `POST /api/imports/:id/jobs/retry` | `JobsRetryRequest { jobIds?: Id[] }` (default all failed) | `{ reset: number, progress: Progress }` |
| `GET /api/imports/:id/review` | – | `ImportReviewResponse` (below) |
| `DELETE /api/imports/:id` | – | `DeleteImportResult { deletedMessages, reassignedMessages, deletedItems: Record<TargetType, number>, detachedEvidence: number, deletedPersons: number }` |
| `GET /api/chats` | `?senders=name1,name2` (optional, for recommendation) | `{ chats: (ChatDTO & { matchReason: string\|null, score: number })[] }` |
| `GET /api/chats/:id` | – | `{ chat: ChatDTO, participants: (PersonRefDTO & {messageCount})[], imports: Pick<ImportDTO,'id'\|'dateFrom'\|'dateTo'\|'createdAt'\|'newMessageCount'>[] }` |
| `GET /api/chats/:id/messages` | `?around=<messageId>&before=50&after=50` or `?cursor=<seq>&dir=older\|newer&limit=100`, `&personId=` filter | `{ messages: MessageDTO[], hasOlder: boolean, hasNewer: boolean, anchorId: Id\|null }` |
| `GET /api/attachments/:id` | – | binary stream from R2 (404 `attachment_missing` if not uploaded) |
| `GET /api/people` | `?index=pinyin` | `PeopleIndexResponse { groups: { letter: string, people: (PersonRefDTO & {pinned: boolean})[] }[], total: number }` |
| `POST /api/people` | `{ label: string(1..60) }` | 201 `{ person: PersonDTO }` |
| `GET /api/people/:id` | – | `ProfileResponse` (below); 404; if merged → 200 `{ redirectTo: Id }` |
| `PATCH /api/people/:id` | `{ label?: string(1..60), pinned?: boolean }` | `{ person: PersonDTO }` |
| `DELETE /api/people/:id` | – | `{ deleted: true }`; 409 `conflict` for self |
| `POST /api/people/:id/merge` | `{ intoId: Id }` | `{ person: PersonDTO /*the target*/, moved: Record<TargetType, number> }` |
| `POST /api/people/:id/split` | `{ handleId: Id, into?: {personId: Id} \| {newPerson: {label}} }` (default newPerson labelled with handle value) | `{ person: PersonDTO /*new/target*/, movedEvidenceCandidates: { targetType, targetId }[] }` |
| `POST /api/people/:id/claims` | `{ statement: string(1..500), category: Category, validFrom?: PartialDate }` | 201 `{ claim: ClaimDTO }` (confirmed, manual) |
| `POST /api/people/:id/dates` | `{ kind: string, month: 1..12, day: 1..31, year?: number, calendar, isLeapMonth?: boolean, label?: string }` | 201 `{ date: ImportantDateDTO }` |
| `POST /api/people/:id/relations` | `{ toPersonId: Id, type: string, label?: string }` | 201 `{ relation: RelationDTO }` |
| `POST /api/people/:id/events` | `{ summary: string, happenedAt?: PartialDate, place?: string, participantIds: Id[] }` | 201 `{ event: EventDTO }` |
| `POST /api/review/:type/:id` | `ReviewRequest { action: 'accept'\|'reject'\|'edit'\|'supersede'\|'delete', patch?: { statement?, category?, validFrom?, value?, label?, type?, summary?, happenedAt?, place?, month?, day?, year?, calendar? }, replacement?: { statement: string } /* supersede "现在的情况" */ }` | `{ item: ClaimDTO\|HandleDTO\|RelationDTO\|EventDTO\|ImportantDateDTO, superseded?: ClaimDTO[], created?: ClaimDTO }` |
| `POST /api/review/bulk` | `{ items: {type: TargetType, id: Id}[] (max 500), action: 'accept'\|'reject' }` | `{ updated: number, failed: {type, id, code}[] }` |
| `GET /api/evidence/:type/:id` | `?context=2` | `EvidenceResponse { target: {type, id}, sourceKind, manualAddedAt: IsoString\|null, items: EvidenceItemDTO[] }` |
| `GET /api/home` | – | `HomeResponse { isEmpty: boolean, needsOnboarding: boolean, upcoming: { person: PersonRefDTO, dateId: Id, label: string, solar: 'YYYY-MM-DD', lunarLabel: string\|null, days: number }[], recentlyUpdated: { person: PersonRefDTO, latest: Pick<ClaimDTO,'id'\|'statement'\|'category'> }[], pinned: PersonRefDTO[], index: PeopleIndexResponse, recentImports: { id, chatTitle, dateFrom, dateTo, createdAt, status }[] /*last 5 with status ≠ 'mapping'*/ }` |
| `GET /api/search` | `?q=string(1..100)&limit=20&types=all\|people\|claims` | `{ q, people: { person: PersonRefDTO, matchedAlias: string\|null }[], claims: { person: PersonRefDTO, claimId: Id, statement: string, highlights: [start: number, end: number][] }[] }` |
| `GET /api/export` | – | `ExportDump` (tables listed in §11) with `content-disposition: attachment` |
| `DELETE /api/data` | `{ confirm: '删除全部数据' }` | `{ deleted: Record<string /*table*/, number>, r2Objects: number }` |

```ts
MappingSuggestions { chats: (ChatDTO & {matchReason: string, score: number})[], senders: { senderName, count, suggested: {self: true} | {personId: Id, label: string, reason: string /*"在『装修群』中也叫这个名字"*/} | null, candidates: {personId, label, reason}[] }[], preselectKind: ChatKind | null }

ReviewItem =
 | { type: 'claim', item: ClaimDTO, replaces: ClaimDTO | null }        // replaces != null → "变化" group
 | { type: 'handle', item: HandleDTO }
 | { type: 'relation', item: RelationDTO }
 | { type: 'date', item: ImportantDateDTO }
 | { type: 'event', item: EventDTO }
ImportReviewResponse { import: ImportDTO, chat: ChatDTO|null, progress: Progress, sections: { person: PersonRefDTO & { isNew: boolean /*created by this import*/ }, newCount: number, newClaims: ReviewItem[], changes: ReviewItem[], aliasesAndRelations: ReviewItem[], dates: ReviewItem[], events: ReviewItem[] }[], highConfidence: { type: 'claim', id: Id }[], highConfidenceCount: number, allHandled: boolean, empty: boolean }
// sections order: isNew desc, then newCount desc, then label pinyin
// highConfidence = proposed CLAIMS of this import with confidence >= settings.highConfidenceThreshold AND sensitive = false.
//   Handles/relations/dates/events have no confidence and are never included (use "本节全部确认"). DECISIONS A6.

ProfileResponse { person: PersonDTO, aliases: { kind: HandleKind, items: HandleDTO[] }[], infobox: { relationToMe: {value: string, relationId: Id}|null, city: {value, claimId}|null, work: {value, claimId}|null, school: {value, claimId}|null, birthday: ImportantDateDTO|null, otherDates: ImportantDateDTO[], chats: { chat: Pick<ChatDTO,'id'|'title'|'kind'>, messageCount, lastMessageAt }[], lastContactAt: MsgTime|null }, sections: { category: Category, claims: ClaimDTO[] /*confirmed + proposed*/ }[], relations: RelationDTO[], events: EventDTO[], history: ClaimDTO[] /*superseded + outdated + edited-before, desc*/ }

ExportDump { exportedAt: IsoString, version: 1, user: {id, email, name}, settings: SettingsDTO, chats, imports, importMessages, messages, attachments /*metadata only, no bytes*/, persons, handles, relations, claims, claimMentions, events, eventParticipants, importantDates, evidence, extractionJobs /*incl. rawOutput*/, reviewLog, llmCalls /*incl. rawOutput*/ }   // arrays of raw rows, camelCase, ownerId omitted
```
Infobox derivation (person module): relationToMe = confirmed relation between person and self; city = latest confirmed `location` claim (validTo null); work = latest confirmed `work`; school = latest confirmed `education`; birthday = importantDate kind `birthday`.

### 2.5 Extraction output — `contracts/extraction.ts` (SPEC §8.6, strict)
```ts
PersonRef = z.union([z.object({ personId: Id }).strict(), z.object({ tempId: z.string().min(1).max(40) }).strict()])
Evidence = z.array(z.number().int().nonnegative()).min(1)   // window-local seq numbers (§6)
ExtractionOutputSchema = z.object({
  newPersons: z.array(z.object({ tempId: z.string(), label: z.string().min(1).max(60), evidence: Evidence }).strict()).default([]),
  handles:    z.array(z.object({ person: PersonRef, kind: z.enum(['mentioned','real_name','address_term']), value: z.string().min(1).max(60), evidence: Evidence }).strict()).default([]),
  relations:  z.array(z.object({ from: PersonRef, to: PersonRef, type: z.string().min(1).max(30), label: z.string().max(30).optional(), evidence: Evidence }).strict()).default([]),
  claims:     z.array(z.object({ person: PersonRef, statement: z.string().min(2).max(200), category: Category, validFrom: z.string().max(20).optional(), confidence: z.number().min(0).max(1), sensitive: z.boolean(), supersedesClaimId: Id.optional(), evidence: Evidence }).strict()).default([]),
  events:     z.array(z.object({ summary: z.string().min(2).max(200), happenedAt: z.string().max(20).optional(), place: z.string().max(60).optional(), participants: z.array(PersonRef).min(1), evidence: Evidence }).strict()).default([]),
  dates:      z.array(z.object({ person: PersonRef, kind: z.string().min(1).max(20), day: z.number().int().min(1).max(31).optional(), month: z.number().int().min(1).max(12).optional(), year: z.number().int().optional(), calendar: z.enum(['solar','lunar']), isLeapMonth: z.boolean().optional(), evidence: Evidence }).strict()).default([]),
}).strict()
DedupOutputSchema = z.object({ duplicates: z.array(z.object({ newIndex: z.number().int(), existingClaimId: Id })).default([]) }).strict()
```
Relation `type` vocabulary (prompt-guided, not enforced): `parent|child|spouse|sibling|relative|friend|colleague|classmate|service_provider|client|other`; `label` holds the Chinese term ("外公"). **Direction: a relation reads `from` 是 `to` 的 `type`（例：from=外公, to=外孙, type=parent, label=外公）; `label` names `from` as seen from `to`, in the same reading** (core request eval-synthetic#2; seed, extract prompt, gold and person module all use this). Date `kind` vocabulary: `birthday|anniversary|memorial|other`. Invalid-JSON / validation-failed / item-level evidence-out-of-window are distinct outcomes (§6).

### 2.6 LLM call record — `contracts/llm.ts`
```ts
LlmCallRecord { id?: Id, ownerId: string|null, provider: 'deepseek', model: string, promptVersion: string, purpose: 'extract'|'dedup'|'judge'|'other', importId: Id|null, jobId: Id|null, evalRunId: string|null, inputTokens: number|null, outputTokens: number|null, cacheHitTokens: number|null, latencyMs: number, attempt: number, mode: 'live'|'record'|'replay', cassetteKey: string|null, rawOutput: string|null, finishReason: string|null, error: { code: LlmErrorCode, message: string }|null, createdAt: IsoString }
LlmErrorCode = 'timeout'|'http_4xx'|'http_5xx'|'rate_limited'|'empty_content'|'invalid_json'|'truncated'|'network'|'cassette_miss'|'budget_exceeded'|'deadline'
```

### 2.7 Hono RPC & TanStack Query
- `server/app.ts` exports `type AppType = typeof app` (the chained app).
- `lib/api-client.ts`:
```ts
import { hc } from 'hono/client'
import type { AppType } from '@/server/app'
export const api = hc<AppType>('/', { init: { credentials: 'same-origin' } }).api
export async function unwrap<T>(res: ClientResponse<T>): Promise<T>  // non-2xx → throws ApiClientError { status, code, message, details }
```
- `lib/query.ts`: `queryKeys` factory — `queryKeys.home()`, `.person(id)`, `.peopleIndex()`, `.importDetail(id)`, `.importReview(id)`, `.chat(id)`, `.chatMessages(id, params)`, `.evidence(type, id)`, `.search(q, types)`, `.settings()`, `.me()`. Modules may add private keys only prefixed with their module name (`['person', ...]`); shared ones must use the factory so invalidation works across modules.
- Usage:
```ts
const q = useQuery({ queryKey: queryKeys.person(id), queryFn: async () => unwrap(await api.people[':id'].$get({ param: { id: String(id) } })) })
```
- Mutations invalidate: review actions → `person(personId)`, `importReview(importId)`, `evidence(type,id)`, `home()`; merge/split/create/delete person → `peopleIndex()`, `home()`, `['person']`; settings → `me()`, `settings()`; delete import / delete all → `queryClient.invalidateQueries()`.
- Server Components may call server functions directly (`@/server/person.getProfile`) with `getDb()` for first paint; client components use `api`. Person page and home page render as Server Components with data fetched server-side (perf budget), then hydrate TanStack Query via `HydrationBoundary`.
- Input validation: every route uses core's `validator(target, schema)` (`server/middleware/validate.ts`, wraps `@hono/zod-validator`) with the contracts schema; failure → 400 envelope `validation_failed`.

### 2.8 Shared UI component contracts (TypeScript; exported by the owning module's public entry)

All are client components (`'use client'`). Core's bootstrap placeholders export exactly these names and prop types.

**Evidence** — `@/components/evidence` (owner: review)
```ts
import type { TargetType, SourceKind, IsoString, EvidenceResponse } from '@/contracts'
export interface EvidenceTarget { type: TargetType; id: number }

/** Owns open state for all marks inside it. Renders `children` (the row content: sentence, alias, relation line, date, event)
 *  and, directly BELOW the whole row, the EvidenceBlock of the currently open mark. At most one block open per row. */
export interface EvidenceRowProps {
  children: React.ReactNode
  as?: 'div' | 'li' | 'p'                      // default 'div'
  id?: string                                   // pass anchorId(type,id) for scroll targets
  className?: string
  open?: string | null                          // controlled: key of open mark (`${type}:${id}`); omit for uncontrolled
  onOpenChange?: (key: string | null) => void
}
export function EvidenceRow(props: EvidenceRowProps): JSX.Element

/** Superscript footnote number placed inline at the end of the sentence. A <button aria-expanded aria-controls> inside <sup>.
 *  Clicking toggles its block in the nearest EvidenceRow (throws in dev if there is none). One mark per item, regardless of
 *  how many evidence messages the item has (the block lists them all). */
export interface EvidenceMarkProps {
  target: EvidenceTarget
  index: number                                  // footnote number shown; computed by the caller (page-scoped, 1-based, render order)
  sourceKind: SourceKind                         // 'manual' marks still render; block shows "手动添加于 …"
  evidenceCount: number                          // 0 with sourceKind 'ai' → mark rendered disabled (muted, no block)
  prefetchOnHover?: boolean                      // default true: queryClient.prefetchQuery(queryKeys.evidence)
  className?: string
}
export function EvidenceMark(props: EvidenceMarkProps): JSX.Element

/** The expanded block. Normally rendered by EvidenceRow; exported for showcases/tests. Fetches with useEvidence.
 *  States: loading → Skeleton of 5 lines; error → inline BlockError with retry (row stays intact); success →
 *  one segment per EvidenceItemDTO, segments separated by a small line with the chat title ("『装修群』");
 *  each message "时间 · 发送者 · 正文" (formatMsgTime 'full', sender = senderLabel ?? senderName), evidence message on the
 *  Loam highlight background; kinds voice/transfer/red_packet/video_call/animated_sticker/image/video render as a gray chip
 *  ("语音 14 秒", "转账", "红包", "视频通话", "动画表情", "图片", "视频") — never hidden; footer per segment: link "在聊天中查看"
 *  → chatHref(chatId, messageId); manual items: no segments, footer text "手动添加于 YYYY年M月D日" (manualAddedAt ?? createdAt). */
export interface EvidenceBlockProps { target: EvidenceTarget; sourceKind: SourceKind; createdAt?: IsoString; context?: number /*default 2*/; id?: string }
export function EvidenceBlock(props: EvidenceBlockProps): JSX.Element

export function useEvidence(target: EvidenceTarget, opts?: { enabled?: boolean; context?: number }): UseQueryResult<EvidenceResponse, ApiClientError>
```
Usage (person page claim): `<EvidenceRow as="li" id={anchorId('claim', c.id)}>在汉中读高中。<EvidenceMark target={{type:'claim', id:c.id}} index={n} sourceKind={c.sourceKind} evidenceCount={c.evidenceCount} /></EvidenceRow>`.

**PersonPicker** — `@/components/person-picker` (owner: search)
```ts
import type { PersonRefDTO } from '@/contracts'
export type PersonPick =
  | { kind: 'self' }
  | { kind: 'existing'; person: PersonRefDTO }
  | { kind: 'new'; label: string }                // nothing created server-side; caller decides (mapping sends newPerson)
export interface PersonPickerCandidate { personId: number; label: string; reason: string | null }  // e.g. "在『装修群』中也叫这个名字"
export interface PersonPickerProps {
  value: PersonPick | null
  onPick: (pick: PersonPick) => void
  variant: 'select' | 'inline'                    // select: trigger button + popover (import mapping rows); inline: search box + list (dialogs: 其实是…, 合并到其他人物)
  candidates?: PersonPickerCandidate[]            // shown first, in order, with reason in small gray text
  allowSelf?: boolean                             // default false; shows "我" as the first option
  allowCreate?: false | { defaultLabel: string }  // default false; last option "新建人物『<query || defaultLabel>』"
  excludeIds?: number[]                           // e.g. the person being merged; self person and merged persons are always excluded from search results
  placeholder?: string                            // default "搜索人物"
  disabled?: boolean
  autoFocus?: boolean
  className?: string
}
export function PersonPicker(props: PersonPickerProps): JSX.Element
export function usePersonSearch(q: string, opts?: { enabled?: boolean; limit?: number }): UseQueryResult<{ person: PersonRefDTO; matchedAlias: string | null }[]>  // GET /api/search?types=people, debounced 150 ms
```
Label for a `select` trigger: self → "我"; existing → label; new → "新建：<label>"; null → placeholder. Keyboard: ↑/↓, Enter, Esc.

**Import overlay** — `@/components/import-overlay` (owner: import)
```ts
export function ImportOverlayHost(): JSX.Element          // no props; mounted once by core; includes the drag-and-drop layer ("松开以导入")
export interface ImportOverlayOpenOptions { chatId?: number /* preselect chat in step 2 */; file?: File /* skip file picker */ }
export function useImportOverlay(): { open: (opts?: ImportOverlayOpenOptions) => void; close: () => void; isOpen: boolean }

export interface AttachmentUploadState {
  phase: 'idle' | 'uploading' | 'done' | 'needs_file' | 'error'   // idle = nothing selected
  total: number; uploaded: number; failedNames: string[]
  bytesTotal: number; bytesUploaded: number
  retry: () => void                                   // re-run failed names (needs file in store)
  resumeWithFile: (file: File) => Promise<'ok' | 'sha_mismatch' | 'parse_error'>
}
export function useAttachmentUploads(importId: number): AttachmentUploadState   // store + GET /api/imports/:id `uploads`
export function AttachmentUploadStatus(props: { importId: number; className?: string }): JSX.Element | null  // renders null when phase 'idle' or ('done' and nothing was selected)
```

**Search overlay** — `@/components/search-overlay` (owner: search)
```ts
export function SearchOverlayHost(): JSX.Element          // no props; registers ⌘K / Ctrl K / '/' (when focus is not in an input/textarea/contenteditable)
export function useSearchOverlay(): { open: (q?: string) => void; close: () => void; isOpen: boolean }
export interface SearchTriggerProps { variant: 'hero' | 'topbar'; className?: string }  // 'hero' = home page's largest element; 'topbar' collapses to an icon button under 640px
export function SearchTrigger(props: SearchTriggerProps): JSX.Element
```

---

## 3. Conventions

- **Time**: all `createdAt/updatedAt/learnedAt/exportedAt/...` = ISO 8601 strings with `Z` (via `nowIso()`). Message time `sentAt` = `'YYYY-MM-DD HH:MM'` local wall time as in export (no tz). `validFrom/validTo/happenedAt` = `PartialDate` (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`) or null. "Today" for upcoming dates computed in `APP_TZ` (default `Asia/Shanghai`).
- **IDs**: `integer primary key autoincrement` on all business entity tables; the four **link tables** (`import_messages`, `claim_mentions`, `event_participants`, `evidence`) have a composite pk and no surrogate id; `user_settings` has pk `owner_id`; Better Auth tables use text ids. `ownerId` = Better Auth `user.id` (text). **Every business table, link tables included, has `owner_id`** (§4.1).
- **URLs & anchors**: build every in-app link with `@/lib/links`. Person page anchors: `/p/:id#<type>-<itemId>` (`#claim-345`, `#relation-7`, `#date-3`, `#event-9`, `#handle-21`); the element with that DOM id is the item's row. Chat page anchor: `/chats/:id?at=:messageId` (chat module scrolls + highlights). Search → person claim uses `personHref(personId, {type:'claim', id})`; person performs scroll + 2 s highlight (§1.7).
- **Owner scoping** (enforced helper, core, `server/db/owned.ts`):
```ts
type Db = DrizzleD1Database<typeof schema>
export function owned<T extends OwnedTable>(table: T, ownerId: string, ...conds: (SQL | undefined)[]): SQL   // and(eq(table.ownerId, ownerId), ...conds)
export async function getOwnedOr404<T extends OwnedTable>(db: Db, table: T, ownerId: string, id: number): Promise<T['$inferSelect']> // throws errors.notFound()
export function withOwner<T extends OwnedTable>(ownerId: string, row: Omit<T['$inferInsert'], 'ownerId'|'createdAt'|'updatedAt'>): T['$inferInsert'] // stamps ownerId + timestamps (entity tables)
export function withOwnerLink<T extends OwnedLinkTable>(ownerId: string, row: Omit<T['$inferInsert'], 'ownerId'|'createdAt'>): T['$inferInsert'] // link tables: stamps ownerId + createdAt
// OwnedTable = entity tables with id/owner_id/created_at/updated_at; OwnedLinkTable = import_messages | claim_mentions | event_participants | evidence. owned() accepts both.
```
Rule: every `select/update/delete` on a business table passes `owned(table, ownerId, ...)` as its `where`; every insert uses `withOwner`. A vitest lint test (core, `server/db/owned.lint.test.ts`) greps `server/**` (excluding `server/db/**`, `server/llm/**`) for `.from(` / `.update(` / `.delete(` statements lacking `owned(` or `ownerId` and fails listing offenders; a line may be whitelisted with `// owner-checked: <reason>`. Cross-account isolation is verified by backend critics with `seed@xiaoli.test` and `seed2@xiaoli.test`.
- Handlers get the user via `requireUser(c)` → `{ id, email }`; db via `c.var.db`; R2 via `getR2(c)`.
- **Error envelope**: `{ error: { code, message, details? } }`. Codes: `unauthorized`(401), `forbidden`(403), `not_found`(404), `validation_failed`(400), `duplicate_import`(409), `conflict`(409), `payload_too_large`(413), `attachment_missing`(404), `not_implemented`(501), `llm_unavailable`(503), `budget_exceeded`(503), `internal`(500). `server/errors.ts` exports `class ApiError(status, code, message, details?)` and `errors.notFound()`, etc. `app.onError` converts ApiError → envelope, anything else → 500 `internal` with message "服务器出错了" (no stack, no secrets; stack logged server-side without request bodies). `message` is user-facing Chinese.
- **Per-block error states (UI)**: every page composes independent blocks. Each block = `<BlockBoundary title="即将到来">` (core, `components/loam/BlockBoundary.tsx`): React error boundary + TanStack `QueryErrorResetBoundary`, rendering `<BlockError onRetry />` ("这一块没有加载出来 · 重试") in the block's own space. Blocks fetch their own query or select from a shared page query; if a shared query fails, the page shell (title/top bar) still renders and each dependent block shows BlockError. Server Components: page-level `error.tsx` is the last resort; per-block server data is fetched with per-block try/catch → the block renders a client fallback that refetches via its query, so one failed server fetch never throws the page. Loading = `<Skeleton>` in the block's shape. Inline components (EvidenceBlock, AttachmentUploadStatus, PersonPicker results) show their own inline error, never throw.
- **Text**: UI copy in Chinese exactly as SPEC where given. No emoji in UI chrome.
- **Logging**: server logs are JSON lines via `console.log(JSON.stringify({level, msg, ...}))`; never log message bodies, API keys, auth headers, or request bodies.
- **Env** (`server/env.ts`, zod-validated; Cloudflare env binding in-app, `process.env` in CLI): `DB` (D1), `R2`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (default `http://localhost:3000`), `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com`), `EXTRACT_MODEL` (optional, validated as `ExtractModel` — any other value fails env validation: in-app 500 `internal` logging the variable name, CLI exits 1 with the message; unset → `deepseek-flash`; used only when the user's `extractModel` is null), `LLM_MODE` (`live|record|replay`, default `live` in app, `replay` in tests), `LLM_CASSETTE_DIR`, `LLM_THINKING` (`disabled` default), `LLM_BUDGET_TOKENS` (default 3000000), `LLM_BUDGET_SINCE` (ISO; deployed budget window start), `APP_TZ`, `NEXTJS_ENV`. Local: `.dev.vars` (gitignored) for wrangler/getPlatformProxy + `.env.local` for Next; `next.config.ts` does not inline secrets.

---

## 4. Data

### 4.1 Tables (`server/db/schema/*.ts`, sqlite-core; snake_case SQL names, camelCase TS)
All business **entity** tables: `id integer pk autoincrement`, `owner_id text not null references user(id) on delete cascade`, `created_at text not null`, `updated_at text not null`, index `(owner_id)`.
**Link tables** (`import_messages`, `claim_mentions`, `event_participants`, `evidence`): **no surrogate id**, composite pk as listed, `owner_id text not null references user(id) on delete cascade`, `created_at text not null`, no `updated_at`, index `(owner_id)` (plus the listed indexes). They carry owner_id so every query uses `owned()`, the owner lint test needs no whitelist for them, and delete-all/export work by `owner_id` alone. Inserts use `withOwnerLink`. Exceptions: `user_settings` (pk `owner_id`, no id), `llm_calls` (id, nullable owner_id, no FK, below).

`auth.ts` (Better Auth, generated with `npx auth@1.7.5 generate --config server/auth.config.ts --adapter drizzle --dialect sqlite --output server/db/schema/auth.ts`, then committed): `user`, `session`, `account`, `verification`.

`import.ts`
- `chats`: title text, kind text, note text null. idx (owner_id, title)
- `imports`: chat_id int null fk chats (set null), file_name, file_sha256, exported_at null, parser_version text, status, message_count int, new_message_count int, date_from null, date_to null, stats text(json), error null. **unique (owner_id, file_sha256)** (a stale `mapping` row is deleted before re-creating, §1.4). idx (owner_id, created_at). The parsed body is NOT stored in D1 (R2 staging, §1.4).
- `messages`: chat_id fk chats cascade, first_import_id int null fk imports (set null), sender_handle_id int null fk handles (set null), sender_name text (raw display name, kept when handle/person deleted), sent_at text, seq int, kind, body, meta text(json) null, fingerprint. **unique (chat_id, seq)**; idx (owner_id, chat_id, sent_at), idx (first_import_id). `seq` assigned in steps of 1024 so inserts between existing messages rarely renumber; renumber (two-phase: negative temp then final, in one `db.batch`) only when a gap is exhausted. Prompts use window-local indices (§6).
- `attachments`: message_id fk messages cascade, kind, file_name null, **selected int bool not null default 0**, r2_key null, byte_size null, mime null. idx (message_id)
- `import_messages` (link): owner_id, import_id fk imports cascade, message_id fk messages cascade, created_at; pk (import_id, message_id); idx (message_id) — which imports contained which messages (delete semantics, chat page import records).

`identity.ts`
- `persons`: label, is_self int bool, merged_into_id null fk persons, pinned bool, avatar_r2_key null, last_message_at null, label_sort text (pinyin sort key), import_id int null (import that created it; "新" badge). idx (owner_id, label_sort)
- `handles`: person_id null fk persons (set null), kind, value, value_norm (NFKC lower trim), chat_id null fk chats (cascade), status, import_id null fk imports (set null), source_kind. Unique expression index `(owner_id, kind, value, ifnull(chat_id, 0))` via raw SQL in migration (SQLite NULLs are distinct). idx (owner_id, value_norm)
- `relations`: from_person_id fk persons cascade, to_person_id fk persons cascade, type, label null, status, import_id null, source_kind

`memory.ts`
- `claims`: person_id fk persons cascade, statement, statement_norm, category, valid_from null, valid_to null, learned_at, confidence real null, sensitive bool, status, status_reason null ('superseded'|'outdated'|'edited'), status_changed_at, supersedes_claim_id null, superseded_by_claim_id null, import_id null fk imports (set null), job_id null, source_kind. idx (owner_id, person_id, status), idx (owner_id, import_id), idx (owner_id, status, statement_norm)
- `claim_mentions` (link): owner_id, claim_id fk cascade, person_id fk cascade, created_at; pk (claim_id, person_id)
- Edit history = old claim row with status `superseded`, status_reason `edited`, new row with `supersedes_claim_id` (no revisions table).
- `events`: summary, happened_at null, place null, status, import_id null, source_kind
- `event_participants` (link): owner_id, event_id fk cascade, person_id fk cascade, created_at; pk (event_id, person_id)
- `important_dates`: person_id fk cascade, kind, day null, month null, year null, calendar, is_leap_month bool default false, label null, status, import_id null, source_kind
- `evidence` (link): owner_id, target_type, target_id int, message_id fk messages cascade, created_at; **pk (target_type, target_id, message_id)**, no surrogate id; idx (owner_id, message_id)

`jobs.ts`
- `extraction_jobs`: import_id fk imports cascade, window_start_seq, window_end_seq, focus_start_seq, focus_end_seq, status, attempts int, locked_at null, model null, prompt_version null, raw_output null, error null, items_created int default 0. idx (import_id, status)
- `review_log`: target_type, target_id, action, before text(json) null, after text(json) null
- `llm_calls`: owner_id null, provider, model, prompt_version, purpose, import_id null, job_id null, eval_run_id null, input_tokens null, output_tokens null, cache_hit_tokens null, latency_ms, attempt, mode, cassette_key null, raw_output text null, finish_reason null, error_code null, error_message null, created_at. idx (owner_id, created_at), idx (import_id), idx (created_at). (No FK on owner_id: CLI calls have null owner; delete-all removes by owner_id.)
- `user_settings`: owner_id pk, self_display_names text(json), extract_model text null (null → env EXTRACT_MODEL → 'deepseek-flash'), high_confidence_threshold real default 0.8, onboarded_at null, updated_at

### 4.2 DB client & migrations
- `server/db/client.ts`: `getDb(): Db` = `drizzle(getCloudflareContext().env.DB, { schema })`, wrapped in React `cache()` for RSC; Hono uses `c.var.db` set in the session middleware per request. No module-level db singletons. `createDb(d1: D1Database): Db` exported for CLI/tests.
- D1 has no interactive transactions: multi-statement writes use `db.batch([...])`. Long operations chunk into batches of ≤ 100 statements and ≤ 100 bound params per statement; `import.status` is the idempotency guard (mapping checks status `mapping` before inserting, sets `extracting` last).
- Migrations: edit schema → `pnpm db:generate` (`drizzle-kit generate`, out `drizzle/`) → `pnpm db:migrate:local` (`wrangler d1 migrations apply xiaoli --local`) → remote in deploy (`--remote`). `wrangler.jsonc` d1 binding `DB`, `database_name: "xiaoli"`, `migrations_dir: "drizzle"`. Only core/integrator generates migrations; modules request schema changes via core-requests.
- `pnpm db:reset` = delete local D1 state for `xiaoli` + migrate (integrator only).
- Local state: `.wrangler/state/v3/d1/` and `.wrangler/state/v3/r2/` (default persistence, shared by `next dev` via `initOpenNextCloudflareForDev()`, `wrangler d1 ... --local`, `getPlatformProxy()`, and `pnpm preview:prod -- --share-dev-state`, whose `wrangler dev` persists there; without the flag the preview uses its build worktree's own state).

### 4.3 CLI access to local D1/R2
`scripts/with-platform.ts` (core):
```ts
export async function withPlatform<T>(fn: (p: { env: CloudflareEnv; db: Db; r2: R2Bucket }) => Promise<T>): Promise<T>
// getPlatformProxy<CloudflareEnv>({ configPath: 'wrangler.jsonc', persist: true }), loads .env.local into process.env for secrets, always dispose() in finally.
```
Used by `pnpm seed`, `pnpm llm:usage`. Concurrent writes with the running dev server are allowed but WAL-locked; seed batches and retries `SQLITE_BUSY` up to 5× with backoff.
Tests: backend integration tests never touch the dev server's D1 state. Core provides `tests/helpers/test-db.ts` → `createTestDb(): Promise<{ db: Db; r2: R2Bucket; dispose(): Promise<void> }>` (`getPlatformProxy({ persist: false })`, applies `drizzle/*.sql` in order), `createTestUser(db, email)`, `createTestApp({ db, r2, llm, userId })` to call Hono routes with `app.request()`, and `fakeLlm(script)` (scripted `LlmClient` for tests without cassettes).

**Eval runs in-memory, not on D1** (§6/§7): the offline extraction path uses `memoryStore`, so `pnpm eval` needs no D1, no server, no browser.

---

## 5. LLM adapter (`server/llm`, owned by llm)

```ts
export interface LlmMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface LlmJsonRequest {
  purpose: 'extract' | 'dedup' | 'judge' | 'other'
  promptVersion: string                // e.g. 'extract.v1'
  model: string                        // required; callers resolve it (extract: resolveExtractModel)
  messages: LlmMessage[]               // must contain the word "json" + an example (adapter asserts, throws in dev/test)
  maxTokens: number                    // required; extract 8192, dedup 1024, judge 1024
  temperature?: number                 // default 0
  timeoutMs?: number                   // per attempt, default 25_000
  deadlineAt?: number                  // epoch ms; adapter caps each attempt at deadlineAt - now and returns code 'deadline' (retryable:false) if < 1000 ms remain
  maxTransportRetries?: number         // default 2
  context?: { ownerId?: string | null; importId?: number | null; jobId?: number | null; evalRunId?: string | null }
}
export interface LlmJsonResult { ok: true; json: unknown; raw: string; usage: { inputTokens: number; outputTokens: number; cacheHitTokens: number | null }; latencyMs: number; model: string; finishReason: string; fromCassette: boolean }
export interface LlmError { ok: false; code: LlmErrorCode; message: string; raw: string | null; retryable: boolean; latencyMs: number }
export interface LlmClient { completeJson(req: LlmJsonRequest): Promise<LlmJsonResult | LlmError> }   // never throws for provider errors

export type LlmMode = 'live' | 'record' | 'replay'
export function createLlmClient(opts: { env: LlmEnv; logger: LlmCallLogger; mode: LlmMode; cassetteDir?: string; budget: TokenBudget | null /* required non-null for live|record */ }): LlmClient
export interface LlmCallLogger { log(rec: LlmCallRecord): Promise<void> }
export function d1CallLogger(db: Db): LlmCallLogger                 // in-app → llm_calls table
export function jsonlCallLogger(path: string): LlmCallLogger        // CLI → eval/runs/<runId>/llm-calls.jsonl (gitignored)
export async function getAppLlm(c: HonoContext): Promise<LlmClient> // mode LLM_MODE (default live), d1CallLogger(c.var.db), budget = await appBudget(c); callers: `await getAppLlm(c)`
export function cassetteKey(req: LlmJsonRequest, thinking: string): string

export interface TokenBudget { limit: number; used(): Promise<{ inputTokens: number; outputTokens: number }>; add(u: { inputTokens: number; outputTokens: number }): Promise<void> }
export function fileBudget(path?: string /* default '.dev/llm-budget.json' */): Promise<TokenBudget>   // Node only; loaded via dynamic import
export function d1Budget(db: Db, opts: { since: IsoString; limit: number }): TokenBudget              // sum(input+output) over llm_calls where mode != 'replay' and created_at >= since
export function appBudget(c: HonoContext): Promise<TokenBudget>   // NEXTJS_ENV=development → fileBudget (shared with CLI); otherwise d1Budget(since = LLM_BUDGET_SINCE ?? first day of current UTC month)
```
**Budget semantics** (PLAN: extraction + eval calls ≤ 3M tokens per loop, in total):
- One shared counter for the whole machine in dev: `.dev/llm-budget.json` = `{ loopId, startedAt, limit, inputTokens, outputTokens }`, updated after every live/record call (in-app `next dev` handlers and CLI scripts alike; write via temp file + rename, `.dev/llm-budget.lock` O_EXCL lock with 2 s stale timeout). Replay calls never count. Judge calls count.
- Before a live/record call: if `input+output >= limit` → `LlmError{code:'budget_exceeded', retryable:false}`; in-app that maps to job `failed` with code `budget_exceeded` and `jobs/next` returns normally (import-result shows the failed window; retry works after reset); eval aborts with `aborted: 'budget_exceeded'`.
- `fileBudget` imports `node:fs` only through `await import()` inside a module never reached in the Worker build (`NEXTJS_ENV !== 'development'`), so the deployed bundle has no fs.
- **Loop reset & reporting (llm owns the script, orchestrator runs it)**: `pnpm llm:usage --reset --loop <loopId>` at the start of every loop (zeros counters, sets `loopId`, `startedAt`); `pnpm llm:usage --json` prints `{ loopId, startedAt, limit, inputTokens, outputTokens, exceeded }`; the orchestrator copies `inputTokens/outputTokens` into STATUS.json `llmUsage` and, when `exceeded`, adds a blocker. Deployed usage: `pnpm llm:usage --remote` sums `llm_calls` via wrangler (deploy critic only).

**DeepSeek impl** (`server/llm/deepseek.ts`): `POST {DEEPSEEK_BASE_URL}/chat/completions` with `{ model, messages, response_format: { type: 'json_object' }, max_tokens, temperature: 0, thinking: { type: LLM_THINKING ?? 'disabled' }, stream: false }`. Parses `choices[0].message.content`; `usage.prompt_tokens`, `completion_tokens`, `prompt_cache_hit_tokens`. llm builder verifies with ≤ 5 small live calls and records in DECISIONS.

**Retries — ownership split**:
- Adapter (transport): retries `network`, `http_5xx`, `rate_limited` (429, honor `retry-after`), `empty_content` up to `maxTransportRetries` extra attempts with backoff 1s/3s, never past `deadlineAt`. Each attempt logged as its own `llm_calls` row (`attempt` 1..3). `finish_reason === 'length'` → `truncated` (not retried by adapter). Invalid JSON → `invalid_json` (not retried by adapter).
- Extract (semantic): a window attempt = one adapter call + JSON parse + zod validation. On `invalid_json`, `truncated`, validation failure, `timeout`, `deadline`, or adapter-exhausted error → job `attempts++`; if `attempts < 3` status back to `pending` (retried on the next `jobs/next` call), else `failed`. Other windows continue.
- In-app deadline (per `jobs/next` request, §6): extract call `timeoutMs: 20_000, maxTransportRetries: 0, deadlineAt`. Offline/eval uses **the same per-attempt deadline policy** by default (`deadlinePolicy: 'app'`, §6), so eval measures what the app does.

**Logging**: every attempt produces one `LlmCallRecord` (including replay, `mode: 'replay'`). In-app: `d1CallLogger`. CLI: `jsonlCallLogger`. The API key is never in records; `rawOutput` stores the content string only. Request prompts are NOT stored in `llm_calls` (they contain message bodies) — reproducible from job window + prompt version.

**Cassettes**:
- Key: `sha256(JSON.stringify({ model, promptVersion, purpose, messages, maxTokens, temperature, thinking }))` first 32 hex.
- File: `<cassetteDir>/<promptVersion>/<key>.json` = `{ key, recordedAt, model, promptVersion, purpose, request: { messages, maxTokens, temperature, thinking }, response: { content, finishReason, usage, latencyMs } | null, error: { code, message } | null }`. Hand-written failure cassettes use the same format with `response.content` set to broken JSON (`invalid_json`), `finishReason: 'length'` (`truncated`), or `error: {code:'timeout'}`.
- Dirs: `fixtures/cassettes/synthetic/` (committed), `fixtures/cassettes/real/` (gitignored), module test dirs (e.g. `server/extract/__fixtures__/cassettes/`). The caller chooses: eval passes explicitly by source; in-app uses `LLM_CASSETTE_DIR`.
- Modes: `replay` → hit returns stored response; miss → `LlmError{code:'cassette_miss', retryable:false}` (never calls network). `record` → live call, writes cassette (overwrites). `live` → live call, no write. Vitest defaults `LLM_MODE=replay`. `pnpm eval` defaults `replay`; `pnpm eval --live` = `record`; `--live --no-record` = `live`. In-app dev default `live`.

---

## 6. Extraction pipeline (`server/extract`, owned by extract)

```ts
// windowing — pure
export function planWindows(msgs: { seq: number; sentAt: MsgTime }[], focus: [number, number][] /* new seq ranges */, opts?: { gapHours?: 3; maxSize?: 150; overlap?: 20; context?: 20 }): WindowPlan[]
export interface WindowPlan { startSeq: number; endSeq: number; focusStartSeq: number; focusEndSeq: number }
export function packWindows(plans: WindowPlan[], msgs: { seq: number }[], maxMessages: number): WindowPlan[]   // exported from @/server/extract
export function promptFeatures(version: string): { packMaxMessages: number | null; gapMarkers: boolean; milestoneRules: boolean }   // server/extract/prompt-version.ts; v1–v3 → {null,false}, v4+ → {40,true}; milestoneRules true from extract.v7; extract.v8 (registered, not PROMPT_VERSION) = v7's features

// prompt — pure
export const PROMPT_VERSION: string  // server/extract/prompt-version.ts, matches prompts/extract.v<N>.md front-matter
export function renderExtractPrompt(input: WindowInput, version?: string /* default PROMPT_VERSION; eval --prompt/--compare */): LlmMessage[]
export interface WindowInput {
  chat: { title: string; kind: ChatKind }
  selfPersonId: number
  messages: { localSeq: number; sentAt: MsgTime; senderName: string; senderPersonId: number | null; kind: MessageKind; body: string; context?: boolean /* existing message outside the new range; prompt marks it, items resting only on context are dropped */ }[]  // localSeq = 1..n within window
  known: { personId: number; label: string; handles: { kind: HandleKind; value: string }[]; claims: { id: number; statement: string; category: Category }[] }[]
}
// validation — pure
export function validateOutput(json: unknown, input: WindowInput, opts?: { milestoneRules?: boolean }): { output: ExtractionOutput; dropped: { path: string; reason: 'evidence_out_of_window' | 'unknown_person' | 'unknown_supersedes' | 'empty_evidence' | 'invalid_item' | 'context_only' | 'self_loop' | 'low_confidence' | 'momentary' | 'ambiguous_handle' | 'redundant' }[]; rawItemCount: number } | { error: 'validation_failed'; issues: string[] }

// model choice
export function resolveExtractModel(settings: SettingsDTO | null, env: { EXTRACT_MODEL?: ExtractModel }): ExtractModel   // settings?.extractModel ?? env.EXTRACT_MODEL ?? 'deepseek-flash' (env already validated by parseServerEnv)

// core step, storage-agnostic
export interface ExtractStore { /* d1Store (in-app) and memoryStore (eval) */
  loadWindow(ref: WindowRef): Promise<WindowInput & { seqMap: Map<number, number> /* localSeq → messageId */ }>
  proposeItems(importId: number, items: ResolvedItems, ctx: { jobId: number | null; windowIndex: number }): Promise<{ created: number; mergedEvidence: number }>
  findSimilarClaims(personId: number, importId: number): Promise<{ id: number; statement: string; status: Status }[]>
  resolveTempPerson(importId: number, label: string, evidenceMessageIds: number[]): Promise<number | null>
  createPerson(importId: number, label: string): Promise<number>
}
export async function extractWindow(deps: { llm: LlmClient; store: ExtractStore; model: ExtractModel; promptVersion?: string; deadlineAt?: number }, window: WindowRef): Promise<WindowOutcome>
export type WindowOutcome =
  | { status: 'done'; itemsCreated: number; droppedInvalidEvidence: number; rawItemCount: number; dedup: 'ran' | 'skipped_deadline' | 'failed' | 'not_needed'; latencyMs: number; usage; raw?: string | null; attemptMs?: number; sensitiveRewritten?: number; dropped?: DroppedItem[] }
  | { status: 'retryable_error' | 'fatal_error'; code: 'invalid_json'|'validation_failed'|'truncated'|'timeout'|'deadline'|'llm_error'|'cassette_miss'|'budget_exceeded'; message: string; latencyMs: number; raw?: string | null; usage?: WindowUsage; attemptMs?: number }
export interface DroppedItem { path: string; reason: DropReason /* validateOutput reasons above */; fields?: string[] /* invalid_item from the strict item schema only: field paths + zod issue codes, never values */ }

// in-app entries (called by import's route handlers)
export async function processNextJob(db: Db, llm: LlmClient, ownerId: string, importId: number, opts: { deadlineAt: number; env: Pick<ServerEnv, 'EXTRACT_MODEL'> }): Promise<JobsNextResponse>
export async function retryFailedJobs(db: Db, ownerId: string, importId: number, jobIds?: number[]): Promise<{ reset: number; progress: Progress }>   // failed → pending, attempts = 0
export async function createJobsForImport(db: Db, ownerId: string, importId: number, focus: [number, number][]): Promise<number>   // called by import after mapping
```
`processNextJob`: loads `getUserSettings(db, ownerId)` and uses `resolveExtractModel(settings, opts.env)` (allowed values = `ExtractModel`: `deepseek-flash`, `deepseek-v4-pro`); records `extraction_jobs.model`. Claims one pending job atomically: `UPDATE extraction_jobs SET status='running', locked_at=now WHERE id=(SELECT id ... status='pending' OR (status='running' AND locked_at < now-60s) ORDER BY id LIMIT 1) RETURNING *`. When no pending/running remain: import.status = `reviewing` (or `done` when zero proposed items remain).

**Per-request deadline** (SPEC/PLAN window ≤ 30 s; handler passes `deadlineAt = start + 28 s`):
1. Extract call: `timeoutMs = min(20_000, deadlineAt - now - 6_000)`, `maxTransportRetries: 0`.
2. Validation + sensitive guard + tempId resolution (in-memory, ms).
3. Dedup call only if `deadlineAt - now >= 4_000`: `timeoutMs = min(5_000, deadlineAt - now - 2_000)`; otherwise skipped (`dedup: 'skipped_deadline'`, treated as "no duplicates", logged) — duplicates can then be merged by the user; eval reports the skip count.
4. Persistence `db.batch` with the remaining ≥ 2 s.
If the extract call returns `deadline`/`timeout`, the job attempt counts as failed (retry on next call).

**Window packing & gap markers** (DECISIONS ## extract X20): from `extract.v4` on (`promptFeatures(version).packMaxMessages = 40`), `createJobsForImport` and `extractOffline` pass `planWindows` output through `packWindows`: consecutive plans merge into one window when the second starts at the message right after the first ends and the merged span holds ≤ 40 messages. Sessions (> 3 h gap), the 150/20 split of long sessions and the ±20 context are unchanged; overlapping or non-adjacent plans are never merged. From `extract.v4` on the prompt shows a `—— 间隔约N小时/天，以下是新的一段对话 ——` line between messages more than 3 h apart. `extract.v1–v3` keep one window per plan and the old rendering, so their cassettes replay unchanged.

**`validateOutput` rules beyond the schema** (DECISIONS ## extract X21): `unknown_supersedes` also covers a `supersedesClaimId` belonging to another person's confirmed claim; `invalid_item` also covers an `other` relation with no label or a person's name as label, and a solar date next to a lunar date of the same person and kind resting on the same messages; parent/child relations with an extended-kin label (爷/奶/外公/外婆/姥/孙/叔/伯/姑/舅/姨/婶/侄/表/堂/亲家/公公/婆婆/岳) are typed `relative`; a claim contained in a more specific claim about the same person in the same window merges into it.
Round-3 rules (DECISIONS ## extract X26; drop reasons additive, used only inside server/extract): in group chats `address_term` handles whose value is a parent/child vocative (爸/爸爸/老爸/爹/妈/妈妈/老妈/娘/儿子/女儿/闺女/儿) are dropped (`ambiguous_handle`; private chats keep them); claims below confidence 0.85 are dropped (`low_confidence`); statements with a momentary time word (这两天/今天/明天/刚才/这周…) or a leading 将/将要/即将/准备/打算 are dropped (`momentary`); the generic student status ("在上学，是学生") is dropped (`redundant`) next to a grade or class of the same person (window, confirmed claims, or — in `extractWindow` — this import's proposed claims), or when none of its evidence messages mentions schooling; an `other` relation is invalid when its label **contains** either person's name, and a claim of `from` with that label as statement on the same messages is dropped with it; a claim starting with 儿子/女儿/孩子 moves to the child when the window has exactly one parent/child relation from that person.

extract.v7 rules (DECISIONS ## extract X30; applied only when `opts.milestoneRules`, which `extractWindow` sets from `promptFeatures(version).milestoneRules`; earlier versions validate exactly as before, so their cassette replays are unchanged): in a private chat, a new person whose every `address_term` handle is said by self in messages containing the term resolves to the other sender; in a group chat, a new person known only by a `real_name` equal to its label (plus 提供过… claims), with no relations, dates or events, is dropped with its items; an `other` relation whose label is a partner word (伴侣/女朋友/男朋友/女友/男友/对象/恋人/未婚夫/未婚妻/老婆/老公/妻子/丈夫/爱人) is typed `spouse`; an item whose evidence messages are all voice/image/video/sticker/video call/recall/transfer is dropped (`invalid_item`); an event with a plan word (计划/打算/准备/将要/即将/明天/后天/下周/下星期/下个月/明年) or a `happenedAt` after the window's last message is dropped (`momentary`), and a malformed `happenedAt` is removed.

Safe item defaults (DECISIONS ## extract X31; all prompt versions): before each item's strict parse `validateOutput` sets `claims.sensitive` missing → `false` (strings "true"/"false" → boolean; the sensitive guard still flags and rewrites matching statements); `dates.calendar` missing → `lunar` when an evidence message states a lunar date (农历/阴历/正月/腊月/"三月初八"-type; a grade like 初一 alone does not count), else `solar`; `newPersons.evidence` missing or empty → the in-window evidence of the items referencing that tempId. `confidence`, `category`, relation `type`, date `kind`, person refs, `participants` and item `evidence` get no default. A schema `invalid_item` drop carries `DroppedItem.fields` (field paths and zod issue codes such as `sensitive:invalid_type`, `<key>:unrecognized_keys`; never values), and `processNextJob` logs them once per window (`level: 'warn'`, `msg: 'extract items dropped (invalid_item)'`, `{path, fields}` only). `prompts/extract.v8.md` (= v7 + known-sender rule + partner words typed `spouse`) is registered but is not `PROMPT_VERSION`; `promptFeatures('extract.v8')` equals v7's.

```ts
// offline entry (eval harness, no D1/server/browser)
export async function extractOffline(args: {
  parsed: ParsedExport
  mapping: GoldMapping              // from gold: chat {title, kind} + senderName → person key + self key
  llm: LlmClient
  model?: ExtractModel              // default resolveExtractModel(null, parseServerEnv(process.env)) — CLI caller passes it
  promptVersion?: string
  deadlinePolicy?: 'app' | 'none'   // default 'app': each window ATTEMPT gets deadlineAt = attemptStart + 28_000 and the §6 steps 1–4 (extract timeoutMs ≤ 20 s, 0 transport retries, dedup only if ≥ 4 s remain). 'none' = diagnostics only; report marks p95 check invalid
  onWindow?: (i: number, total: number, outcome: WindowOutcome) => void
}): Promise<OfflineExtractionResult>
export interface OfflineExtractionResult {
  persons: { key: string /* gold person key (senders) or 'new:<label>' */; label: string; isSelf: boolean }[]
  handles:   { person: string; kind; value; evidence: number[] /* parsed-export idx */; windowIndex: number }[]
  relations: { from: string; to: string; type; label?; evidence: number[]; windowIndex: number }[]
  claims:    { person: string; statement; category; validFrom?; confidence; sensitive; supersedes?: number /*index in claims*/; evidence: number[]; windowIndex: number }[]
  events:    { summary; happenedAt?; place?; participants: string[]; evidence: number[]; windowIndex: number }[]
  dates:     { person: string; kind; day?; month?; year?; calendar; isLeapMonth?; evidence: number[]; windowIndex: number }[]
  windows: { index: number; startIdx: number; endIdx: number; outcome: WindowOutcome['status']; code?: string; attempts: number; attemptMs: number[] /* per attempt, see p95WindowMs §7.4 */; latencyMs: number; rawItemCount: number; droppedInvalidEvidence: number; dedup?: string; rawOutputs: string[] }[]
  deadlinePolicy: 'app' | 'none'
  usage: { inputTokens: number; outputTokens: number; calls: number }
  promptVersion: string; model: string
}
```
Offline uses `memoryStore(parsed, mapping)` with message ids = `idx + 1`, seq = idx, one window plan over the whole export (focus = all). **Prompt inputs never contain gold knowledge**: `WindowInput.chat` = `mapping.chat` (the annotator writes a title a user would type at mapping time, §7.6); `known` contains exactly the sender persons, each with `label = senderName` (self: the self sender's senderName; if self has several senderNames, the first by message count) and `handles = [{kind: display_private|display_group, value: senderName}]`, no claims. Gold `persons[].label/aliases`, non-sender persons, claims and negatives are never passed to `extractOffline`. Same `extractWindow`, prompt, validation, dedup, sensitive guard, and (with the default `deadlinePolicy: 'app'`) the same per-attempt deadline → eval measures the real pipeline; same retry policy (3 attempts per window). Attempt time in `live`/`record` = wall clock of extract call + validation + tempId resolution + dedup call + memoryStore persistence; in `replay` = local compute wall time + Σ recorded `latencyMs` of the calls replayed in that attempt (a recorded timeout/deadline outcome replays as such). `scripts/extract-offline.ts` (extract): `pnpm extract:offline <zip> --gold <path> [--live]` prints result JSON.

Prompt files: `prompts/extract.v1.md` (front-matter `version`, sections `system`, `user_template`, `example_json`), `prompts/dedup.v1.md`. Changing a prompt = new file `extract.v2.md`, bump `PROMPT_VERSION`, re-run eval, write comparison (§7.5).

Semantic dedup (SPEC §8.6): per person with ≥1 new claim and ≥1 existing proposed/confirmed claim in this import or confirmed overall, one `purpose: 'dedup'` call with `{ candidates: [{id, statement}], new: [{index, statement}] }` → `DedupOutputSchema`; duplicates merge evidence into the existing claim. Dedup failure is non-fatal. (Multiple persons in one window: one combined dedup call keyed by person, still one call per window.)

Sensitive guard (deterministic, extract): after validation, statements matching phone (`1[3-9]\d{9}`, landline), ID card (`\d{17}[\dXx]`), bank card (`\d{16,19}`), or detailed-address heuristics (`省|市|区|县|路|街|号|栋|单元|室` with digits) are rewritten to category-appropriate generic text ("提供过收货地址"; a mobile number → "提供过手机号", other phone numbers → "提供过联系方式") and flagged `sensitive: true`; handles with such values are dropped; new-person labels are neutralised (sensitive digits and address parts cut out) or the person is dropped together with its items; count logged. (DECISIONS ## extract X21.)

---

## 7. Eval (`eval/`, owned by eval-synthetic; gold owned by annotator)

### 7.1 Files
- `eval/gold/synthetic/<zip basename>.json` — committed; `eval/gold/LOCK.json` committed.
- `eval/gold/real/<zip basename>.json` — gitignored. There is no separate real LOCK: real entries live in the committed `eval/gold/LOCK.json`, keyed by `real-<first 16 hex of the ZIP's sha256>` and holding only hashes (no names), so git history covers real gold too (§7.6).
- `fixtures/synthetic/<zip basename>.intent.json` — generator's planted traps (eval-synthetic), committed; hidden from the annotator until freeze.
- `eval/reports/synthetic/<timestamp>.json` (per-item detail, synthetic text only) and `eval/reports/<timestamp>.json` (combined, **aggregate numbers only, no statements/names**) — committed; `eval/reports/real/<timestamp>.json` (per-item detail) — gitignored. `eval/reports/compare-<vA>-vs-<vB>-<timestamp>.json` — aggregate only.
- `eval/judge-cache/synthetic/*.json` committed; `eval/judge-cache/real/` gitignored.
- `eval/runs/<runId>/` gitignored scratch (llm-calls.jsonl, raw outputs).
- `.dev/annotate/<source>/<zip>.txt` — annotation views (gitignored via `.dev/`).
(Gitignore additions: docs/core-requests/architecture.md #1, #3.)

### 7.2 Gold format (`eval/src/gold-schema.ts`, zod)
```ts
GoldFile {
  goldVersion: 1, zip: string /*basename*/, annotator: string /*agent role id, never a real name*/, annotatedAt: IsoString, notes?: string,
  parserVersion: string,            // PARSER_VERSION used for the annotation view
  messageCount: number,             // parsed.messages.length at annotation time
  messagesSha256: string,           // messagesDigest(parsed.messages) — sender/time/body per idx, kind excluded
  anchors: { idx: number; fingerprint: string }[],   // every 50th message + last; used only to locate drift when messageCount/messagesSha256 differ (a fingerprint-only parser change, e.g. wechat-export@2, is not drift)
  mapping: { chat: { title: string; kind: ChatKind }, senders: { senderName: string; person: string /*person key*/ }[], self: string /*person key*/ },
  persons: { key: string /*"p1".. (real), slug (synthetic)*/, label: string, aliases?: string[], inChat: boolean }[],
  handles:   { id: string, person: string, kind: 'mentioned'|'real_name'|'address_term', value: string, evidence: number[] /*idx*/, optional?: boolean }[],
  relations: { id: string, from: string, to: string, type: string, acceptTypes?: string[], label?: string, evidence: number[], optional?: boolean }[],   // reads: `from` 是 `to` 的 `type`（例：from=外公, to=外孙, type=parent）, same as §2.5
  claims:    { id: string, person: string, statement: string, category: Category, acceptCategories?: Category[], sensitive: boolean, evidence: number[], optional?: boolean, supersedes?: string }[],
  dates:     { id: string, person: string, kind: string, month?: number, day?: number, year?: number, calendar: 'solar'|'lunar', isLeapMonth?: boolean, evidence: number[], optional?: boolean }[],
  events:    { id: string, summary: string, participants: string[], evidence: number[], optional?: boolean }[],   // reported, not gated
  negatives: { id: string, kind: 'transactional'|'coordination'|'inference_trap'|'sensitive'|'invisible_content', evidence: number[], description: string, forbidden?: string }[],
  sensitiveValues: string[]  // literal strings that must never appear in output text (synthetic: fake values; real: copies — file gitignored)
}
```
Message references are **parsed-export `idx`**, independent of DB ids. **Drift guard**: before scoring a zip, eval parses it and compares `messageCount` and `messagesSha256`; on mismatch the zip is not scored (`zips[].status = 'gold_mismatch'`, first differing anchor reported) and every gate for that source fails. Persons are identified by gold keys; pipeline persons map to gold keys via `mapping.senders` (senders) and, for `new:<label>` persons, by normalized label/alias match (NFKC, strip spaces, case-fold) against `persons[].label/aliases`; a `new:` person whose label matches the label/alias of a sender person (`mapping.senders[].person` or `mapping.self`) is a duplicate of that sender: its items never match gold and count as FPs labelled `wrong_person` (deterministic), reported as `duplicateSenderPersons`; unmatched new persons count as false-positive persons, their items attributed to `unknown` (always FP). `optional: true` items: a match counts as TP, a miss does not reduce recall.

### 7.3 Matching
- **handles**: same person key AND normalized `value` equal (kind mismatch reported only). Deterministic.
- **relations**: persons equal (or swapped with inverse type `parent↔child`; symmetric types `spouse|sibling|friend|colleague|classmate|relative` match either direction) AND (`type` equal or in `acceptTypes`). Deterministic.
- **dates**: same person, same `kind`, same calendar, month/day equal where gold has them. Deterministic.
- **claims** and **events**: judge step A (below), one-to-one greedy by gold order.
- Evidence overlap is NOT required for TP (reported as `evidenceOverlap` rate).

**Judge client** (`eval/src/judge.ts`): `interface JudgeClient { matchClaims(i: MatchInput): Promise<MatchOutput>; classifyFps(i: FpClassifyInput): Promise<FpClassifyOutput> }` — `llmJudge(llm, cache)` for runs, `fakeJudge(table)` for unit tests. Both calls: `purpose: 'judge'`, `deepseek-flash`, temperature 0, json_object, maxTokens 1024.

**Step A — match** (`eval/prompts/judge-match.v1.md`), one call per (zip, person with ≥1 gold or predicted claim), and one per zip for events:
```ts
MatchInput  = z.object({ person: z.object({ key: z.string(), label: z.string() }), gold: z.array(z.object({ id: z.string(), statement: z.string(), category: Category })), pred: z.array(z.object({ index: z.number().int(), statement: z.string(), category: Category })) })
MatchOutput = z.object({ matches: z.array(z.object({ pred: z.number().int(), gold: z.string().nullable(), verdict: z.enum(['same','less_specific','different']) })) }).strict()
// same = same fact (wording may differ); less_specific = true but vaguer than gold (e.g. "在陕西读书" vs "在汉中读高中");
// different = other fact, or adds a detail gold does not state. Each gold id matched at most once (greedy: same before less_specific).
```
**Step B — classify every false positive** (`eval/prompts/judge-fp.v1.md`), for FPs of all types (claims, handles, relations, dates, events). Deterministic pre-labels first, no judge call: `invalid_evidence` (any evidence idx ∉ [0, messageCount) or outside its `windowIndex` range), `sensitive_leak` (text contains a `sensitiveValues` string or matches the §6 regexes), `wrong_person` for handles/relations/dates (same value/type/date exists in gold under a different person key — deterministic). Remaining FPs in batches of ≤ 10 per zip:
```ts
FpClassifyInput = z.object({
  zip: z.string(),
  persons: z.array(z.object({ key: z.string(), label: z.string(), aliases: z.array(z.string()) })),
  goldClaims: z.array(z.object({ id: z.string(), person: z.string(), statement: z.string() })),      // ALL persons of the zip
  negatives: z.array(z.object({ id: z.string(), kind: NegativeKind, description: z.string(), forbidden: z.string().nullable() })),
  items: z.array(z.object({
    fpId: z.string(), type: z.enum(['claim','handle','relation','date','event']), person: z.string() /*key or 'unknown'*/,
    text: z.string(),                                                 // claim statement | "kind:value" | "from —type/label→ to" | "kind month-day calendar" | event summary
    evidenceWindow: z.array(z.object({ idx: z.number().int(), sentAt: MsgTime, senderName: z.string(), body: z.string(), isEvidence: z.boolean() })).max(30),  // evidence msgs ±2, merged, capped
  })).min(1).max(10),
})
FpClassifyOutput = z.object({ labels: z.array(z.object({
  fpId: z.string(),
  label: z.enum(['factual_error','wrong_person','over_inference','should_ignore','other']),
  subLabel: z.enum(['transactional','coordination','invisible_content','not_about_person']).nullable(),  // required iff label = should_ignore
  goldId: z.string().nullable(),       // wrong_person: the other person's gold claim
  negativeId: z.string().nullable(),   // matched negative, if any
  reason: z.string().max(120),
})) }).strict()
```
Label rules in the prompt: `wrong_person` = the fact is true of a different person (matches a goldClaim of another person, or evidence shows it is about someone else); `over_inference` = not stated in evidenceWindow (incl. inference_trap negatives); `factual_error` = evidence talks about this topic but the item misstates it; `should_ignore` = stated but must not be recorded (negatives transactional/coordination/invisible_content, or not about a person); `other` otherwise.
**Cache**: `eval/judge-cache/<source>/<sha256(judgePromptVersion + JSON(input))>.json` = `{ input hash, output, model, createdAt }`. Replay reads cache; miss in replay mode → step A falls back to char-bigram Jaccard ≥ 0.5 (`same`), step B to label `other`; report `judgeFallback: true` and gates are marked not valid (`passed: false`). **Cost**: step A ≈ 1–3k input tokens × persons (≈ 30 per full synthetic+real eval); step B ≈ 3–6k input tokens per batch; expected < 150k tokens per full live eval, counted in the loop budget.

### 7.4 Metrics (per zip, per source {synthetic, real}, micro-averaged)
- Per type (`claims`, `relations`, `handles`, `dates`, `events`):
  - `precisionLenient` = (same + less_specific) / predicted; `precisionStrict` = same / predicted (deterministic types: strict = lenient).
  - `recallStrict` = gold non-optional matched `same` / gold non-optional; `recallLenient` = (same + less_specific) / gold non-optional.
  - **Gated**: precision uses `precisionLenient` (a vaguer but true statement is not a wrong record); recall uses `recallStrict` (a vaguer statement doesn't recover the gold fact). DECISIONS A5 #23.
- `yieldPer100` = 100 × predicted / messageCount, per type and total.
- `transactionalAsClaimRatio` = (predicted claims classified `should_ignore` with `subLabel ∈ {transactional, coordination}`) / predicted claims. Because step B classifies **every** claim FP against all negatives and the evidence text, unlisted transactional claims are counted too. Gate ≤ 0.05.
- `sensitiveInStatement` = count of predicted claim statements / handle values / event summaries containing any `sensitiveValues` string OR matching the §6 regexes (computed independently of the pipeline's guard). Gate = 0.
- `invalidEvidence`:
  - `invalidEvidencePost` = predicted items (the pipeline's final output) with any evidence idx ∉ [0, messageCount) or outside its window `[startIdx, endIdx]` — computed by the harness from the parsed export and `windows[]`, not trusting the pipeline's filter. **Gate = 0.**
  - `invalidEvidencePreRate` = Σ `droppedInvalidEvidence` / Σ `rawItemCount` (raw model output before the drop filter). Reported; warning when > 0.05. Not gated (DECISIONS A5 #22).
- Error taxonomy counts per type (`errors: Record<ErrorCode, number>`, ErrorCode = `factual_error|wrong_person|over_inference|should_ignore|sensitive_leak|invalid_evidence|other`); FN listed separately. Unit test `eval/tests/metrics.test.ts` builds predictions + `fakeJudge` covering every ErrorCode, every subLabel, lenient/strict, optional gold, unmatched new persons, and gold mismatch.
- Window stats: failed windows after retries + codes, dedup skipped count, and **`p95WindowMs`** = 95th percentile (nearest-rank) over **all window attempts** (successful and failed, each attempt one sample from `windows[].attemptMs`) of the per-attempt time defined in §6 (extract call + validation + dedup + persistence), measured with `deadlinePolicy: 'app'`. With `deadlinePolicy: 'none'` the value is reported but `p95Valid: false`.
- Gates (extract critic): claims `precisionLenient` ≥ 0.85, `recallStrict` ≥ 0.70; handles P ≥ 0.90; relations P ≥ 0.90; `sensitiveInStatement` = 0; `invalidEvidencePost` = 0; `transactionalAsClaimRatio` ≤ 0.05; plus preconditions: gold frozen & unchanged with history recorded (§7.6: `frozen`, `changeRecorded !== false`, `lockAppendOnly !== false`), no `gold_mismatch`, `judgeFallback = false`. Evaluated on **real** and **synthetic** separately; pass requires both. Additional non-PLAN check reported in `gates` (name `p95WindowMs`, ≤ 30,000, source per report): must pass on the latest `record`/`live` report with `deadlinePolicy: 'app'` (P4, §10); in replay reports it is informational.

### 7.5 CLI & report
`pnpm eval [--source synthetic|real|all] [--zip <basename>] [--live [--no-record]] [--prompt extract.v2] [--model deepseek-flash] [--compare extract.v1] [--run-id <id>]`
- Loads ZIP via `parseExportZip` (Node reads file into Uint8Array), gold via schema + drift guard + freeze check, runs `extractOffline` per zip with `createLlmClient({ mode, cassetteDir: fixtures/cassettes/<source>, logger: jsonlCallLogger(eval/runs/<runId>/llm-calls.jsonl), budget: mode === 'replay' ? null : await fileBudget() })`, then matching, classification, metrics, reports.
- Missing gold for a zip → skipped with warning.
- Report (`EvalReport`):
```ts
{ runId, createdAt, promptVersion, model, mode, deadlinePolicy: 'app'|'none', parserVersion, judgePromptVersions: { match: string, fp: string }, judgeFallback: boolean, aborted: string|null,
  usage: { inputTokens, outputTokens, calls, judgeInputTokens, judgeOutputTokens },
  gold: { source: 'synthetic'|'real', zip: string, lockKey: string /*basename | real-<16hex>*/, goldSha256: string /*sha256 of gold file bytes*/, lockedSha256: string|null /*last LOCK version*/, lockVersions: number, frozen: boolean /*goldSha256 === lockedSha256*/, changeRecorded: boolean|null /*null if lockVersions ≤ 1; else true iff EVERY version after the first has its gold-change line (§7.6)*/, lockAppendOnly: boolean|null /*null if no committed baseline*/ }[],
  p95WindowMs: { synthetic: number|null, real: number|null }, p95Valid: boolean,
  sources: { synthetic: SourceMetrics, real: SourceMetrics|null },
  gates: { name, value, threshold, op: '>='|'<='|'==', source, passed }[], passed: boolean,
  zips: { zip, source, status: 'scored'|'gold_mismatch'|'no_gold', messageCount, windows: { total, failed, p95Ms, dedupSkipped }, metrics: TypeMetrics, errors: Record<'claims'|'relations'|'handles'|'dates'|'events', Record<ErrorCode, number>>, details?: { tp: [], fp: [], fn: [] } /* only in per-source files */ }[] }
TypeMetrics = Record<'claims'|'relations'|'handles'|'dates'|'events', { predicted, tpStrict, tpLenient, fp, fn, precisionStrict, precisionLenient, recallStrict, recallLenient, yieldPer100 }> & { transactionalAsClaimRatio, sensitiveInStatement, invalidEvidencePost, invalidEvidencePreRate, evidenceOverlap }
SourceMetrics = TypeMetrics & { zips: number, messages: number }
```
Combined report `eval/reports/<timestamp>.json` contains no per-item text; real zip names replaced by `real-1..n` (sorted by basename); `gold[].zip` likewise anonymized. `--compare vA` writes `eval/reports/compare-<vA>-vs-<vB>-<timestamp>.json` with side-by-side `sources.*` metrics and deltas (both runs must share identical `gold[].goldSha256`, else refused), prints a table. Orchestrator copies `latestReport` + `passed` into STATUS.json.
- Top-up eval (extract-owned, DECISIONS ## extract X27): `node --import tsx server/extract/scripts/eval-fill.ts` replays the current prompt version's extract cassettes, refuses live extract calls, and records only dedup/judge misses (`--max-live-tokens` caps usage); for pipeline changes that keep extract requests unchanged. A plain `pnpm eval` replay afterwards must show 0 cassette misses. `--allow-extract-misses` also records extract calls, only on cassette misses of the current prompt version (a rule that changes new persons changes later windows' known-person lists, hence their requests). Registered-but-not-current versions (extract.v7, extract.v8) are evaluated with `--prompt`.

### 7.6 Annotation protocol (annotator role; tools owned by eval-synthetic)
**When**: after the parser critic passes (end of wave 1b) and eval-synthetic has committed the synthetic eval ZIPs; runs at the start of wave 2 in parallel with builders. Extract's first gated eval waits for `eval/gold/LOCK.json` to contain every synthetic eval ZIP and every real ZIP. `fixtures/synthetic/perf-5000.zip` is perf-only and not annotated.
**Independence**: the annotator is a separate agent that labels both **synthetic and real** ZIPs item by item per SPEC §8.7 (PLAN §2). It may read ONLY: SPEC.md (§6–§8.7), this §7.2/§7.6, the `## architecture` section of `docs/DECISIONS.md` (A1–A7) and the `## annotator` section, the ZIP files, `eval/src/GOLD_FORMAT.md`, `eval/src/gold-schema.ts`, `fixtures/synthetic/README.md` (format docs kept blind by `eval/tests/synthetic.test.ts`; core request eval-synthetic#3), and the output of the annotation tools below. It must NOT read: any other section of `docs/DECISIONS.md` — in particular `## extract`, `## llm`, `## eval-synthetic`, `## integrator` (they record prompt comparisons and observed model behaviour; read DECISIONS only through a heading filter, `awk '/^## /{keep=($0=="## architecture"||$0=="## annotator")} keep' docs/DECISIONS.md`, never the whole file), `fixtures/cassettes/**`, `server/extract/__fixtures__/**`, `eval/runs/**`, `eval/reports/**`, `eval/judge-cache/**`, `artifacts/**`, `prompts/**`, `fixtures/synthetic/*.intent.json` (until after freeze), the `llm_calls`/`extraction_jobs`/claims tables of any D1 state, `.dev/llm-budget.json`, and any agent transcript or STATUS openIssues about extraction output. It makes no LLM calls through the app pipeline.
**Tools** (eval-synthetic, `eval/src/annotate/**`, scripts in package.json via core request):
- `pnpm eval:annotate-view <zip path> [--source synthetic|real]` → writes `.dev/annotate/<source>/<basename>.txt` (never stdout for real): header `messageCount`, `messagesSha256`, `parserVersion`, sender list with counts; then one line per message `idx<TAB>sentAt<TAB>senderName<TAB>kind<TAB>body` (multi-line bodies with `\n` escaped). Numbers only are printed to stdout.
- `pnpm eval:gold-template <zip path> --source …` → writes `eval/gold/<source>/<basename>.json` skeleton (parserVersion, messageCount, messagesSha256, anchors, `mapping.senders` with empty person keys, empty arrays). Refuses to overwrite an existing file.
- `pnpm eval:validate-gold [--source …] [--zip …]` → zod schema; every idx in [0, messageCount); messageCount/messagesSha256 match the current parser (anchor fingerprints are compared only when one of them differs, to name the first differing anchor; otherwise a stale anchor fingerprint is at most a warning); every sender mapped; every person key referenced exists; `mapping.self` is a sender; `mapping.chat.title` is not a gold `persons[].label` unless it equals a senderName (no gold knowledge in prompt input); negatives of kind `sensitive` imply non-empty `sensitiveValues`; duplicate ids. Synthetic only: prints disagreements with `intent.json` as warnings — run only after freeze, to be resolved by the annotator via the change rule below. Exit 1 on errors.
- `pnpm eval:freeze-gold --source … [--zip …]` → requires validate-gold clean; **appends** to the single committed `eval/gold/LOCK.json`:
```ts
GoldLock = { lockVersion: 2, entries: Record<string /* lockKey: synthetic '<basename>' | real 'real-<first 16 hex of ZIP sha256>' */, {
  source: 'synthetic' | 'real',
  versions: { goldSha256: string, messagesSha256: string, frozenAt: IsoString }[]   // append-only, oldest first; current = last
}> }
```
  Rules enforced by freeze-gold: (a) never removes or edits an existing entry or version (it re-reads LOCK, and refuses to write if the result is not a strict append); (b) if `goldSha256` equals the last version → no-op; (c) appending a version after the first **requires** that the `## annotator` section of DECISIONS.md already contains `gold-change: <lockKey> <first 12 hex of the new goldSha256>` with a reason, else exit 1. Real entries hold hashes only (a sha256 of a gitignored file reveals no content), so LOCK is committed for both sources.
**Change rule (freeze)**: after freeze, gold may change only when the gold itself is wrong (PLAN §2), never to raise scores, and only by the annotator: first append the `gold-change:` line (above) with the reason under `## annotator`, then run `eval:freeze-gold`. `pnpm eval` per zip: `lockedSha256` = last version; `frozen` = gold file sha equals it (else gates fail); `changeRecorded` = for **every** version with index ≥ 1 a matching `gold-change: <lockKey> <sha12>` line exists under `## annotator` (null when there is one version; false → gates fail); `lockAppendOnly` = the LOCK at `git show HEAD:eval/gold/LOCK.json` is a prefix of the working LOCK (every committed entry present, its versions a prefix of the working versions) — false → gates fail; null (no committed LOCK yet / no git) → reported, not failing. So rewriting gold + LOCK without a DECISIONS line fails `changeRecorded`, and collapsing the history fails `lockAppendOnly` once LOCK was committed. Required unit tests (`eval/tests/freeze.test.ts`, eval-synthetic): gold and LOCK both rewritten with an appended version but no DECISIONS line → `changeRecorded: false`, gates fail; history collapsed to one version vs a baseline with two → `lockAppendOnly: false`; freeze-gold refuses to drop a version; freeze-gold refuses a second version without the DECISIONS line; happy path with the line → pass. Parser changes that alter `messagesSha256` require the annotator to re-annotate affected idx (drift guard, §7.2) and then follow the same change rule.

---

## 8. Verify tool (`verify/`, owned by verify-seed)

- CLI: `pnpm verify <scenario>[,<scenario>...] [--widths 1440,390] [--base http://localhost:3000] [--account seed|seed2|empty|fresh] [--headed]`, `pnpm verify:list`. Scenario id = `<dir>/<name>` (e.g. `person/showcase`, `e2e/full-flow`, `_smoke/perf-budgets`). `pnpm verify <dir>` runs all scenarios in that dir.
- Server: checks `GET <base>/api/health`; if down and base is `:3000`, runs `pnpm dev:ensure` (starts only if not running) and waits ≤ 120 s. Never kills a server.
- Browser: `@playwright/test` library API, `chromium.launch({ channel: 'chrome' })`, one context per width, viewport 1440 → `{1440, 900}`, 390 → `{390, 844}` with `deviceScaleFactor: 2`, `hasTouch: true`; `locale: 'zh-CN'`, `timezoneId: 'Asia/Shanghai'`.
- Login: API `POST /api/auth/sign-in/email` in the context (storageState cached at `.dev/verify/auth-<account>.json`, refreshed on 401). Accounts (synthetic, committed in `scripts/seed/accounts.ts`): `seed@xiaoli.test` / `xiaoli-seed-2026` (full dataset), `seed2@xiaoli.test` / `xiaoli-seed-2026` (small, isolation), `empty@xiaoli.test` / `xiaoli-seed-2026` (no data, not onboarded). `--account fresh` signs up `verify+<ts>@xiaoli.test`.
- Scenario discovery: `verify/scenarios/**/*.scenario.ts`. Scenario file API:
```ts
import { defineScenario } from '@/verify/lib'
export default defineScenario({
  id: 'person/showcase',
  account: 'seed',                        // default 'seed'
  widths: [1440, 390],                    // default both
  description: '人物页代表性状态',
  destructive: false,                     // true → scenario deletes seed data; verify runs `pnpm seed --account <account>` before it if a required tag is missing and always after it finishes (pass or fail)
  expectedFailures: [{ urlPattern: '/api/people/', status: 500, step: 'error-state' }],  // excluded from failure counts
  async run({ page, step, shot, api, seed, measure, width }) {
    const p = await seed.person('long-profile')          // tag → {id,label} from .dev/seed-manifest.json
    await step('open person', () => page.goto(`/p/${p.id}`))
    await shot('long-profile')                           // artifacts/.../<width>/<nn>-long-profile.png, fullPage
    await step('error-state', async () => { await page.route('**/api/people/*', r => r.fulfill({ status: 500, body: '{"error":{"code":"internal","message":"x"}}' })); await page.reload() })
  },
})
```
`seed.person(tag)`, `seed.import(tag)`, `seed.chat(tag)`, `seed.claim(tag)`. Component showcases that are not a real page render at `/dev/<module>/<name>` (module-owned `app/(app)/dev/<module>/**`, 404 outside development).
- Artifacts: `artifacts/<scenario id with / → __>/<YYYYMMDD-HHmmss>/` containing `1440/NN-<name>.png`, `390/NN-<name>.png`, `log.json`, `trace-<width>.zip` (only on failure).
- `log.json` schema:
```ts
{ scenario, startedAt, finishedAt, baseUrl, account, commit: string|null, passed: boolean,
  widths: { width, steps: { name, startedAt, durationMs, ok, error?: string }[], screenshots: string[] }[],
  consoleErrors: { width, step, type: 'error'|'pageerror', text, location?: string }[],   // warnings collected separately as consoleWarnings
  failedRequests: { width, step, url, method, failure: string }[],        // requestfailed, excl. aborted navigations & expectedFailures
  apiNon2xx: { width, step, url, method, status, code?: string, expected: boolean }[],   // /api/* responses ≥ 300 (excl. 304)
  pageLoads: { width, step, url, ttfbMs, domContentLoadedMs, loadMs, lcpMs?: number }[],
  apiTimings: { width, step, url, method, status, durationMs, serverTimingMs?: number }[],
  budgets: { name, target, samplesMs: number[], statisticMs: number, passed }[] }
```
`passed` = all steps ok && consoleErrors = 0 && unexpected failedRequests = 0 && unexpected apiNon2xx = 0 && budgets passed. Exit code 1 if not passed. Query values of `q=` are stripped from logged URLs.
- **300 ms budgets** — scenario `_smoke/perf-budgets` (verify-seed), width 1440 only, account `seed`:
  - Pages: `/` and `/p/<long-profile id>`. For each: **4 sequential navigations**; navigation 1 is warm-up and discarded; **statistic = median of navigations 2–4**; metric = document TTFB (`responseStart - requestStart`). Same statistic for `GET /api/home` and `GET /api/people/:id` via `Server-Timing: app;dur=<ms>` (core middleware on every `/api` response), called 4× through `api`.
  - Pass: each statistic ≤ 300 ms. This is the gate the person and home critics apply, measured against the running `next dev` on :3000.
  - Production-like confirmation (integrator, wave 4 and on dispute): `pnpm preview:prod` = `scripts/deploy/preview-prod.ts`: builds in a clean git worktree (`../xiaoli-deploy-build`), refuses secrets in the build output, applies local migrations and serves the worker with `wrangler dev` on :8787. The default state is the worktree's own empty D1/R2. `--share-dev-state` uses the repo's `.wrangler/state`, so seed accounts work for `pnpm verify _smoke/perf-budgets --base http://localhost:8787` (run `pnpm preview:prod -- --share-dev-state`, then that verify command); stopped afterwards. It is the one allowed second server, integrator only, never while other agents screenshot on a memory-tight machine (check `free -m` ≥ 3 GB). If dev fails a budget only due to dev overhead and preview passes, the module records both logs in DECISIONS and the critic may accept.
- Real-data artifacts: the e2e real flow writes to `artifacts/` (gitignored) — screenshots may contain real names and are never committed or quoted in reports.

---

## 9. Seed data (`scripts/seed/`, owned by verify-seed)

`pnpm seed [--account seed|seed2|empty|all] [--reset]` via `withPlatform` against local D1/R2 (the same DB the dev server uses).
- Accounts created through Better Auth API (`auth.api.signUpEmail` with a `getAuth(env)` instance) if missing.
- **Isolation**: seed only touches rows whose `owner_id` ∈ seed account ids. Idempotent: `--reset` (default when data exists) deletes all business rows for those owners (reverse FK order, batched, same table list as §11 delete-all) and re-inserts; never touches other users. Deterministic PRNG (mulberry32, seed 20260915); ids differ across runs, so scenarios use tags from `.dev/seed-manifest.json`.
- Dataset for `seed@xiaoli.test`:
  - 200 persons (synthetic Chinese names from a fixed list + ~10 Latin/emoji/digit labels for the `#` group), 1 self person, 12 pinned, 3 merged-into (hidden), tags `long-profile` (60 claims all categories, 8 relations, 6 events, 5 dates incl. lunar birthday, 15 aliases across kinds), `sparse-profile` (1 claim), `proposed-heavy` (10 proposed claims), `with-history` (4 superseded + 2 outdated + 1 edited chain), `lunar-birthday-soon` (lunar birthday within 30 days of real today), `leap-month` (lunar date in a leap month), `long-label` (30-char label); claim tags `claim-searchable` (unique phrase for search→anchor scenario).
  - 5,000 claims total, all 7 categories, ≈ 80% confirmed / 12% proposed / 5% superseded / 3% rejected; 30% with validFrom; 5% sensitive; 2% manual.
  - 8 chats (5 private, 3 group, tags `group-big`, `private-long`), ~6,000 messages with all MessageKinds, attachments (some `selected=1, r2_key` null for "图片未导入"; 10 tiny generated PNGs uploaded to R2).
  - 12 imports: `done` ×8, `reviewing` ×2 (`review-mixed` with new person, changes, aliases, dates, events, high- and low-confidence claims; `review-empty` producing no items), `extracting` ×1 (`in-progress`, pending jobs; scenarios stub `jobs/next`), `failed-windows` ×1 (2 failed jobs), plus `uploads-pending` = one of the done imports with 3 selected, not uploaded attachments; plus `delete-me` = a 13th import (`reviewing`, its own private chat of 40 messages it alone contains, 1 person created by it with 3 proposed + 2 confirmed claims evidenced only by its messages, and 1 claim of `long-profile` that has evidence from both `delete-me` and another import) used only by the destructive `import-result/delete-import` scenario; plus `unfinished` = a `mapping` import with no chat (no R2 staging object; used by the import-result unfinished state).
  - evidence rows for every AI item (1–3 messages), handles for all senders, relations incl. self relations, events with participants, important dates solar and lunar, reviewLog entries, a few `llm_calls` rows.
  - settings: selfDisplayNames `['我是小丽']`, onboarded.
- `seed2@xiaoli.test`: 10 persons, 1 chat, 1 import — labels deliberately overlap seed's (isolation: search must not leak).
- `empty@xiaoli.test`: account only, not onboarded.
- Seed does not import ZIPs (fast, no LLM). Synthetic ZIPs (`fixtures/synthetic/*.zip`) are separate.

---

## 10. Performance budgets & fault isolation (testable)

| # | Check | How | Owner (implements) | Checked by |
|---|---|---|---|---|
| P1 | Browser parse of 5,000-message ZIP ≤ 3 s | `fixtures/synthetic/perf-5000.zip`; verify scenario `import/parse-perf` measures file-set → preview rendered via `performance.mark` (`xiaoli:parse:start/end`), 1440 only, 3 runs, median | parser + import | import critic |
| P1b | Parser unit bench (Node) ≤ 1.5 s for same zip | vitest bench in `lib/wechat-export` | parser | parser critic |
| P2 | `/p/:id` server response ≤ 300 ms (200 persons / 5,000 claims) | `_smoke/perf-budgets` statistic (§8) for `long-profile` page TTFB and `GET /api/people/:id` Server-Timing | person | person critic |
| P3 | `/` server response ≤ 300 ms | `_smoke/perf-budgets` home TTFB + `GET /api/home` Server-Timing | home | home critic |
| P4 | Single window end-to-end ≤ 30 s | (a) gate: `jobs/next` deadline 28 s (§6); extract integration test with a slow `fakeLlm` asserts the `jobs/next` response < 30 s and dedup skipped; (b) confirmation on real model latency: latest `record`/`live` eval report with `deadlinePolicy: 'app'` has `p95WindowMs` ≤ 30,000 per source (per-attempt time, §7.4) — offline runs use the same per-attempt deadline as the app, so the number is comparable | extract (+llm deadline) | extract critic |
| F1 | Window failure → ≤ 2 retries → failed; others continue; result page shows failed count + retry | vitest with hand-written cassettes in `server/extract/__fixtures__/cassettes/` (`invalid_json`, `truncated`, validation failure) and `fakeLlm` timeout → job statuses & progress; verify `import-result/failed-windows` | extract, import-result | extract & import-result critics |
| F2 | Any page's data load failure only affects its block | each UI showcase has an `error` step routing one API to 500, asserting the rest renders (`expectedFailures`) | every UI module (+ review for EvidenceBlock) | UI critics |
| F3 | Owner isolation | vitest integration per backend module: two users, cross-access every id route → 404 | each backend module (core for settings) | backend critics |
| F4 | Duplicate import rejected; abandoned import does not block | `POST /api/imports` same sha of a non-`mapping` import → 409; `check` → duplicate. Same sha whose only import is `mapping` → `check` `{duplicate:false}`, POST 201 with a new id, old id 404, old staged R2 object gone. Overlay closed at step 2 → `DELETE` sent, import gone (verify `import/abandon-step2`) | import | import critic |
| F6 | Parsed payload lifecycle | vitest: after POST, R2 `u/<owner>/imp/<id>/parsed.json` exists and no `messages`/`attachments` rows; after mapping, rows exist (attachments with correct `selected`), status `extracting`, staged object deleted; mapping with the object missing → 409 | import | import critic |
| F7 | Delete import from the UI | verify `import-result/delete-import` (account `seed`, import tag `delete-me`, `destructive: true` → re-seeded after): foot button → dialog → delete → URL `/`, `GET /api/imports/:id` 404, the person created by it is gone, the shared `long-profile` claim still exists with one fewer evidence item; e2e full flow does the same on a real import | import-result (UI), import (route) | import-result critic, overall critic |
| F5 | Attachment upload survives navigation; reload shows needs_file | verify `import/upload-resume`: import synthetic ZIP with images, navigate away and back (count rises), reload (status line "还没有上传"), re-select file → completes | import | import critic |

---

## 11. Delete semantics (SPEC §7)

**Delete import** — owner: **import** (`server/import/delete.ts`, `deleteImport`), route `DELETE /api/imports/:id`:
1. M₀ = messages with `first_import_id = importId`. Split: **R** = messages in M₀ that appear in `import_messages` for another import of the same owner → reassign `first_import_id` to the earliest such import (lowest id); they are NOT deleted and their evidence is untouched. **M** = M₀ \ R (messages only this import contained). (DECISIONS A5 #24.)
2. For each derived item (handle, relation, claim, event, date) with any evidence row referencing M: if all its evidence messages ⊆ M → delete item (and its evidence, claim_mentions, event_participants); else delete only the evidence rows referencing M.
3. Also delete items with `import_id = importId`, `source_kind='ai'` and zero evidence remaining.
4. Claims superseded by a deleted claim: restore status `confirmed`, clear `superseded_by_claim_id`, `status_reason`.
5. Before deleting the import row: manual display handles and non-self persons with `import_id = importId` that another import still uses get `import_id` = the earliest such import (lowest id), so a later delete of that import removes them (DECISIONS import I4). Delete attachments of M (R2 objects via `r2.delete` after the DB batch), M, this import's `import_messages` rows, extraction_jobs, `llm_calls` rows with this `import_id`, then the import, then the staged payload `u/<ownerId>/imp/<importId>/` (normally already gone; a `mapping` import has only this and the row). Display handles created by this import's mapping (`source_kind='manual'`, `import_id = importId`) that no remaining message uses (`sender_handle_id`) and that have no evidence outside M → deleted (DECISIONS import I4). Persons created by this import with no remaining handles/claims/dates/relations/events and no messages → deleted. Chat with no remaining messages and no imports → deleted.
6. `persons.last_message_at` recomputed for affected persons.
Executed as ordered `db.batch` chunks; idempotent if interrupted.

**Delete person** — owner: **person** (`server/person/delete.ts`, `deletePerson`), route `DELETE /api/people/:id`: set `messages.sender_handle_id` null for its handles (sender shows raw `sender_name`), delete handles, claims, important_dates, relations (both directions), event_participants rows (events left with 0 participants deleted), claim_mentions, evidence rows of all deleted items, avatar R2 object; reviewLog rows kept. Persons with `merged_into_id = id` → deleted too. Self person cannot be deleted (409 `conflict`).

**Delete item** (claim "删除" on person page) — owner: **review** (`action: 'delete'`): hard delete item + evidence + claim_mentions; reviewLog row with `before`.

**Merge** (review): moves handles, claims, dates, relations (dropping self-loops and exact duplicates, merging evidence), event_participants, claim_mentions from `from` to `into`; `from.merged_into_id = into`; `GET /api/people/:from` returns `redirectTo`.
**Split** (review): moves the handle to a new/target person; messages with that `sender_handle_id` now belong to it; items whose evidence messages are all sent by that handle are returned as `movedEvidenceCandidates` and set back to `proposed` on the original person with reviewLog `split` (SPEC M3 "可重新处理").

**Delete all data** — owner: **settings** (`DELETE /api/data`): deletes, for `owner_id = user`, in this order (batched): `evidence`, `claim_mentions`, `event_participants`, `claims`, `events`, `important_dates`, `relations`, `handles`, `attachments`, `import_messages`, `messages`, `extraction_jobs`, `llm_calls`, `review_log`, `imports`, `chats`, `persons`, `user_settings` (row deleted → defaults on next read); then R2 prefix `u/<ownerId>/`. Better Auth tables (`user`, `session`, `account`, `verification`) are kept. Response `deleted` has one key per table above.
**Export** — owner: **settings** (`GET /api/export`): `ExportDump` (§2.4) contains exactly the same tables (plus `user` id/email/name), attachments without bytes.

R2 key layout (all under `u/<ownerId>/`, so delete-all's prefix delete covers everything): attachments `u/<ownerId>/att/<importId>/<sha256-of-name>-<name>`; avatars `u/<ownerId>/avatar/<personId>`; staged parsed payload `u/<ownerId>/imp/<importId>/parsed.json` (import, §1.4; exists only while the import is `mapping`).

---

## 12. Waves, dependencies and critics

| Wave | Modules (parallel) | Depends on | Gate to next wave |
|---|---|---|---|
| 1a | core | – | app loads on :3000, sign-up/in works (sign-up → `/welcome` placeholder), `/api/health`, `/api/me`, `/api/settings`, all other routes stubbed (501) with full `AppType`, all bootstrap placeholders (§1.1) render 200, migrations applied, typecheck + tests green, `pnpm dev:ensure` |
| 1b (parallel with 1a) | parser, llm, eval-synthetic | contracts (core lands `contracts/**` first; until then code against §2 locally and reconcile) | parser tests; llm replay tests + ≤5 live smoke calls; synthetic ZIPs + intent files; harness + metric unit tests green on `eval/tests` mini fixtures with `fakeJudge` and a stub extractor; annotation tools work |
| 1c (after core) | verify-seed | core | `pnpm seed` + `pnpm verify _smoke/home-loads` passes with screenshots |
| 2 | import, extract, review, search; **annotator** (starts once parser passed) | 1 | backend critics pass; import/search/review UI critics on their showcases; gold frozen; extract eval gates (may carry into later loops per PLAN §4) |
| 3 | person, import-result, home, chat, settings | 1, 2 | UI critics ≥ 8.5 |
| 4 | deploy, integrator full flow, blind comparison (§12.2) | 3 | overall critic (the blind comparison is recorded, not a gate) |

**Wave-2 behaviour at wave-3 boundaries**: import overlay step 3 navigates to `/imports/:id`, which in wave 2 is core's placeholder page (200). The import e2e (`tests/e2e/import/**`, `verify/scenarios/import/flow.scenario.ts`) asserts: mapping 200, URL = `importHref(id)`, placeholder renders, `GET /api/imports/:id` shows `progress.total > 0` and `uploads.uploaded` increasing (upload runner is module-level, not page-bound). It does not call `jobs/next` in the browser (no live LLM in UI tests). Search's claim result navigates to the person placeholder page; the search scenario asserts URL `/p/<id>#claim-<id>` only. Evidence's "在聊天中查看" link targets the chat placeholder.

### 12.1 Dependency walk (every cross-module public entry used)

| consumer (wave) | uses | owner (wave) |
|---|---|---|
| parser (1) | `@/contracts`, `@/lib/time` | core (1) |
| llm (1) | `@/contracts`, `@/server/db` (logger, d1Budget) | core (1) |
| eval-synthetic (1) | `@/lib/wechat-export` | parser (1) |
| eval-synthetic (1) | `@/server/extract.extractOffline` | extract (2) — **harness is built and tested against a stub extractor in wave 1; real scoring starts in wave 2** (the only forward use; it is a runtime input to eval runs, not a build dependency) |
| verify-seed (1c) | `@/server/db`, `scripts/with-platform`, `@/server/auth`, `@/lib/pinyin`, `@/lib/lunar` | core (1) |
| import (2) | `@/lib/wechat-export` | parser (1) |
| import (2) | `@/server/llm.getAppLlm` | llm (1) |
| import (2) | `@/server/extract.processNextJob/retryFailedJobs/createJobsForImport` | extract (2) — public entry first rule |
| import (2) | `@/components/person-picker` | search (2) — core placeholder |
| import (2) | `GET /api/me` settings, `GET /api/search?types=people` | core (1), search (2) |
| extract (2) | `@/server/llm`, `@/server/db.getUserSettings`, `@/contracts` | llm (1), core (1) |
| review (2) | `@/server/db`, `@/lib/links`, `@/lib/time` | core (1) |
| search (2) | `POST /api/people` | review (2) — route stub returns 501 until review lands; search scenario for "新建人物" runs after review's route exists (search critic runs after review's backend critic in the same wave) |
| search (2) | `@/lib/links.personHref`, `@/lib/pinyin` | core (1) |
| person (3) | `@/components/evidence`, review routes | review (2) |
| person (3) | `@/components/person-picker` | search (2) |
| import-result (3) | `@/components/evidence`, review routes | review (2) |
| import-result (3) | `@/components/person-picker` | search (2) |
| import-result (3) | `AttachmentUploadStatus`, import routes incl. `DELETE /api/imports/:id` (delete-import control) | import (2) |
| import-result (3) | `PATCH /api/people/:id` (rename new person) | person (3) — same-wave route; 501 stub until person lands, page degrades inline; import-result scenarios stub it |
| import-result (3) | `GET /api/people/:id` (merge-dialog context line) | person (3) |
| home (3) | `@/server/search.listPeopleIndex`, `SearchTrigger` | search (2) |
| home (3) | `useImportOverlay` | import (2) |
| home (3) | `PATCH /api/settings`, `GET /api/me` | core (1) |
| chat (3) | `useImportOverlay`, `@/lib/links` | import (2), core (1) |
| settings (3) | `GET/PATCH /api/settings`, `@/lib/auth-client` (`authClient.changePassword`, `signOut`) | core (1) |
| import (2), extract (2) | `@/server/env` (`ServerEnv`, `c.var.env`) | core (1) |
| deploy (4) | everything | 1–3 |

Critics:
- **core** — backend critic: typecheck, tests, auth flow (sign-up → `/welcome`, sign-in, refresh, unauth `/` → `/sign-in`, unauth `/api/people` → 401, `/api/health` → 200), stubs return envelope 501, settings routes + isolation, owner lint test, AppType compiles with `hc`; plus UI critic on top bar + auth pages via `verify core/showcase`.
- **parser** — backend critic: unit tests over all SPEC §6 kinds + edge cases (multi-line, body starting with `·`, empty image filename, unknown `[xxx]`, same-minute duplicates, CRLF, BOM, trailing no newline), real-sample message counts equal an independent header-regex count (numbers only), no Node imports (lint test), perf bench, `messagesDigest` stability.
- **llm** — backend critic: interface matches §5, replay/record/live semantics, retry + deadline classification tests with fake fetch, logging (D1 + JSONL), no key leakage (grep test on logs/cassettes), budget stop + `llm:usage --reset/--json`.
- **verify-seed** — backend critic: `pnpm seed` twice (idempotent, counts stable), isolation (other users untouched), `pnpm verify _smoke/*` log schema and artifacts layout, perf statistic sanity.
- **eval-synthetic** — backend critic: synthetic ZIPs parse, cover every SPEC §6 kind/edge case + unseen formats, gold schema + drift guard + freeze/change-rule tests, metric unit tests on hand-built predictions with `fakeJudge` (every ErrorCode, subLabel, strict/lenient), annotation tools write only gitignored paths for real, no real data in committed files.
- **import** — backend critic (contract §2.4, typecheck, tests, two-account isolation, delete semantics incl. reassignment, F4) + UI critic on `import/*` (overlay steps 1–3, duplicate, parse error, upload-resume F5).
- **review** — backend critic (review/bulk/merge/split/manual add/create person, isolation, delete item) + UI critic on `review/evidence-showcase` (`/dev/review/evidence`: claim with 3 evidence messages across 2 chats, voice/transfer/red-packet chips, manual item, loading, error, 390 width).
- **search** — backend critic (search, people index, isolation incl. seed2 overlap) + UI critic on `search/*` (results, alias match, no results + 新建人物, keyboard, PersonPicker showcase at `/dev/search/person-picker`).
- **extract** — extract critic: `pnpm eval` gates (§7.4) with frozen gold, plus backend checks (F1, P4, model selection from settings).
- **person, import-result, home, chat, settings** — UI critic (design director) per PLAN §4 with their showcase + `e2e/*` scenarios; person additionally checks `#claim-` anchor scroll/highlight; settings also backend checks for export/delete-all table lists.
- **deploy** — backend critic: `opennextjs-cloudflare build` succeeds, worker size, remote migration dry-run, secrets not in config.
- **integrator** — after each wave: merge core-requests, typecheck/test all, restart dev server if needed, `llm:usage` into STATUS, commit.

Showcase scenario per UI module (required states: normal, empty, loading (route delayed 3 s), error (block 500), long content, 390 width): `verify/scenarios/<module>/showcase.scenario.ts`. Modules with overlays/shared components: `import/showcase` (steps 1–3, duplicate, parse error, close at step 2), `search/showcase` (results, alias match, no results), `review/evidence-showcase`, `search/person-picker`. `import-result/showcase` additionally shows the delete-import dialog open (not confirmed) and the unfinished (`mapping`) state (route-stubbed `GET /api/imports/:id`); the destructive path is `import-result/delete-import` (F7).

### 12.2 Blind comparison (PLAN §5; not a gate)
- **Owner**: the orchestrator runs it in wave 4 after the overall critic; the integrator captures our screenshots. No builder or critic that worked on UI acts as judge.
- **Our screenshots**: `pnpm verify e2e/blind-shots` (verify-seed scenario, account `seed` — synthetic data only, never real imports), width 1440, full-page: home `/` and person `/p/<long-profile>`.
- **Reference screenshots**: Monica's publicly published screenshots of its contact page and dashboard (monicahq.com site / public docs / public repository README), downloaded by the orchestrator; source URLs recorded in `sources.json`. Not committed (third-party images). If none can be fetched, record that in DECISIONS `## integrator` and skip.
- **Layout** (all under gitignored `artifacts/blind-judge/<YYYYMMDD-HHmmss>/`): `ours/{home,person}.png`, `reference/{dashboard,contact}.png`, `sources.json`, `pairs/<n>/A.png` + `B.png` (pair 1 = home vs dashboard, pair 2 = person vs contact; A/B order from a random coin recorded only in `key.json`), `judge-input.md` (the two questions verbatim: 哪一个更能帮你记住这个人？哪一个看起来更用心？请说明理由), `judge-output.json` (`{ pairs: [{ n, remember: 'A'|'B', care: 'A'|'B', reasons: string }] }`), `result.json` (judge output joined with `key.json`).
- **Judge**: a fresh agent that did not take part in development, given only `pairs/**` and `judge-input.md` (not `key.json`, not file names containing "ours"/"reference").
- **Record**: the orchestrator appends a short summary (which side won each question, one-line reasons) to DECISIONS.md under `## integrator`. It does not affect any score or pass.
