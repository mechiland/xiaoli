# Core requests — import

## #1 `unwrap` rejects routes whose validator adds a 400 branch
- status: done
- requested-by: import, round 1, 2026-09-15
- kind: contract
- paths: lib/api-client.ts
- change: `unwrap` takes one `ClientResponse<T, S, F>`, but every route with `validator(...)` returns a union of `ClientResponse<ApiErrorBody, 400, 'json'> | ClientResponse<Body, ContentfulStatusCode, 'json'>`, which fails with TS2345 (review's evidence and search's person-picker hit the same error). Proposed: `export async function unwrap<R extends ClientResponse<unknown, number, string>>(res: R): Promise<SuccessBody<R extends ClientResponse<infer T, number, string> ? T : never>>`, i.e. infer the body over the whole union and drop the error branch.
- why: typed RPC calls cannot be unwrapped for import's routes (all of them validate input).
- workaround: `components/import-overlay/http.ts` `requestJson<T>()` (fetch + contract types, throws `ApiClientError` like `unwrap`). Swap back to `api.*` + `unwrap` when fixed.
- blocking: no
- Resolution (integrator, wave 2, 2026-09-15): `lib/api-client.ts` `unwrap<R extends ClientResponse<unknown, number, ResponseFormat>>(res: R): Promise<SuccessBody<ResponseBody<R>>>`; the body type distributes over the response union and error-envelope branches drop out. Existing callers (including casts to a single `ClientResponse`) still compile. import/review/search can drop their workarounds/casts.

## #2 Tailwind colour for `--loam-ink-inverse`
- status: done
- requested-by: import, round 1, 2026-09-15
- kind: ui-slot
- paths: app/globals.css
- change: add `--color-ink-inverse: var(--loam-ink-inverse);` to the `@theme inline` block (next to `--color-ink-3`).
- why: `text-ink-inverse` silently renders nothing (the selected 私聊/群聊 segment showed an empty black box in the first step-2 screenshot).
- workaround: `text-paper` (same value today).
- blocking: no
- Resolution (integrator, wave 2, 2026-09-15): Added `--color-ink-inverse: var(--loam-ink-inverse);` to `@theme inline` in `app/globals.css`; `text-ink-inverse` now works.

## #3 ARCHITECTURE §1.4 / §11 text updates to match the implemented import lifecycle
- status: done
- requested-by: import, round 1, 2026-09-15
- kind: other
- paths: ARCHITECTURE.md §1.4, §11
- change:
  1. `alignMessages(existing: { id; seq; fingerprint; sentAt?: MsgTime }[], …)` — optional `sentAt` (additive) places unmatched messages by time between matched anchors; without it a disjoint later export would be placed before the stored messages.
  2. Mapping order: resequence (a uniform ×1024 rescale of the chat's seqs, two-phase in one batch) runs **before** inserting new messages, not after (new seqs are computed against the rescaled values).
  3. Mapping links `imports.chat_id` **before** `createJobsForImport` (extract reads the import's chat; it answers 409 otherwise). Status still becomes `extracting` in the final batch.
  4. `imports.status = 'parsed'` marks a mapping request in flight (conditional claim `mapping → parsed`; failure rolls back and returns to `mapping`). `check`/`POST /api/imports` treat `parsed` like `mapping` (stale, never a duplicate).
  5. §11 delete import: also deletes display handles created by this import's mapping (`source_kind='manual'`, `import_id = importId`) that no remaining message uses and that have no evidence outside M — otherwise persons created by the import could never be removed while the chat survives.
- why: the text is the binding contract; critics check against it (DECISIONS `## import` I1–I4 give the reasons).
- workaround: implemented as described; nothing to remove.
- blocking: no
- Resolution (integrator, wave 2, 2026-09-15): ARCHITECTURE updated: §1.4 `alignMessages` `existing[].sentAt?: MsgTime` with a note on time placement; mapping order is resequence (×1024 rescale) → new messages → import_messages → attachments, `imports.chat_id` linked before `createJobsForImport`; `parsed` = mapping in flight (conditional claim, rollback to `mapping`), `check`/`POST /api/imports` treat `parsed` like `mapping`; §11 step 5 deletes this import's manual display handles with no remaining message use and no evidence outside M. Text only; no other module affected.

## #4 ARCHITECTURE §1.4 / §11 text: renumber instead of ×1024 rescale; created-by handover on delete
- status: done
- requested-by: import, round 2, 2026-09-15
- kind: other
- paths: ARCHITECTURE.md §1.4, §11
- change:
  1. §1.4 mapping order, "resequence updates (a uniform ×1024 rescale of the chat's seqs, two-phase in one batch; …)" → "resequence: when a gap is too small the chat is renumbered to rank × unit (unit a power of two ≥ (largest gap + 1)·1024; seqs ≤ 2^52), in one atomic batch that first moves the extraction job windows of the chat's other imports onto the new numbering (same messages), then updates messages two-phase; runs before the inserts".
  2. §1.4 `alignMessages` note: `resequence` is a rank renumber (stored message k → (k+1)·unit), never a multiplication of old seqs.
  3. §1.4 "any failure deletes the rows it inserted and returns the status to `mapping`" → add "and restores re-pointed handles, re-selected attachments, renumbered seqs and job windows".
  4. §11 step 5: before deleting the import row, manual display handles and non-self persons with `import_id = importId` that another import still uses get `import_id` = the earliest such import (so a later delete of that import removes them).
- why: critic round 1 (import) findings 1–4; the text is the binding contract. DECISIONS import I1, I4, I15, I16.
- workaround: implemented as described; nothing to remove.
- blocking: no
- Resolution (integrator, wave 2, 2026-09-15): ARCHITECTURE updated (text only): §1.4 mapping order now describes the rank × unit renumber (job windows of the chat's other imports moved in the same atomic batch, seqs ≤ 2^52, before the inserts); `alignMessages` note says `resequence` is a rank renumber (I1, I15); failure rollback also restores re-pointed handles, re-selected attachments, renumbered seqs and job windows (I16); §11 step 5 hands manual display handles and non-self persons still used by another import over to the earliest such import (I4). Checked against `server/import/{align,mapping}.ts`.
