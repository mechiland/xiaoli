// Shared helpers for import-result scenarios (synthetic seed data only).
import type { Page, Route } from 'playwright'
import type { ImportDetailResponse, ImportReviewResponse, ReviewItem } from '@/contracts'
import type { ScenarioContext } from '~/verify/lib'

export type Review = ImportReviewResponse
export type Detail = ImportDetailResponse
type Section = Review['sections'][number]
const GROUPS = ['newClaims', 'changes', 'aliasesAndRelations', 'dates', 'events', 'loops'] as const

export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T
export const itemsOf = (s: Section): ReviewItem[] => GROUPS.flatMap((g) => s[g])

/**
 * Safety net: a page of a seed import in `extracting` would call the live LLM through jobs/next.
 * Any jobs/next or jobs/retry that no specific stub handles gets a harmless "nothing to do" answer.
 * Installed first, so later (more specific) routes win. Re-install after `helpers.clearRoutes()`.
 */
export async function guardJobs(page: Page): Promise<void> {
  await page.route(/\/api\/imports\/\d+\/jobs\/(next|retry)$/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        route.request().url().endsWith('/retry')
          ? { reset: 0, progress: { total: 0, done: 0, failed: 0, pending: 0, running: 0 } }
          : { processed: null, progress: { total: 0, done: 0, failed: 0, pending: 0, running: 0 }, importStatus: 'reviewing' },
      ),
    }),
  )
}

export const reviewUrl = (id: number) => new RegExp(`/api/imports/${id}/review$`)
export const detailUrl = (id: number) => new RegExp(`/api/imports/${id}$`)

export async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  try {
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  } catch {
    // page navigated away while the stub was waiting
  }
}

/** A compact review with every group: the new person, sections with 变化, one plain section. */
export function compactReview(full: Review): Review {
  const r = clone(full)
  const picked: Section[] = []
  const add = (s: Section | undefined) => s && !picked.includes(s) && picked.push(s)
  add(r.sections.find((s) => s.person.isNew && s.dates.length && s.aliasesAndRelations.length))
  for (const s of r.sections.filter((x) => x.changes.length && x.aliasesAndRelations.length).slice(0, 1)) add(s)
  for (const s of r.sections.filter((x) => x.changes.length).slice(0, 2)) add(s)
  add(r.sections.find((s) => !s.person.isNew && !s.changes.length && s.newClaims.length >= 3))
  r.sections = picked
  const ids = new Set(picked.flatMap((s) => itemsOf(s).filter((i) => i.type === 'claim').map((i) => i.item.id)))
  r.highConfidence = r.highConfidence.filter((h) => ids.has(h.id))
  r.highConfidenceCount = r.highConfidence.length
  r.allHandled = false
  r.empty = false
  return r
}

export function allHandledReview(r0: Review): Review {
  const r = clone(r0)
  let n = 0
  for (const s of r.sections) {
    for (const it of itemsOf(s)) {
      const reject = ++n % 5 === 0
      it.item.status = reject ? 'rejected' : 'confirmed'
      if (it.type === 'claim' && it.replaces && !reject) it.replaces.status = 'superseded'
    }
  }
  r.highConfidence = []
  r.highConfidenceCount = 0
  r.allHandled = true
  return r
}

/** Long label, long statements, long alias — the page must wrap Chinese text without overflow. */
export function longContentReview(r0: Review, longLabel: string): Review {
  const r = clone(r0)
  const s = r.sections.find((x) => !x.person.isNew) ?? r.sections[0]
  s.person.label = longLabel
  const claim = s.newClaims.find((i) => i.type === 'claim')
  if (claim && claim.type === 'claim')
    claim.item.statement =
      '在杭州一家做独立动画的小工作室里负责制片和对外合作，平时要同时盯三四个项目的排期、预算和外包进度，周末还会去朋友开的陶艺教室代课，教小朋友拉坯和上釉，说这是一周里最放松的时候'
  const change = s.changes.find((i) => i.type === 'claim')
  if (change && change.type === 'claim' && change.replaces) {
    change.replaces.statement = '住在西安高新区，离公司骑车十分钟，周末常去大唐不夜城附近的书店'
    change.item.statement = '已经搬到杭州滨江区，和两个大学同学合租一套三居室，通勤要坐四十分钟地铁'
  }
  const handle = r.sections.flatMap((x) => x.aliasesAndRelations).find((i) => i.type === 'handle')
  if (handle && handle.type === 'handle') handle.item.value = '大学室友阿宁（杭州独立设计工作室合伙人）'
  return r
}

/** Temporarily make the sticky top bar static so element shots are not covered by it. */
export async function elementShot(ctx: ScenarioContext, name: string, selector: string, opts: { settleMs?: number } = {}): Promise<void> {
  const { page, shot } = ctx
  const set = (on: boolean) =>
    page.evaluate((flag) => {
      const bar = document.querySelector<HTMLElement>('header.sticky')
      if (bar) bar.style.position = flag ? 'static' : ''
    }, on)
  await set(true)
  await page.locator(selector).first().scrollIntoViewIfNeeded()
  try {
    await shot(name, { selector, fullPage: false, ...opts })
  } finally {
    await set(false)
  }
}

// ---- 未结事项 / 这次聊了什么 (wave 5) ------------------------------------------------------------------------------
// The seed does not carry interaction data yet (extract writes loops and segments, the seed imports predate it), so
// these fixtures are injected into the stubbed review / interaction answers. The page, its components and the route
// shapes are the real ones.

export const interactionUrl = (id: number) => new RegExp(`/api/imports/${id}/interaction$`)
export const loopEvidenceUrl = /\/api\/evidence\/loop\/\d+$/

type LoopItem = Extract<ReviewItem, { type: 'loop' }>
type Loop = LoopItem['item']

export function loopItem(id: number, personId: number, over: Partial<Loop> = {}): LoopItem {
  return {
    type: 'loop',
    item: {
      id,
      personId,
      direction: 'mine',
      kind: 'promise',
      text: '帮她看简历',
      dueAt: null,
      openedAt: '2026-09-13 21:04',
      openedMessageId: null,
      closedAt: null,
      closedMessageId: null,
      closedReason: null,
      state: 'open',
      expired: false,
      daysOpen: 3,
      status: 'proposed',
      importId: null,
      sourceKind: 'ai',
      evidenceCount: 1,
      createdAt: '2026-09-15T00:00:00.000Z',
      ...over,
    },
  }
}

/** Loops in every state: the first section gets the three proposed kinds, the second the three handled ones. */
export function withLoops(r0: Review): Review {
  const r = clone(r0)
  const a = r.sections[0]
  const b = r.sections[1] ?? r.sections[0]
  if (a) {
    a.loops = [
      loopItem(990_401, a.person.id, { kind: 'promise', direction: 'mine', text: '帮她看简历' }),
      loopItem(990_402, a.person.id, { kind: 'question', direction: 'mine', text: '国庆有没有空', openedAt: '2026-09-14 10:12' }),
      loopItem(990_403, a.person.id, { kind: 'plan', direction: 'mutual', text: '下个月去成都', dueAt: '2026-10-04', openedAt: '2026-09-15 19:30' }),
    ]
  }
  if (b) {
    b.loops = [
      loopItem(990_411, b.person.id, { kind: 'promise', direction: 'theirs', text: '把装修合同发过来', status: 'confirmed', openedAt: '2026-09-11 08:40' }),
      loopItem(990_412, b.person.id, { kind: 'question', direction: 'theirs', text: '周六几点出发', status: 'rejected', openedAt: '2026-09-12 12:02' }),
      loopItem(990_413, b.person.id, {
        kind: 'promise',
        direction: 'mine',
        text: '把露营装备清单发过去',
        status: 'confirmed',
        state: 'done',
        closedReason: 'done',
        closedAt: '2026-09-15T02:00:00.000Z',
        closedMessageId: 4321,
        openedAt: '2026-09-10 21:15',
      }),
    ]
  }
  for (const s of r.sections) s.newCount = itemsOf(s).length
  return r
}

/** The answer of `POST /api/loops/:id/close`: closing is also confirming (DECISIONS I4). */
export function closedLoopBody(it: LoopItem): { loop: Loop } {
  return { loop: { ...clone(it.item), status: 'confirmed', state: 'done', closedReason: 'done', closedAt: '2026-09-16T02:00:00.000Z' } }
}

/** 「这次聊了什么」: this import's conversations, the shape `GET /api/imports/:id/interaction` returns. */
export function importConversations(chatId: number, chatTitle: string): { conversations: unknown[] } {
  const segment = (id: number, startedAt: string, endedAt: string, summary: string, topics: string[], messageCount: number) => ({
    id,
    chatId,
    chatTitle,
    startSeq: id * 10,
    endSeq: id * 10 + messageCount,
    startedAt,
    endedAt,
    messageCount,
    summary,
    topics,
    hidden: false,
    firstMessageId: null,
    participants: [],
    importId: null,
    sourceKind: 'ai',
    createdAt: '2026-09-15T00:00:00.000Z',
  })
  return {
    conversations: [
      {
        chatId,
        chatTitle,
        chatKind: 'group',
        startedAt: '2026-09-13 20:31',
        endedAt: '2026-09-13 22:48',
        messageCount: 42,
        topics: ['搬家', '孩子择校'],
        firstMessageId: null,
        segments: [
          segment(9_001, '2026-09-13 20:31', '2026-09-13 21:20', '聊了下个月搬家的日子，谁来搬、要不要请假', ['搬家'], 24),
          segment(9_002, '2026-09-13 21:40', '2026-09-13 22:48', '说到孩子明年上小学，两个人都在打听对口的学校', ['孩子择校'], 18),
        ],
      },
      {
        chatId,
        chatTitle,
        chatKind: 'group',
        startedAt: '2026-09-11 08:40',
        endedAt: '2026-09-11 09:05',
        messageCount: 11,
        topics: ['装修'],
        firstMessageId: null,
        segments: [segment(9_003, '2026-09-11 08:40', '2026-09-11 09:05', '对了一下装修合同里的几处报价', ['装修'], 11)],
      },
    ],
  }
}

/**
 * The interaction endpoints the page now touches, answered deterministically: the seed has no segments or loops yet
 * and `GET /api/imports/:id/interaction` is being written in parallel. Installed next to `guardJobs`, so no
 * screenshot depends on whether that route is a 501 stub at the moment.
 */
export async function guardInteraction(page: Page, body: unknown = { conversations: [] }, evidence?: unknown): Promise<void> {
  await page.route(/\/api\/imports\/\d+\/interaction$/, (route: Route) => fulfillJson(route, body))
  if (evidence) await page.route(loopEvidenceUrl, (route: Route) => fulfillJson(route, evidence))
}
