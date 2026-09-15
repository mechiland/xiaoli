# Core requests — llm

## #1 Type `fakeLlm` / `createTestApp.llm` with the real `LlmClient`
- status: done
- requested-by: llm, round 1, 2026-09-15
- kind: contract
- paths: tests/helpers/test-db.ts
- change: `import type { LlmClient, LlmJsonRequest, LlmJsonResult, LlmError } from '@/server/llm'`; `fakeLlm(script: (LlmJsonResult | LlmError | ((req: LlmJsonRequest) => LlmJsonResult | LlmError | Promise<LlmJsonResult | LlmError>))[]): LlmClient & { calls: LlmJsonRequest[] }`; `createTestApp({ llm?: LlmClient })`. Type-only import, so no runtime cycle.
- why: `@/server/llm` now exists. extract/import tests would otherwise cast `unknown`, and a scripted result with a typo in `code` would compile.
- workaround: consumers cast `fakeLlm(...) as unknown as LlmClient`; `getAppLlm(c)` already returns `c.var.llmOverride` when set (tested in server/llm/d1.test.ts).
- blocking: no
- Resolution (integrator, wave 1, 2026-09-15): `tests/helpers/test-db.ts`: `fakeLlm(script: ScriptedLlmStep[]): LlmClient & { calls: LlmJsonRequest[] }` with type-only imports from `@/server/llm`; `createTestApp({ llm?: LlmClient })`. `AppDeps.llmOverride` / `c.var.llmOverride` stay `unknown` so core does not import llm at runtime; `getAppLlm` narrows. Consumers can drop the `as unknown as LlmClient` casts.

## #2 `pnpm llm:smoke` script alias
- status: done
- requested-by: llm, round 1, 2026-09-15
- kind: config
- paths: package.json
- change: add `"llm:smoke": "tsx scripts/run-owned.ts server/llm/smoke.ts llm --"` (usage `pnpm llm:smoke -- --live`)
- why: one discoverable command for the opt-in live smoke check (one tiny synthetic JSON request, recorded under fixtures/cassettes/synthetic); DECISIONS ## llm L14
- workaround: `node --import tsx server/llm/smoke.ts [--live]`
- blocking: no
- Resolution (integrator, wave 1, 2026-09-15): Added `"llm:smoke": "tsx scripts/run-owned.ts server/llm/smoke.ts llm --"`; usage `pnpm llm:smoke -- --live`.
