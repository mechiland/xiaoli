// LLM judge for claim/event matching (step A) and false-positive classification (step B), ARCHITECTURE §7.3.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { Category, MsgTime } from '@/contracts'
import type { LlmClient, LlmMode } from './entries'
import { NegativeKind } from './gold-schema'
import { bigramJaccard } from './text'

// ---------------------------------------------------------------- contracts
export const MatchInputSchema = z.object({
  person: z.object({ key: z.string(), label: z.string() }),
  gold: z.array(z.object({ id: z.string(), statement: z.string(), category: Category })),
  pred: z.array(z.object({ index: z.number().int(), statement: z.string(), category: Category })),
})
export type MatchInput = z.infer<typeof MatchInputSchema>
export const Verdict = z.enum(['same', 'less_specific', 'different'])
export type Verdict = z.infer<typeof Verdict>
export const MatchOutputSchema = z
  .object({ matches: z.array(z.object({ pred: z.number().int(), gold: z.string().nullable(), verdict: Verdict })) })
  .strict()
export type MatchOutput = z.infer<typeof MatchOutputSchema>

/**
 * `loop` is additive (goldVersion 2). Loop FPs are classified in their own batches, so the batches — and therefore
 * the judge-cache keys — of the five round-1 types are byte-identical to before. `judge-fp.v1.md` is deliberately
 * left untouched: bumping its version would invalidate every committed cache entry and force a judge fallback in
 * replay (DECISIONS eval-synthetic E21).
 */
export const FpItemType = z.enum(['claim', 'handle', 'relation', 'date', 'event', 'loop'])
export const FpClassifyInputSchema = z.object({
  zip: z.string(),
  persons: z.array(z.object({ key: z.string(), label: z.string(), aliases: z.array(z.string()) })),
  goldClaims: z.array(z.object({ id: z.string(), person: z.string(), statement: z.string() })),
  negatives: z.array(z.object({ id: z.string(), kind: NegativeKind, description: z.string(), forbidden: z.string().nullable() })),
  items: z
    .array(
      z.object({
        fpId: z.string(),
        type: FpItemType,
        person: z.string(),
        text: z.string(),
        evidenceWindow: z.array(z.object({ idx: z.number().int(), sentAt: MsgTime, senderName: z.string(), body: z.string(), isEvidence: z.boolean() })).max(30),
      }),
    )
    .min(1)
    .max(10),
})
export type FpClassifyInput = z.infer<typeof FpClassifyInputSchema>
export const FpLabel = z.enum(['factual_error', 'wrong_person', 'over_inference', 'should_ignore', 'other'])
export type FpLabel = z.infer<typeof FpLabel>
export const FpSubLabel = z.enum(['transactional', 'coordination', 'invisible_content', 'not_about_person'])
export type FpSubLabel = z.infer<typeof FpSubLabel>
const FpLabelRow = z.object({
  fpId: z.string(),
  label: FpLabel,
  subLabel: FpSubLabel.nullable(),
  goldId: z.string().nullable(),
  negativeId: z.string().nullable(),
  reason: z.string().max(120),
})
export const FpClassifyOutputSchema = z.object({ labels: z.array(FpLabelRow) }).strict()
export type FpClassifyOutput = z.infer<typeof FpClassifyOutputSchema>

export interface JudgeStats {
  calls: number
  cacheHits: number
  inputTokens: number
  outputTokens: number
  /** calls answered by the deterministic fallback (replay cache miss, LLM error, invalid output) */
  fallbacks: number
}
export interface JudgeClient {
  matchClaims(i: MatchInput): Promise<MatchOutput>
  classifyFps(i: FpClassifyInput): Promise<FpClassifyOutput>
  stats(): JudgeStats
}

// ---------------------------------------------------------------- output sanitation (shared by all judges)
/** One row per input pred; unknown gold ids and duplicates dropped; missing preds → different. */
export function sanitizeMatch(input: MatchInput, out: MatchOutput): MatchOutput {
  const goldIds = new Set(input.gold.map((g) => g.id))
  const byPred = new Map<number, MatchOutput['matches'][number]>()
  for (const m of out.matches) {
    if (!input.pred.some((p) => p.index === m.pred) || byPred.has(m.pred)) continue
    const gold = m.gold !== null && goldIds.has(m.gold) ? m.gold : null
    byPred.set(m.pred, { pred: m.pred, gold, verdict: gold === null ? 'different' : m.verdict === 'different' ? 'different' : m.verdict })
  }
  return { matches: input.pred.map((p) => byPred.get(p.index) ?? { pred: p.index, gold: null, verdict: 'different' as const }) }
}

export function sanitizeFp(input: FpClassifyInput, out: FpClassifyOutput): FpClassifyOutput {
  const byId = new Map(out.labels.map((l) => [l.fpId, l]))
  return {
    labels: input.items.map((it) => {
      const l = byId.get(it.fpId)
      if (!l) return { fpId: it.fpId, label: 'other' as const, subLabel: null, goldId: null, negativeId: null, reason: 'judge returned no label' }
      return { ...l, subLabel: l.label === 'should_ignore' ? l.subLabel : null }
    }),
  }
}

// ---------------------------------------------------------------- deterministic fallback (§7.3)
export function fallbackMatch(input: MatchInput): MatchOutput {
  return {
    matches: input.pred.map((p) => {
      let best: { id: string; score: number } | null = null
      for (const g of input.gold) {
        const s = bigramJaccard(p.statement, g.statement)
        if (s >= 0.5 && (!best || s > best.score)) best = { id: g.id, score: s }
      }
      return best ? { pred: p.index, gold: best.id, verdict: 'same' as const } : { pred: p.index, gold: null, verdict: 'different' as const }
    }),
  }
}
export function fallbackFp(input: FpClassifyInput): FpClassifyOutput {
  return { labels: input.items.map((it) => ({ fpId: it.fpId, label: 'other' as const, subLabel: null, goldId: null, negativeId: null, reason: 'judge fallback' })) }
}

// ---------------------------------------------------------------- prompts
export interface JudgePrompt {
  version: string
  system: string
  userTemplate: string
  exampleJson: string
}
export function loadJudgePrompt(file: string): JudgePrompt {
  const text = readFileSync(file, 'utf8')
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)
  const version = fm && /version:\s*(\S+)/.exec(fm[1])?.[1]
  if (!version) throw new Error(`${file}: missing front-matter version`)
  const section = (name: string) => {
    const m = new RegExp(`^## ${name}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(text)
    if (!m) throw new Error(`${file}: missing section ## ${name}`)
    return m[1].trim()
  }
  return { version, system: section('system'), userTemplate: section('user_template'), exampleJson: section('example_json') }
}

export function renderJudgeMessages(p: JudgePrompt, input: unknown, vars: Record<string, string> = {}) {
  let user = p.userTemplate.replace('{{input}}', JSON.stringify(input))
  for (const [k, v] of Object.entries(vars)) user = user.replace(`{{${k}}}`, v)
  return [
    { role: 'system' as const, content: `${p.system}\n\n输出 json 示例：\n${p.exampleJson}` },
    { role: 'user' as const, content: user },
  ]
}

// ---------------------------------------------------------------- cache
export function judgeCacheKey(promptVersion: string, input: unknown): string {
  return createHash('sha256').update(promptVersion + JSON.stringify(input)).digest('hex')
}
export class JudgeCache {
  constructor(readonly dir: string) {}
  get(key: string): unknown | undefined {
    const f = path.join(this.dir, `${key}.json`)
    if (!existsSync(f)) return undefined
    return (JSON.parse(readFileSync(f, 'utf8')) as { output: unknown }).output
  }
  put(key: string, promptVersion: string, model: string, output: unknown): void {
    mkdirSync(this.dir, { recursive: true })
    const f = path.join(this.dir, `${key}.json`)
    const tmp = `${f}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify({ inputHash: key, promptVersion, model, createdAt: new Date().toISOString(), output }, null, 2) + '\n')
    renameSync(tmp, f)
  }
}

// ---------------------------------------------------------------- LLM judge
export const JUDGE_MODEL = 'deepseek-flash'
export const MATCH_CHUNK = 12

export function llmJudge(opts: {
  llm: LlmClient | null
  cache: JudgeCache
  mode: LlmMode
  promptsDir: string
  evalRunId?: string
  model?: string
}): JudgeClient & { versions: { match: string; fp: string } } {
  const matchPrompt = loadJudgePrompt(path.join(opts.promptsDir, 'judge-match.v1.md'))
  const fpPrompt = loadJudgePrompt(path.join(opts.promptsDir, 'judge-fp.v1.md'))
  const model = opts.model ?? JUDGE_MODEL
  const stats: JudgeStats = { calls: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0, fallbacks: 0 }

  async function ask<I, O>(prompt: JudgePrompt, input: I, schema: z.ZodType<O>, fallback: (i: I) => O, vars: Record<string, string>): Promise<O> {
    const key = judgeCacheKey(prompt.version, input)
    const cached = opts.cache.get(key)
    if (cached !== undefined) {
      const parsed = schema.safeParse(cached)
      if (parsed.success) {
        stats.cacheHits++
        return parsed.data
      }
    }
    if (opts.mode === 'replay' || !opts.llm) {
      stats.fallbacks++
      return fallback(input)
    }
    stats.calls++
    const res = await opts.llm.completeJson({
      purpose: 'judge',
      promptVersion: prompt.version,
      model,
      messages: renderJudgeMessages(prompt, input, vars),
      maxTokens: 1024,
      temperature: 0,
      context: { evalRunId: opts.evalRunId ?? null },
    })
    if (!res.ok) {
      stats.fallbacks++
      return fallback(input)
    }
    stats.inputTokens += res.usage.inputTokens
    stats.outputTokens += res.usage.outputTokens
    const parsed = schema.safeParse(res.json)
    if (!parsed.success) {
      stats.fallbacks++
      return fallback(input)
    }
    opts.cache.put(key, prompt.version, res.model, parsed.data)
    return parsed.data
  }

  return {
    versions: { match: matchPrompt.version, fp: fpPrompt.version },
    async matchClaims(input) {
      const rows: MatchOutput['matches'] = []
      for (let i = 0; i < input.pred.length; i += MATCH_CHUNK) {
        const chunk: MatchInput = { ...input, pred: input.pred.slice(i, i + MATCH_CHUNK) }
        const out = await ask(matchPrompt, chunk, MatchOutputSchema, fallbackMatch, { person: `${input.person.label}（${input.person.key}）` })
        rows.push(...sanitizeMatch(chunk, out).matches)
      }
      return { matches: rows }
    },
    async classifyFps(input) {
      const out = await ask(fpPrompt, input, FpClassifyOutputSchema, fallbackFp, {})
      return sanitizeFp(input, out)
    },
    stats: () => ({ ...stats }),
  }
}

// ---------------------------------------------------------------- fake judge (unit tests)
export interface FakeJudgeTable {
  /** pred statement → gold id + verdict (unlisted → different) */
  matches?: Record<string, { gold: string; verdict: Verdict }>
  /** fp text → label (unlisted → other) */
  labels?: Record<string, { label: FpLabel; subLabel?: FpSubLabel | null; goldId?: string | null; negativeId?: string | null }>
}
export function fakeJudge(table: FakeJudgeTable): JudgeClient & { inputs: { match: MatchInput[]; fp: FpClassifyInput[] } } {
  const inputs = { match: [] as MatchInput[], fp: [] as FpClassifyInput[] }
  return {
    inputs,
    async matchClaims(i) {
      inputs.match.push(i)
      return sanitizeMatch(i, {
        matches: i.pred.map((p) => {
          const hit = table.matches?.[p.statement]
          return hit ? { pred: p.index, gold: hit.gold, verdict: hit.verdict } : { pred: p.index, gold: null, verdict: 'different' as const }
        }),
      })
    },
    async classifyFps(i) {
      inputs.fp.push(FpClassifyInputSchema.parse(i))
      return sanitizeFp(i, {
        labels: i.items.map((it) => {
          const l = table.labels?.[it.text]
          return { fpId: it.fpId, label: l?.label ?? 'other', subLabel: l?.subLabel ?? null, goldId: l?.goldId ?? null, negativeId: l?.negativeId ?? null, reason: 'fake' }
        }),
      })
    },
    stats: () => ({ calls: inputs.match.length + inputs.fp.length, cacheHits: 0, inputTokens: 0, outputTokens: 0, fallbacks: 0 }),
  }
}
