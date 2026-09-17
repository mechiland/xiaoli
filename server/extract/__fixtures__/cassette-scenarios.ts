// Hand-written failure cassettes (ARCHITECTURE §5 "Cassettes", §10 F1). The responses below are written by hand; the
// request part and key are computed from the real prompt rendering so replay hits them. Regenerate after a rendering
// change: node --import tsx server/extract/__fixtures__/build-cassettes.ts (cassettes.test.ts fails when stale).
import type { Cassette, LlmClient, LlmJsonRequest } from '@/server/llm'
import { cassetteKey } from '@/server/llm'
import { extractOffline } from '../offline'
import { INTERACTION_PROMPT_VERSION } from '../prompt-version'
import { mappingFor, ONE_WINDOW, parsedChat, QUOTE_PROMISE, type Line } from './chats'

export const FIXTURE_PROMPT_VERSION = 'extract.v1'
export const CASSETTE_DIR = 'server/extract/__fixtures__/cassettes'

type Body = { response: NonNullable<Cassette['response']>; error: null } | { response: null; error: NonNullable<Cassette['error']> }

export interface Scenario {
  name: string
  title: string
  /** the extraction call's recorded answer */
  body: Body
  /** additive: a scenario recorded against another extraction prompt version */
  promptVersion?: string
  /**
   * additive: the INTERACTION call's recorded answer (ARCHITECTURE §6 — a second, parallel call with its own prompt
   * version, so its cassette lands in a separate `interaction.vN/` directory). Scenarios that leave this out get the
   * empty answer below, because `extractWindow` issues the interaction call for every window and a missing cassette
   * would be a `cassette_miss`, not a no-op.
   */
  interactionBody?: Body
  /** additive: the chat this scenario replays; defaults to ONE_WINDOW */
  lines?: Line[]
}

export const versionOf = (s: Scenario): string => s.promptVersion ?? FIXTURE_PROMPT_VERSION
/** every prompt version that has hand-written cassettes (both calls) */
export const FIXTURE_VERSIONS = (): string[] => [...new Set([...SCENARIOS.map(versionOf), INTERACTION_PROMPT_VERSION])].sort()

const answer = (json: unknown, outputTokens: number, latencyMs: number): Body => ({
  response: { content: JSON.stringify(json), finishReason: 'stop', usage: { inputTokens: 1200, outputTokens, cacheHitTokens: 0 }, latencyMs },
  error: null,
})

/** "nothing worth recording happened here": the answer the interaction prompt is told to give for small talk. */
const EMPTY_INTERACTION = answer({ segment: null, loops: [], closes: [] }, 12, 300)

/**
 * Interaction layer (SPEC §8.8, `INTERACTION_PROMPT_VERSION`): the model answers with a segment and one promise, nothing closed.
 * The chat has no earlier segment or loop, so the known-person block carries neither.
 */
const INTERACTION_JSON = {
  segment: { summary: '对了柜子报价的进度，阿明说周五前给结果', topics: ['柜子', '报价'], speakers: [{ personId: 1 }, { personId: 2 }], evidence: [1, 2] },
  loops: [{ person: { personId: 2 }, direction: 'theirs', kind: 'promise', text: '周五前把柜子报价发过来', evidence: [2] }],
  closes: [],
}
/** the extraction half of the interaction scenario: nothing about a person is said in that chat */
const NO_ITEMS_JSON = { newPersons: [], handles: [], relations: [], claims: [], events: [], dates: [] }

const OK_JSON = {
  newPersons: [],
  handles: [],
  relations: [],
  claims: [
    { person: { personId: 2 }, statement: '搬到了重庆', category: 'location', validFrom: '2026-05', confidence: 0.9, sensitive: false, evidence: [2] },
    { person: { personId: 2 }, statement: '在一家设计公司上班', category: 'work', confidence: 0.85, sensitive: false, evidence: [2] },
  ],
  events: [],
  dates: [],
}

export const SCENARIOS: Scenario[] = [
  { name: 'ok', title: '回放测试·正常', body: { response: { content: JSON.stringify(OK_JSON), finishReason: 'stop', usage: { inputTokens: 1800, outputTokens: 120, cacheHitTokens: 0 }, latencyMs: 2100 }, error: null } },
  { name: 'invalid-json', title: '回放测试·坏JSON', body: { response: { content: '{"newPersons": [], "claims": [{"person": ', finishReason: 'stop', usage: { inputTokens: 1800, outputTokens: 12, cacheHitTokens: 0 }, latencyMs: 900 }, error: null } },
  { name: 'truncated', title: '回放测试·截断', body: { response: { content: '{"newPersons": [], "claims": [{"person": {"personId": 2}, "statement": "搬到', finishReason: 'length', usage: { inputTokens: 1800, outputTokens: 8192, cacheHitTokens: 0 }, latencyMs: 19000 }, error: null } },
  { name: 'timeout', title: '回放测试·超时', body: { response: null, error: { code: 'timeout', message: 'request timed out', latencyMs: 20000 } } },
  { name: 'validation', title: '回放测试·结构错误', body: { response: { content: '{"people": [], "facts": ["搬到了重庆"]}', finishReason: 'stop', usage: { inputTokens: 1800, outputTokens: 20, cacheHitTokens: 0 }, latencyMs: 800 }, error: null } },
  { name: 'empty', title: '回放测试·空内容', body: { response: { content: '', finishReason: 'stop', usage: { inputTokens: 1800, outputTokens: 0, cacheHitTokens: 0 }, latencyMs: 700 }, error: null } },
  {
    name: 'interaction',
    title: '回放测试·交互层',
    lines: QUOTE_PROMISE,
    body: answer(NO_ITEMS_JSON, 20, 900),
    interactionBody: answer(INTERACTION_JSON, 140, 1500),
  },
  {
    name: 'interaction-failed',
    title: '回放测试·交互层失败',
    lines: QUOTE_PROMISE,
    body: answer({ ...NO_ITEMS_JSON, claims: [{ person: { personId: 2 }, statement: '做定制柜子', category: 'work', confidence: 0.9, sensitive: false, evidence: [2] }] }, 40, 1100),
    // the interaction call times out; the window is still `done` and the claim above still lands (§6 failure isolation)
    interactionBody: { response: null, error: { code: 'timeout', message: 'request timed out', latencyMs: 20000 } },
  },
]

export const scenarioChat = (s: Scenario) => ({ parsed: parsedChat(s.lines ?? ONE_WINDOW), mapping: mappingFor(s.title, 'private', { 山野: 'me', 阿明: 'ming' }, 'me') })

/**
 * The two requests `extractOffline` sends for a scenario (captured with a throwing client, no network). Both calls go
 * out in one `Promise.all`, so both are captured in a single pass; they are told apart by prompt version, never by
 * arrival order.
 */
export async function scenarioRequests(s: Scenario): Promise<{ extract: LlmJsonRequest; interaction: LlmJsonRequest }> {
  const captured: LlmJsonRequest[] = []
  const capture: LlmClient = {
    async completeJson(req) {
      captured.push(req)
      return { ok: false, code: 'cassette_miss', message: 'capture', raw: null, retryable: false, latencyMs: 0 }
    },
  }
  const { parsed, mapping } = scenarioChat(s)
  await extractOffline({ parsed, mapping, llm: capture, promptVersion: versionOf(s), deadlinePolicy: 'none' })
  const extract = captured.find((r) => r.promptVersion === versionOf(s))
  const interaction = captured.find((r) => r.promptVersion === INTERACTION_PROMPT_VERSION)
  if (!extract || !interaction) throw new Error(`scenario ${s.name}: expected both requests, got ${captured.map((r) => r.promptVersion).join(', ')}`)
  return { extract, interaction }
}

function cassetteOf(req: LlmJsonRequest, body: Body): Cassette {
  return {
    key: cassetteKey(req, 'disabled'),
    recordedAt: '2026-09-15T00:00:00.000Z',
    model: req.model,
    promptVersion: req.promptVersion,
    purpose: req.purpose,
    request: { messages: req.messages, maxTokens: req.maxTokens, temperature: req.temperature ?? 0, thinking: 'disabled' },
    ...body,
  } as Cassette
}

/** One cassette per call: the extraction one under `<promptVersion>/`, the interaction one under `interaction.vN/`. */
export async function buildCassettes(s: Scenario): Promise<Cassette[]> {
  const { extract, interaction } = await scenarioRequests(s)
  return [cassetteOf(extract, s.body), cassetteOf(interaction, s.interactionBody ?? EMPTY_INTERACTION)]
}
