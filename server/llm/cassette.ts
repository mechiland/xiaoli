// Cassette format, key and stores (ARCHITECTURE §5 "Cassettes"). Pure; the directory store loads node:fs lazily.
import { z } from 'zod'
import { LlmErrorCodeSchema, LlmPurposeSchema } from '@/contracts'
import { sha256Hex } from './sha256'
import type { LlmJsonRequest, LlmThinking } from './types'

export const CASSETTE_ROOT = 'fixtures/cassettes'

/** Committed cassettes for synthetic inputs, gitignored ones for real chats. The caller picks by data origin. */
export function cassetteDirFor(source: 'synthetic' | 'real'): string {
  return `${CASSETTE_ROOT}/${source}`
}

const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  cacheHitTokens: z.number().int().nonnegative().nullable().default(null),
})

export const CassetteSchema = z
  .object({
    key: z.string().regex(/^[0-9a-f]{32}$/),
    recordedAt: z.string(),
    model: z.string().min(1),
    promptVersion: z.string().min(1),
    purpose: LlmPurposeSchema,
    request: z.object({
      messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() })),
      maxTokens: z.number().int().positive(),
      temperature: z.number(),
      thinking: z.enum(['enabled', 'disabled']),
    }),
    response: z
      .object({
        content: z.string().nullable(),
        finishReason: z.string().nullable(),
        usage: UsageSchema.nullable().default(null),
        latencyMs: z.number().nonnegative().default(0),
      })
      .nullable(),
    error: z
      .object({
        code: LlmErrorCodeSchema,
        message: z.string().default(''),
        latencyMs: z.number().nonnegative().optional(),
      })
      .nullable(),
  })
  .refine((c) => (c.response === null) !== (c.error === null), { message: 'exactly one of response or error must be set' })

export type Cassette = z.output<typeof CassetteSchema>

/** sha256(JSON.stringify({ model, promptVersion, purpose, messages, maxTokens, temperature, thinking })), first 32 hex. */
export function cassetteKey(req: LlmJsonRequest, thinking: LlmThinking | string): string {
  const payload = {
    model: req.model,
    promptVersion: req.promptVersion,
    purpose: req.purpose,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    maxTokens: req.maxTokens,
    temperature: req.temperature ?? 0,
    thinking,
  }
  return sha256Hex(JSON.stringify(payload)).slice(0, 32)
}

/** promptVersion as a single safe path segment. */
export function safeSegment(v: string): string {
  const s = v.replace(/[^A-Za-z0-9._-]/g, '_')
  return s === '.' || s === '..' || s === '' ? '_' : s
}

/** `<promptVersion>/<key>.json`, relative to the cassette dir. */
export function cassetteRelPath(promptVersion: string, key: string): string {
  return `${safeSegment(promptVersion)}/${key}.json`
}

export interface CassetteStore {
  /** null when absent; throws when the file exists but is not a valid cassette */
  read(promptVersion: string, key: string): Promise<Cassette | null>
  write(c: Cassette): Promise<void>
  /** human-readable location for error messages */
  describe(promptVersion: string, key: string): string
}

/** Directory store (Node only at call time: node:fs is imported on first use). */
export function dirCassetteStore(dir: string): CassetteStore {
  let loaded: Promise<CassetteStore> | null = null
  const get = () => (loaded ??= import('./node/fs-io').then((m) => m.fsCassetteStore(dir)))
  return {
    read: async (v, k) => (await get()).read(v, k),
    write: async (c) => (await get()).write(c),
    describe: (v, k) => `${dir.replace(/\/+$/, '')}/${cassetteRelPath(v, k)}`,
  }
}

/** In-memory store for tests; entries are validated like files. */
export function memoryCassetteStore(initial: unknown[] = []): CassetteStore & { entries: Map<string, Cassette> } {
  const entries = new Map<string, Cassette>()
  const put = (raw: unknown) => {
    const c = CassetteSchema.parse(raw)
    entries.set(cassetteRelPath(c.promptVersion, c.key), c)
  }
  initial.forEach(put)
  return {
    entries,
    async read(v, k) {
      return entries.get(cassetteRelPath(v, k)) ?? null
    },
    async write(c) {
      put(c)
    },
    describe: (v, k) => `memory:${cassetteRelPath(v, k)}`,
  }
}
