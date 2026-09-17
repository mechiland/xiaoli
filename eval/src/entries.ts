// Runtime access to other modules' public entries (parser, llm, extract).
// eval-synthetic is wave 1b and must compile before those modules exist, so the shapes below mirror ARCHITECTURE §1.2,
// §5 and §6 verbatim and the modules are loaded with a dynamic import of their entry file.
// TODO(eval-synthetic): once parser/llm/extract land, replace these mirrors with `import type` from the public entries.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Category, ExtractModel, LlmErrorCode, LoopCloseReason, LoopDirection, LoopKind, MessageKind, ParsedExport, ParsedMessage } from '@/contracts'
import type { GoldMapping } from './gold-schema'

// ---------------------------------------------------------------- parser (§1.2)
export interface ParserApi {
  parseExportZip(zip: Uint8Array | ArrayBuffer, opts?: { fileName?: string }): Promise<ParsedExport>
  messagesDigest(msgs: { senderName: string; sentAt: string; body: string }[]): Promise<string>
  fingerprint(m: { senderName: string; sentAt: string; body: string; kind: MessageKind }): string
  PARSER_VERSION: string
}

// ---------------------------------------------------------------- llm (§5)
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}
export interface LlmJsonRequest {
  /** `contracts/llm.ts` `LlmPurpose`; the interaction call (DECISIONS I17) may arrive as `extract` or `interaction` */
  purpose: 'extract' | 'dedup' | 'judge' | 'other' | 'interaction'
  promptVersion: string
  model: string
  messages: LlmMessage[]
  maxTokens: number
  temperature?: number
  timeoutMs?: number
  deadlineAt?: number
  maxTransportRetries?: number
  context?: { ownerId?: string | null; importId?: number | null; jobId?: number | null; evalRunId?: string | null }
}
export interface LlmJsonResult {
  ok: true
  json: unknown
  raw: string
  usage: { inputTokens: number; outputTokens: number; cacheHitTokens: number | null }
  latencyMs: number
  model: string
  finishReason: string
  fromCassette: boolean
}
export interface LlmError {
  ok: false
  code: LlmErrorCode
  message: string
  raw: string | null
  retryable: boolean
  latencyMs: number
}
export interface LlmClient {
  completeJson(req: LlmJsonRequest): Promise<LlmJsonResult | LlmError>
}
export type LlmMode = 'live' | 'record' | 'replay'
export interface LlmApi {
  createLlmClient(opts: { env: Record<string, unknown>; logger: unknown; mode: LlmMode; cassetteDir?: string; budget: unknown | null }): LlmClient
  jsonlCallLogger(path: string): unknown
  fileBudget(path?: string): Promise<unknown>
}

// ---------------------------------------------------------------- extract (§6)
export type WindowOutcomeStatus = 'done' | 'retryable_error' | 'fatal_error'
export interface OfflineExtractionResult {
  persons: { key: string; label: string; isSelf: boolean }[]
  handles: { person: string; kind: string; value: string; evidence: number[]; windowIndex: number }[]
  relations: { from: string; to: string; type: string; label?: string; evidence: number[]; windowIndex: number }[]
  claims: { person: string; statement: string; category: Category; validFrom?: string; confidence: number; sensitive: boolean; supersedes?: number; evidence: number[]; windowIndex: number }[]
  events: { summary: string; happenedAt?: string; place?: string; participants: string[]; evidence: number[]; windowIndex: number }[]
  dates: { person: string; kind: string; day?: number; month?: number; year?: number; calendar: 'solar' | 'lunar'; isLeapMonth?: boolean; evidence: number[]; windowIndex: number }[]
  /**
   * Interaction layer (SPEC §8.8), produced from `prompts/extract.v9.md` on. **These names are extract's, copied
   * from `OfflineItems` in `server/extract/memory-store.ts` (ARCHITECTURE §6); they are not the harness's to
   * choose.** They are required, not optional, on purpose: `eval/tests/offline-contract.test.ts` assigns the real
   * `OfflineExtractionResult` to this type, so a rename on extract's side fails a typecheck instead of silently
   * making every interaction metric read `undefined` and report a healthy-looking zero.
   * All message references are parsed-export idx, like every other type.
   */
  segments: {
    startIdx: number
    endIdx: number
    startedAt: string
    endedAt: string
    messageCount: number
    summary: string
    topics: string[]
    participants: { person: string; messageCount: number }[]
    evidence: number[]
    windowIndex: number
  }[]
  loops: {
    person: string
    direction: LoopDirection
    kind: LoopKind
    text: string
    dueAt?: string
    openedAt: string
    openedIdx: number
    /** resolved state after every window's `closes` were applied: null = still open */
    closedIdx: number | null
    closedAt: string | null
    closedReason: LoopCloseReason | null
    evidence: number[]
    windowIndex: number
  }[]
  /** the close events themselves; `loopIndex` points into `loops` (§7.4 `loopFalseClose` is about the event) */
  closes: { loopIndex: number; reason: LoopCloseReason; evidence: number[]; windowIndex: number }[]
  windows: { index: number; startIdx: number; endIdx: number; outcome: WindowOutcomeStatus; code?: string; attempts: number; attemptMs: number[]; latencyMs: number; rawItemCount: number; droppedInvalidEvidence: number; dedup?: string; /** interaction call outcome of the last attempt: 'ok' | 'failed' | 'skipped_deadline' | 'not_needed' (DECISIONS I17) */ interaction?: string; rawOutputs: string[] }[]
  deadlinePolicy: 'app' | 'none'
  usage: { inputTokens: number; outputTokens: number; calls: number }
  promptVersion: string
  /**
   * The interaction call's own prompt version (DECISIONS I17). Optional because extract may not report it; the
   * harness does not depend on it — it reads the prompt version off the calls the run actually made
   * (`eval/src/usage.ts`) and uses this only as a fallback label.
   */
  interactionPromptVersion?: string | null
  model: string
}
export interface ExtractOfflineArgs {
  parsed: ParsedExport
  mapping: GoldMapping
  llm: LlmClient
  model?: ExtractModel
  promptVersion?: string
  deadlinePolicy?: 'app' | 'none'
  onWindow?: (i: number, total: number, outcome: unknown) => void
}
export interface ExtractApi {
  extractOffline(args: ExtractOfflineArgs): Promise<OfflineExtractionResult>
  PROMPT_VERSION: string
  /** DECISIONS I17: the interaction layer's own prompt version. Optional — a build without the second call has none. */
  INTERACTION_PROMPT_VERSION?: string
}

// ---------------------------------------------------------------- loading
export type Loaded<T> = { ok: true; api: T } | { ok: false; module: string; entry: string; reason: string }

async function loadEntry<T>(root: string, module: string, entry: string, required: string[]): Promise<Loaded<T>> {
  const abs = path.join(root, entry)
  if (!existsSync(abs)) return { ok: false, module, entry, reason: `${entry} does not exist yet (owned by the "${module}" module)` }
  try {
    const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>
    const missing = required.filter((name) => mod[name] === undefined)
    if (missing.length) return { ok: false, module, entry, reason: `${entry} does not export ${missing.join(', ')}` }
    return { ok: true, api: mod as unknown as T }
  } catch (e) {
    return { ok: false, module, entry, reason: `importing ${entry} failed: ${(e as Error).message.split('\n')[0]}` }
  }
}

export const loadParser = (root: string) => loadEntry<ParserApi>(root, 'parser', 'lib/wechat-export/index.ts', ['parseExportZip', 'messagesDigest', 'fingerprint', 'PARSER_VERSION'])
export const loadLlm = (root: string) => loadEntry<LlmApi>(root, 'llm', 'server/llm/index.ts', ['createLlmClient', 'jsonlCallLogger', 'fileBudget'])
export const loadExtract = (root: string) => loadEntry<ExtractApi>(root, 'extract', 'server/extract/index.ts', ['extractOffline'])

export type { ParsedExport, ParsedMessage }
