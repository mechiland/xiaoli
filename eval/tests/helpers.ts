// Test helpers for eval-synthetic: a stand-in parser built on the minimal §6 splitter, tiny ZIP/gold/prediction
// builders. Synthetic data only.
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { ParsedExport } from '@/contracts'
import { splitExportText } from '../../scripts/synthetic/split'
import type { OfflineExtractionResult, ParserApi } from '../src/entries'
import type { GoldFile } from '../src/gold-schema'

export const tempRoot = () => mkdtempSync(path.join(os.tmpdir(), 'xiaoli-eval-'))

export function sha256(s: string | Uint8Array): string {
  return createHash('sha256').update(s).digest('hex')
}

export function fnv64(s: string): string {
  let h = 0xcbf29ce484222325n
  for (const b of new TextEncoder().encode(s)) h = BigInt.asUintN(64, (h ^ BigInt(b)) * 0x100000001b3n)
  return h.toString(16).padStart(16, '0')
}

/** Stand-in for lib/wechat-export in unit tests (kinds are not classified). */
export const fakeParser: ParserApi = {
  PARSER_VERSION: 'fake-parser-1',
  async parseExportZip(zip, opts) {
    const bytes = zip instanceof Uint8Array ? zip : new Uint8Array(zip)
    const files = unzipSync(bytes)
    const txt = files['聊天记录.txt']
    if (!txt) throw Object.assign(new Error('no txt'), { code: 'no_txt' })
    const split = splitExportText(strFromU8(txt))
    const messages = split.map((m) => ({ idx: m.idx, senderName: m.senderName, sentAt: m.sentAt, kind: 'text' as const, body: m.body, meta: null, fingerprint: fnv64(`${m.senderName}${m.sentAt}text${m.body}`), attachmentName: null }))
    const senders = new Map<string, number>()
    for (const m of messages) senders.set(m.senderName, (senders.get(m.senderName) ?? 0) + 1)
    const parsed: ParsedExport = {
      formatVersion: 1,
      parserVersion: 'fake-parser-1',
      fileName: opts?.fileName ?? 'x.zip',
      exportedAt: null,
      sha256: sha256(bytes),
      messages,
      senders: [...senders].map(([name, count]) => ({ name, count })),
      media: [],
      dateFrom: messages[0]?.sentAt ?? null,
      dateTo: messages[messages.length - 1]?.sentAt ?? null,
      warnings: [],
    }
    return parsed
  },
  async messagesDigest(msgs) {
    return sha256(msgs.map((m) => `${m.senderName}\t${m.sentAt}\t${m.body}`).join('\n'))
  },
  fingerprint: (m) => fnv64(`${m.senderName}${m.sentAt}${m.kind}${m.body}`),
}

export type RawMsg = [sender: string, sentAt: string, body: string]

export function makeTxt(lines: RawMsg[]): string {
  return lines.map(([s, t, b]) => {
    const [d, hm] = t.split(' ')
    const [y, mo, da] = d.split('-')
    return `·${s}\n${y}年${mo}月${da}日 ${hm}\n${b}\n\n`
  }).join('')
}

export function makeZip(lines: RawMsg[]): Uint8Array {
  return zipSync({ '聊天记录.txt': [strToU8(makeTxt(lines)), { mtime: new Date(2026, 0, 1) }] })
}

export const SENDERS = ['小满', '阿青', '老周'] as const

export function rawMessages(n: number): RawMsg[] {
  return Array.from({ length: n }, (_, i) => [SENDERS[i % 3], `2026-09-01 10:${String(i % 60).padStart(2, '0')}`, `消息${i}`])
}

export function scoreMessages(n: number) {
  return rawMessages(n).map(([senderName, sentAt, body], idx) => ({ idx, senderName, sentAt, body }))
}

export function baseGold(over: Partial<GoldFile> = {}): GoldFile {
  return {
    goldVersion: 1,
    zip: 'mini.zip',
    annotator: 'annotator',
    annotatedAt: '2026-09-15T00:00:00.000Z',
    parserVersion: 'fake-parser-1',
    messageCount: 20,
    messagesSha256: '0'.repeat(64),
    anchors: [],
    mapping: {
      chat: { title: '测试群', kind: 'group' },
      senders: [
        { senderName: '小满', person: 'me' },
        { senderName: '阿青', person: 'a' },
        { senderName: '老周', person: 'b' },
      ],
      self: 'me',
    },
    persons: [
      { key: 'me', label: '小满', inChat: true },
      { key: 'a', label: '阿青', aliases: ['青姐'], inChat: true },
      { key: 'b', label: '老周', inChat: true },
    ],
    handles: [],
    relations: [],
    claims: [],
    dates: [],
    events: [],
    negatives: [],
    sensitiveValues: [],
    ...over,
  }
}

export function basePred(over: Partial<OfflineExtractionResult> = {}): OfflineExtractionResult {
  return {
    persons: [
      { key: 'me', label: '小满', isSelf: true },
      { key: 'a', label: '阿青', isSelf: false },
      { key: 'b', label: '老周', isSelf: false },
    ],
    handles: [],
    relations: [],
    claims: [],
    events: [],
    dates: [],
    segments: [],
    loops: [],
    closes: [],
    windows: [{ index: 0, startIdx: 0, endIdx: 19, outcome: 'done', attempts: 1, attemptMs: [100], latencyMs: 100, rawItemCount: 0, droppedInvalidEvidence: 0, rawOutputs: [] }],
    deadlinePolicy: 'app',
    usage: { inputTokens: 1000, outputTokens: 200, calls: 1 },
    promptVersion: 'extract.v1',
    model: 'deepseek-flash',
    ...over,
  }
}

/**
 * Builders for extract's real interaction shape (`OfflineItems` in server/extract/memory-store.ts). The field names
 * here are extract's, not the harness's — `eval/tests/offline-contract.test.ts` pins them against the real module.
 */
export const loop = (
  person: string,
  kind: 'promise' | 'question' | 'plan',
  direction: 'mine' | 'theirs' | 'mutual',
  text: string,
  evidence: number[],
  windowIndex = 0,
  close?: { idx: number; reason?: 'done' | 'dropped' },
): OfflineExtractionResult['loops'][number] => ({
  person,
  kind,
  direction,
  text,
  openedAt: '2026-09-01 09:00',
  openedIdx: evidence[0],
  closedIdx: close ? close.idx : null,
  closedAt: close ? '2026-09-01 20:00' : null,
  closedReason: close ? close.reason ?? 'done' : null,
  evidence,
  windowIndex,
})

export const segment = (
  startIdx: number,
  endIdx: number,
  summary: string,
  topics: string[],
  evidence: number[],
  windowIndex = 0,
  /** the run's own MsgTime span; omitted = the harness falls back to the messages */
  times?: [string, string],
): OfflineExtractionResult['segments'][number] => ({
  startIdx,
  endIdx,
  startedAt: times?.[0] ?? '',
  endedAt: times?.[1] ?? '',
  messageCount: endIdx - startIdx + 1,
  summary,
  topics,
  participants: [],
  evidence,
  windowIndex,
})

export const close = (loopIndex: number, evidence: number[], windowIndex = 0, reason: 'done' | 'dropped' = 'done'): OfflineExtractionResult['closes'][number] => ({
  loopIndex,
  reason,
  evidence,
  windowIndex,
})

export const claim = (person: string, statement: string, category: OfflineExtractionResult['claims'][number]['category'], evidence: number[], windowIndex = 0): OfflineExtractionResult['claims'][number] => ({ person, statement, category, confidence: 0.9, sensitive: false, evidence, windowIndex })
