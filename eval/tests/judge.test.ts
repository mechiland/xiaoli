// LLM judge: cache, replay fallback, output sanitation, chunking, request shape. No network: a scripted LlmClient.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LlmClient, LlmJsonRequest } from '../src/entries'
import { fallbackMatch, JudgeCache, judgeCacheKey, llmJudge, loadJudgePrompt, MATCH_CHUNK, sanitizeFp, sanitizeMatch, type FpClassifyInput, type MatchInput } from '../src/judge'
import { evalPaths, REPO_ROOT } from '../src/paths'
import { bigramJaccard } from '../src/text'
import { tempRoot } from './helpers'

const promptsDir = evalPaths(REPO_ROOT).judgePrompts

function scriptedLlm(reply: (req: LlmJsonRequest) => unknown): LlmClient & { requests: LlmJsonRequest[] } {
  const requests: LlmJsonRequest[] = []
  return {
    requests,
    async completeJson(req) {
      requests.push(req)
      const json = reply(req)
      if (json instanceof Error) return { ok: false, code: 'http_5xx', message: json.message, raw: null, retryable: true, latencyMs: 5 }
      return { ok: true, json, raw: JSON.stringify(json), usage: { inputTokens: 1200, outputTokens: 80, cacheHitTokens: 0 }, latencyMs: 5, model: 'deepseek-flash', finishReason: 'stop', fromCassette: false }
    },
  }
}

const matchInput: MatchInput = {
  person: { key: 'a', label: '阿青' },
  gold: [
    { id: 'c1', statement: '在云杉医院当护士', category: 'work' },
    { id: 'c2', statement: '住在青禾区', category: 'location' },
  ],
  pred: [
    { index: 0, statement: '在云杉医院做护士', category: 'work' },
    { index: 3, statement: '喜欢爬山', category: 'preference' },
  ],
}

describe('prompts', () => {
  it('both judge prompts load, carry versions, and mention json with an example', () => {
    for (const f of ['judge-match.v1.md', 'judge-fp.v1.md']) {
      const p = loadJudgePrompt(path.join(promptsDir, f))
      expect(p.version).toBe(f.replace(/\.md$/, ''))
      expect(`${p.system}${p.userTemplate}`.toLowerCase()).toContain('json')
      expect(() => JSON.parse(p.exampleJson)).not.toThrow()
      expect(p.userTemplate).toContain('{{input}}')
    }
  })
})

describe('llmJudge', () => {
  it('record mode: calls the LLM once with judge settings, caches, then hits the cache', async () => {
    const dir = path.join(tempRoot(), 'cache')
    const llm = scriptedLlm(() => ({ matches: [{ pred: 0, gold: 'c1', verdict: 'same' }, { pred: 3, gold: null, verdict: 'different' }] }))
    const judge = llmJudge({ llm, cache: new JudgeCache(dir), mode: 'record', promptsDir, evalRunId: 'run-1' })
    const out1 = await judge.matchClaims(matchInput)
    const out2 = await judge.matchClaims(matchInput)
    expect(out1).toEqual(out2)
    expect(out1.matches).toEqual([{ pred: 0, gold: 'c1', verdict: 'same' }, { pred: 3, gold: null, verdict: 'different' }])
    expect(llm.requests).toHaveLength(1)
    expect(llm.requests[0]).toMatchObject({ purpose: 'judge', promptVersion: 'judge-match.v1', model: 'deepseek-flash', maxTokens: 1024, temperature: 0, context: { evalRunId: 'run-1' } })
    expect(llm.requests[0].messages[0].content).toContain('json')
    expect(judge.stats()).toMatchObject({ calls: 1, cacheHits: 1, fallbacks: 0, inputTokens: 1200, outputTokens: 80 })
    expect(new JudgeCache(dir).get(judgeCacheKey('judge-match.v1', matchInput))).toBeDefined()
  })

  it('replay mode never calls the LLM; cache miss → bigram fallback and fallback counted', async () => {
    const llm = scriptedLlm(() => {
      throw new Error('must not be called')
    })
    const judge = llmJudge({ llm, cache: new JudgeCache(path.join(tempRoot(), 'c')), mode: 'replay', promptsDir })
    const out = await judge.matchClaims(matchInput)
    expect(llm.requests).toHaveLength(0)
    expect(out.matches).toEqual([{ pred: 0, gold: 'c1', verdict: 'same' }, { pred: 3, gold: null, verdict: 'different' }])
    const fp = await judge.classifyFps({ zip: 'z', persons: [], goldClaims: [], negatives: [], items: [{ fpId: 'claims#1', type: 'claim', person: 'a', text: 'x', evidenceWindow: [] }] })
    expect(fp.labels[0]).toMatchObject({ label: 'other' })
    expect(judge.stats().fallbacks).toBe(2)
  })

  it('replay mode with a cached verdict uses it without fallback', async () => {
    const dir = path.join(tempRoot(), 'c')
    const cache = new JudgeCache(dir)
    cache.put(judgeCacheKey('judge-match.v1', matchInput), 'judge-match.v1', 'deepseek-flash', { matches: [{ pred: 0, gold: 'c2', verdict: 'less_specific' }, { pred: 3, gold: null, verdict: 'different' }] })
    const judge = llmJudge({ llm: null, cache, mode: 'replay', promptsDir })
    expect((await judge.matchClaims(matchInput)).matches[0]).toEqual({ pred: 0, gold: 'c2', verdict: 'less_specific' })
    expect(judge.stats()).toMatchObject({ cacheHits: 1, fallbacks: 0 })
  })

  it('LLM error or schema-invalid output → fallback, nothing cached', async () => {
    const dir = path.join(tempRoot(), 'c')
    for (const reply of [() => new Error('boom'), () => ({ matches: 'nope' })]) {
      const judge = llmJudge({ llm: scriptedLlm(reply), cache: new JudgeCache(dir), mode: 'live', promptsDir })
      await judge.matchClaims(matchInput)
      expect(judge.stats().fallbacks).toBe(1)
    }
    expect(new JudgeCache(dir).get(judgeCacheKey('judge-match.v1', matchInput))).toBeUndefined()
  })

  it(`chunks predictions by ${MATCH_CHUNK} per call and keeps every pred`, async () => {
    const llm = scriptedLlm((req) => {
      const input = JSON.parse(req.messages[1].content.split('输入（json）：\n')[1]) as MatchInput
      return { matches: input.pred.map((p) => ({ pred: p.index, gold: null, verdict: 'different' })) }
    })
    const big: MatchInput = { ...matchInput, pred: Array.from({ length: 30 }, (_, i) => ({ index: i, statement: `事实${i}`, category: 'other' as const })) }
    const judge = llmJudge({ llm, cache: new JudgeCache(path.join(tempRoot(), 'c')), mode: 'live', promptsDir })
    const out = await judge.matchClaims(big)
    expect(llm.requests).toHaveLength(3)
    expect(out.matches.map((m) => m.pred)).toEqual(big.pred.map((p) => p.index))
  })
})

describe('sanitation and fallback', () => {
  it('sanitizeMatch drops unknown gold ids and duplicate rows, fills missing preds', () => {
    const out = sanitizeMatch(matchInput, { matches: [{ pred: 0, gold: 'zzz', verdict: 'same' }, { pred: 0, gold: 'c1', verdict: 'same' }, { pred: 99, gold: 'c1', verdict: 'same' }] })
    expect(out.matches).toEqual([{ pred: 0, gold: null, verdict: 'different' }, { pred: 3, gold: null, verdict: 'different' }])
  })

  it('sanitizeFp keeps subLabel only for should_ignore and labels missing items other', () => {
    const input: FpClassifyInput = {
      zip: 'z',
      persons: [],
      goldClaims: [],
      negatives: [],
      items: [
        { fpId: 'a', type: 'claim', person: 'p', text: 't', evidenceWindow: [] },
        { fpId: 'b', type: 'claim', person: 'p', text: 't', evidenceWindow: [] },
        { fpId: 'c', type: 'claim', person: 'p', text: 't', evidenceWindow: [] },
      ],
    }
    const out = sanitizeFp(input, {
      labels: [
        { fpId: 'a', label: 'should_ignore', subLabel: 'transactional', goldId: null, negativeId: 'n1', reason: 'r' },
        { fpId: 'b', label: 'factual_error', subLabel: 'coordination', goldId: null, negativeId: null, reason: 'r' },
      ],
    })
    expect(out.labels.map((l) => [l.fpId, l.label, l.subLabel])).toEqual([['a', 'should_ignore', 'transactional'], ['b', 'factual_error', null], ['c', 'other', null]])
  })

  it('bigram Jaccard threshold behaviour', () => {
    expect(bigramJaccard('在云杉医院当护士', '在云杉医院做护士')).toBeGreaterThanOrEqual(0.5)
    expect(bigramJaccard('喜欢爬山', '住在青禾区')).toBeLessThan(0.5)
    expect(fallbackMatch(matchInput).matches[1]).toEqual({ pred: 3, gold: null, verdict: 'different' })
  })
})
