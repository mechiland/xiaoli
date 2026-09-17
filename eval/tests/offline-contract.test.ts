// The contract pin between extract's `extractOffline` and the eval harness (core request eval-synthetic #5).
//
// Why this file exists: the harness first read `segments[].speakers` and `loops[].closedByIdx`, extract emits
// `participants` and `closedIdx`. Nothing failed. The fields came back `undefined`, every interaction metric
// reported 0, and all three interaction gates passed — on nothing. A silent zero is worse than a red test, so the
// field names are pinned twice here: once at compile time (the type assignment below) and once end to end, by
// running the REAL `extractOffline` over a REAL committed fixture ZIP with a stubbed LLM and asserting the harness
// counts what came out. No live calls, no cassettes: the stub answers every request in memory.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseExportZip } from '@/lib/wechat-export'
import type { LlmJsonRequest, LlmJsonResult } from '@/server/llm'
import * as extractModule from '@/server/extract'
import { extractOffline, PROMPT_VERSION, type OfflineExtractionResult as ExtractResult } from '@/server/extract'
import type { OfflineExtractionResult as HarnessResult } from '../src/entries'
import { parseGold, type GoldFile } from '../src/gold-schema'
import { fakeJudge } from '../src/judge'
import { metricsFromCounts } from '../src/metrics'
import { evalPaths } from '../src/paths'
import { scoreZip } from '../src/score'

// ---------------------------------------------------------------- 1. compile-time pin
// If extract renames a field the harness reads, this assignment stops type-checking. It is the cheap half of the
// pin; the run below is the half that also catches a field that exists but is never filled.
const _shapePin: HarnessResult = null as unknown as ExtractResult
void _shapePin

const ZIP = '聊天记录_20260912_095501.zip'
const paths = evalPaths()
/**
 * The versions the module currently ships, never a literal: from DECISIONS I17 the interaction layer is its own
 * call with its own prompt version, and pinning `extract.v9` here would have made this file a test of a retired
 * prompt. If this file goes red after the split lands, the message is the one it exists to send — the offline
 * pipeline is not producing interaction output the harness can read.
 */
const INTERACTION_VERSION = (extractModule as { INTERACTION_PROMPT_VERSION?: string }).INTERACTION_PROMPT_VERSION ?? null

/** every localSeq the prompt actually shows, in order */
function promptSeqs(req: LlmJsonRequest): number[] {
  return [...req.messages[1].content.matchAll(/^#(\d+) /gm)].map((m) => Number(m[1]))
}
/** open-loop ids the window was shown (`- [loop 12] …`, server/extract/prompt.ts) */
function promptLoopIds(req: LlmJsonRequest): number[] {
  return [...req.messages[1].content.matchAll(/\[loop (\d+)\]/g)].map((m) => Number(m[1]))
}

const empty = { newPersons: [], handles: [], relations: [], claims: [], events: [], dates: [] }

/**
 * Answers each call with what its own schema accepts: the extraction call gets the six round-1 arrays, the
 * interaction call gets one segment, one loop and — once the window is shown an open loop — one close. Since
 * DECISIONS I17 those are two separate calls with two strict schemas, so one combined answer would now be rejected
 * by both. A build with no `INTERACTION_PROMPT_VERSION` (extract.v9 and earlier) still gets the combined answer on
 * its single call. Evidence is the middle localSeq of the window, which is never a context-only message, so nothing
 * is dropped for a reason that has nothing to do with this test.
 */
function stubLlm() {
  const calls: LlmJsonRequest[] = []
  const ok = (json: unknown): LlmJsonResult => ({ ok: true, json, raw: JSON.stringify(json), usage: { inputTokens: 100, outputTokens: 20, cacheHitTokens: 0 }, latencyMs: 1, model: 'deepseek-flash', finishReason: 'stop', fromCassette: false })
  return {
    calls,
    async completeJson(req: LlmJsonRequest) {
      calls.push(req)
      if (req.purpose === 'dedup') return ok({ duplicates: [] })
      const seqs = promptSeqs(req)
      const mid = seqs[Math.floor(seqs.length / 2)] ?? 1
      const last = seqs[seqs.length - 1] ?? mid
      const openIds = promptLoopIds(req)
      const interaction = {
        segment: { summary: `这一段在聊安排和近况（窗口 ${calls.length}）`, topics: ['安排', '近况'], speakers: [{ personId: 1 }], evidence: [mid] },
        loops: [{ person: { personId: 2 }, direction: 'theirs', kind: 'promise', text: `把窗口 ${calls.length} 的东西带过来`, evidence: [mid] }],
        closes: openIds.length ? [{ loopId: openIds[0], reason: 'done', evidence: [last] }] : [],
      }
      if (INTERACTION_VERSION === null) return ok({ ...empty, ...interaction })
      return ok(req.promptVersion === INTERACTION_VERSION ? interaction : empty)
    },
  }
}

describe('extractOffline → harness contract (no live calls, no cassettes)', async () => {
  const gold = (() => {
    const file = path.join(paths.gold.synthetic, `${ZIP}.json`)
    const parsed = parseGold(JSON.parse(readFileSync(file, 'utf8')))
    if (!parsed.ok) throw new Error(`gold for ${ZIP} does not parse: ${parsed.issues.join('; ')}`)
    return parsed.gold
  })()
  const parsed = await parseExportZip(new Uint8Array(readFileSync(path.join(paths.fixtures.synthetic, ZIP))), { fileName: ZIP })
  const llm = stubLlm()
  const result = await extractOffline({ parsed, mapping: gold.mapping, llm, model: 'deepseek-flash', promptVersion: PROMPT_VERSION, deadlinePolicy: 'none' })

  it('the run produced interaction output at all (otherwise the assertions below prove nothing)', () => {
    expect(result.windows.every((w) => w.outcome === 'done')).toBe(true)
    expect(result.segments.length).toBeGreaterThan(1)
    expect(result.loops.length).toBeGreaterThan(1)
    expect(result.closes.length).toBeGreaterThan(0)
  })

  it('PINNED field names: a rename on extract`s side fails here instead of zeroing the metrics silently', () => {
    // segments — `participants`, not `speakers`; objects with `person`, not strings
    expect(Object.keys(result.segments[0]).sort()).toEqual(
      ['endIdx', 'endedAt', 'evidence', 'messageCount', 'participants', 'startIdx', 'startedAt', 'summary', 'topics', 'windowIndex'].sort(),
    )
    const s = result.segments[0]
    expect(typeof s.startIdx === 'number' && typeof s.endIdx === 'number').toBe(true)
    expect(s.startedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(Array.isArray(s.topics) && Array.isArray(s.participants)).toBe(true)
    if (s.participants.length) expect(typeof s.participants[0].person).toBe('string')

    // loops — `openedIdx` / `closedIdx`, not `closedByIdx`
    const keys = Object.keys(result.loops[0])
    for (const k of ['person', 'direction', 'kind', 'text', 'openedAt', 'openedIdx', 'closedIdx', 'closedAt', 'closedReason', 'evidence', 'windowIndex']) {
      expect(keys, `loops[].${k} is gone — the harness reads it`).toContain(k)
    }
    expect(keys).not.toContain('closedByIdx')

    // closes — `loopIndex` into `loops`
    expect(Object.keys(result.closes[0]).sort()).toEqual(['evidence', 'loopIndex', 'reason', 'windowIndex'].sort())
    for (const c of result.closes) expect(result.loops[c.loopIndex]).toBeDefined()

    // and the close really was applied to the loop it points at
    const closed = result.loops.filter((l) => l.closedIdx !== null)
    expect(closed.length).toBeGreaterThan(0)
    for (const l of closed) expect(l.closedIdx!).toBeGreaterThan(l.openedIdx)
  })

  it('the harness counts that output: non-zero segments, conversations, loops and closes', async () => {
    // gold built from the run, so the numbers are about plumbing, not about model quality
    const goldV2: GoldFile = {
      ...gold,
      goldVersion: 2,
      loops: result.loops.slice(0, 3).map((l, i) => ({
        id: `k${i}`,
        person: l.person,
        direction: l.direction,
        kind: l.kind,
        text: l.text,
        evidence: l.evidence,
        ...(l.closedIdx !== null ? { closedBy: l.closedIdx, closedReason: l.closedReason ?? ('done' as const) } : {}),
      })),
      conversations: [{ id: 'v1', startIdx: result.segments[0].startIdx, endIdx: result.segments[0].endIdx, topics: ['安排'] }],
    }
    const judge = fakeJudge({ matches: Object.fromEntries(goldV2.loops!.map((g) => [g.text, { gold: g.id, verdict: 'same' as const }])) })
    const { counts } = await scoreZip({ zipLabel: ZIP, messages: parsed.messages, gold: goldV2, pred: result, judge })
    const m = metricsFromCounts(counts)

    expect(m.interaction.segments).toBe(result.segments.length)
    expect(m.interaction.conversationsPredicted).toBeGreaterThan(0)
    expect(m.interaction.conversationsMatched).toBe(1)
    expect(m.loops.predicted).toBe(result.loops.length)
    expect(m.loops.tpLenient).toBe(3)
    expect(m.interaction.predictedCloses).toBeGreaterThan(0)
    expect(m.interaction.goldCloses).toBeGreaterThan(0)
    expect(m.interaction.loopCloseRecall).toBe(1)
    // the pipeline's own output must be mechanically clean: these two are the gates
    expect(m.interaction.loopFalseClose).toBe(0)
    expect(m.interaction.segmentInvalidEvidence).toBe(0)
  })

  /**
   * The same real run, scored against gold that annotates none of it (DECISIONS I16). The live extract.v9 report
   * said `loops.predicted = 0` and `conversationsPredicted = 0` in exactly this situation, on a run that had
   * produced loops and segments. What must be null is the ratios; what must be true is the counts.
   */
  it('gold that annotates no loops leaves the RATIOS null and the COUNTS true (I16)', async () => {
    const { loops: _l, conversations: _c, ...v1Gold } = { ...gold, goldVersion: 1 as const } as GoldFile & { loops?: unknown; conversations?: unknown }
    const { counts } = await scoreZip({ zipLabel: ZIP, messages: parsed.messages, gold: v1Gold as GoldFile, pred: result, judge: fakeJudge({}) })
    const m = metricsFromCounts(counts)
    expect(m.loops.predicted).toBe(result.loops.length)
    expect(m.loops.predicted).toBeGreaterThan(1)
    expect(m.interaction.segments).toBe(result.segments.length)
    expect(m.interaction.conversationsPredicted).toBeGreaterThan(0)
    expect(m.interaction.predictedCloses).toBeGreaterThan(0)
    expect(m.loops.precisionLenient).toBeNull()
    expect(m.loops.recallStrict).toBeNull()
    expect(m.interaction.conversationCoverage).toBeNull()
    expect(m.loops.scored).toBe(0)
    expect(m.loops.fp).toBe(0)
  })

  it('shows the failure mode the pin exists for: one renamed field, every interaction number silently 0', async () => {
    // exactly the bug that shipped: the harness read `speakers` / `closedByIdx`, extract wrote `participants` /
    // `closedIdx`. Nothing threw. The metrics just went quiet.
    const renamed = {
      ...result,
      segments: result.segments.map(({ startIdx, ...rest }) => ({ ...rest, startIndex: startIdx })),
      loops: result.loops.map(({ closedIdx, ...rest }) => ({ ...rest, closedByIdx: closedIdx })),
    } as unknown as typeof result
    const goldV2: GoldFile = {
      ...gold,
      goldVersion: 2,
      loops: result.loops.slice(0, 1).map((l) => ({ id: 'k0', person: l.person, direction: l.direction, kind: l.kind, text: l.text, evidence: l.evidence, ...(l.closedIdx !== null ? { closedBy: l.closedIdx } : {}) })),
      conversations: [{ id: 'v1', startIdx: result.segments[0].startIdx, endIdx: result.segments[0].endIdx, topics: ['安排'] }],
    }
    const judge = fakeJudge({ matches: Object.fromEntries(goldV2.loops!.map((g) => [g.text, { gold: g.id, verdict: 'same' as const }])) })
    const { counts } = await scoreZip({ zipLabel: ZIP, messages: parsed.messages, gold: goldV2, pred: renamed, judge })
    const m = metricsFromCounts(counts)
    expect(m.interaction.conversationsPredicted).toBe(0) // every segment span is gone → nothing to group
    expect(m.interaction.conversationsMatched).toBe(0)
    expect(m.interaction.predictedCloses).toBe(0) // closes silently disappear
    expect(m.interaction.loopFalseClose).toBe(0) // …and the gate still passes, on nothing
    expect(m.interaction.segmentInvalidEvidence).toBeGreaterThan(0) // the only thing that noticed
  })

  it('the result names the interaction prompt version, and the harness buckets the real calls by it', async () => {
    const { usageBucket } = await import('../src/usage')
    const configured = (result as { interactionPromptVersion?: string }).interactionPromptVersion ?? null
    expect(configured).toBe(INTERACTION_VERSION)
    const buckets = llm.calls.map((c) => usageBucket(c, INTERACTION_VERSION))
    // extract sends the interaction call with `purpose: 'other'` (INTERACTION_PURPOSE), so the cost split cannot
    // rest on `purpose` — this is the end-to-end pin that it does not (DECISIONS I17 cost side).
    expect(buckets.filter((b) => b === 'extract').length).toBeGreaterThan(0)
    if (INTERACTION_VERSION) {
      expect(buckets.filter((b) => b === 'interaction').length).toBeGreaterThan(0)
      expect(llm.calls.filter((c) => c.promptVersion === INTERACTION_VERSION).every((c) => usageBucket(c, INTERACTION_VERSION) === 'interaction')).toBe(true)
    }
  })

  it('made no live call: every request went to the stub, on this build`s own prompt versions', () => {
    expect(llm.calls.length).toBeGreaterThan(0)
    const allowed = new Set([PROMPT_VERSION, INTERACTION_VERSION].filter((x): x is string => x !== null))
    for (const c of llm.calls) {
      if (c.purpose === 'dedup') continue
      expect(allowed, `unexpected prompt version ${c.promptVersion}`).toContain(c.promptVersion)
    }
    // the interaction call, once it exists, is a SECOND call over the same windows (DECISIONS I17)
    if (INTERACTION_VERSION) expect(llm.calls.some((c) => c.promptVersion === INTERACTION_VERSION)).toBe(true)
  })
})
