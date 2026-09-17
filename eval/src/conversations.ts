// Conversation grouping and matching for the interaction metrics (ARCHITECTURE §7.3 conversations, §7.4).
// Fully deterministic: no LLM. The grouping itself is NOT reimplemented here — it is `groupSegments` from
// `@/server/interaction`, the same function the product groups conversations with (§1.17, §7.3). A harness that
// grouped its own way would be measuring a grouping nobody ships.
import { groupSegments } from '@/server/interaction'
import type { GoldConversation } from './gold-schema'
import { normKey } from './text'

/** What the harness needs from one of the run's segments (a subset of extract's `OfflineItems['segments']`). */
export interface RunSegment {
  startIdx: number
  endIdx: number
  startedAt: string
  endedAt: string
  messageCount: number
  summary: string
  topics: string[]
}

export interface PredConversation {
  startIdx: number
  endIdx: number
  /** indexes into the segment list this conversation was grouped from */
  segments: number[]
  /** every summary of the grouped segments, joined */
  summary: string
  topics: string[]
}

/** The one chat of an offline run; `groupSegments` groups per chat and eval scores one export at a time. */
const OFFLINE_CHAT_ID = 1

/**
 * Groups one run's segments into conversations with the product's own `groupSegments` (3 h boundary from
 * `SESSION_GAP_HOURS`). Segments whose span is not inside the export are dropped first: they are already counted
 * by `segmentInvalidEvidence` and must not be able to stretch a conversation over a corrupt index.
 */
export function groupRunSegments(segments: RunSegment[], messages: { sentAt: string }[]): PredConversation[] {
  const usable = segments
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => Number.isInteger(s.startIdx) && Number.isInteger(s.endIdx) && s.startIdx >= 0 && s.endIdx >= s.startIdx && s.endIdx < messages.length)
    .map(({ s, i }) => ({
      chatId: OFFLINE_CHAT_ID,
      startSeq: s.startIdx,
      endSeq: s.endIdx,
      // the run carries its own MsgTime for the span; fall back to the messages when a build does not
      startedAt: s.startedAt || messages[s.startIdx].sentAt,
      endedAt: s.endedAt || messages[s.endIdx].sentAt,
      messageCount: s.messageCount || s.endIdx - s.startIdx + 1,
      index: i,
      summary: s.summary,
      topics: s.topics,
    }))
  return groupSegments(usable).map((g) => {
    const topics: string[] = []
    for (const s of g.segments) for (const t of s.topics) if (!topics.includes(t)) topics.push(t)
    return {
      startIdx: Math.min(...g.segments.map((s) => s.startSeq)),
      endIdx: Math.max(...g.segments.map((s) => s.endSeq)),
      segments: g.segments.map((s) => s.index),
      summary: g.segments.map((s) => s.summary).filter(Boolean).join(' '),
      topics,
    }
  })
}

/** Length of the overlap of two inclusive idx spans. */
export function spanOverlap(a: { startIdx: number; endIdx: number }, b: { startIdx: number; endIdx: number }): number {
  return Math.max(0, Math.min(a.endIdx, b.endIdx) - Math.max(a.startIdx, b.startIdx) + 1)
}

export const CONVERSATION_OVERLAP = 0.5

/** Fraction of the gold span covered by the prediction; ≥ CONVERSATION_OVERLAP is a match (§7.3). */
export function goldOverlapRatio(gold: GoldConversation, pred: { startIdx: number; endIdx: number }): number {
  const len = gold.endIdx - gold.startIdx + 1
  return len <= 0 ? 0 : spanOverlap(gold, pred) / len
}

/** Fraction of the gold topics that appear (normalized substring) in the prediction's summary + topics. */
export function topicCoverage(topics: string[], pred: { summary: string; topics: string[] }): number {
  if (!topics.length) return 1
  const hay = normKey([pred.summary, ...pred.topics].join(' '))
  const hit = topics.filter((t) => {
    const n = normKey(t)
    return n.length > 0 && hay.includes(n)
  })
  return hit.length / topics.length
}

export interface ConversationMatch {
  goldId: string
  optional: boolean
  pred: number
  overlap: number
  topicCoverage: number
  missingTopics: string[]
}
export interface ConversationScore {
  matches: ConversationMatch[]
  /** gold conversations (non-optional) with no matching prediction */
  missed: { goldId: string; bestOverlap: number }[]
  predicted: number
}

/** One-to-one greedy: gold in file order takes the prediction with the largest overlap ≥ 50 % of the gold span. */
export function matchConversations(gold: GoldConversation[], pred: PredConversation[]): ConversationScore {
  const taken = new Set<number>()
  const matches: ConversationMatch[] = []
  const missed: { goldId: string; bestOverlap: number }[] = []
  for (const g of gold) {
    let best: { i: number; ratio: number } | null = null
    let bestAny = 0
    for (let i = 0; i < pred.length; i++) {
      const ratio = goldOverlapRatio(g, pred[i])
      if (ratio > bestAny) bestAny = ratio
      if (taken.has(i) || ratio < CONVERSATION_OVERLAP) continue
      if (!best || ratio > best.ratio) best = { i, ratio }
    }
    if (best) {
      taken.add(best.i)
      const p = pred[best.i]
      matches.push({
        goldId: g.id,
        optional: !!g.optional,
        pred: best.i,
        overlap: best.ratio,
        topicCoverage: topicCoverage(g.topics, p),
        missingTopics: g.topics.filter((t) => topicCoverage([t], p) === 0),
      })
    } else if (!g.optional) missed.push({ goldId: g.id, bestOverlap: bestAny })
  }
  return { matches, missed, predicted: pred.length }
}
