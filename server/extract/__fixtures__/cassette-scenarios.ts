// Hand-written failure cassettes (ARCHITECTURE §5 "Cassettes", §10 F1). The responses below are written by hand; the
// request part and key are computed from the real prompt rendering so replay hits them. Regenerate after a rendering
// change: node --import tsx server/extract/__fixtures__/build-cassettes.ts (cassettes.test.ts fails when stale).
import type { Cassette, LlmClient, LlmJsonRequest } from '@/server/llm'
import { cassetteKey } from '@/server/llm'
import { extractOffline } from '../offline'
import { mappingFor, ONE_WINDOW, parsedChat } from './chats'

export const FIXTURE_PROMPT_VERSION = 'extract.v1'
export const CASSETTE_DIR = 'server/extract/__fixtures__/cassettes'

type Body = { response: NonNullable<Cassette['response']>; error: null } | { response: null; error: NonNullable<Cassette['error']> }

export interface Scenario {
  name: string
  title: string
  body: Body
}

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
]

export const scenarioChat = (s: Scenario) => ({ parsed: parsedChat(ONE_WINDOW), mapping: mappingFor(s.title, 'private', { 山野: 'me', 阿明: 'ming' }, 'me') })

/** The exact extract request extractOffline sends for a scenario (captured with a throwing client, no network). */
export async function scenarioRequest(s: Scenario): Promise<LlmJsonRequest> {
  let captured: LlmJsonRequest | null = null
  const capture: LlmClient = {
    async completeJson(req) {
      captured ??= req
      return { ok: false, code: 'cassette_miss', message: 'capture', raw: null, retryable: false, latencyMs: 0 }
    },
  }
  const { parsed, mapping } = scenarioChat(s)
  await extractOffline({ parsed, mapping, llm: capture, promptVersion: FIXTURE_PROMPT_VERSION, deadlinePolicy: 'none' })
  if (!captured) throw new Error(`scenario ${s.name}: no request captured`)
  return captured
}

export async function buildCassette(s: Scenario): Promise<Cassette> {
  const req = await scenarioRequest(s)
  return {
    key: cassetteKey(req, 'disabled'),
    recordedAt: '2026-09-15T00:00:00.000Z',
    model: req.model,
    promptVersion: req.promptVersion,
    purpose: req.purpose,
    request: { messages: req.messages, maxTokens: req.maxTokens, temperature: req.temperature ?? 0, thinking: 'disabled' },
    ...s.body,
  } as Cassette
}
