// Shared helpers for import-result scenarios (synthetic seed data only).
import type { Page, Route } from 'playwright'
import type { ImportDetailResponse, ImportReviewResponse, ReviewItem } from '@/contracts'
import type { ScenarioContext } from '@/verify/lib'

export type Review = ImportReviewResponse
export type Detail = ImportDetailResponse
type Section = Review['sections'][number]
const GROUPS = ['newClaims', 'changes', 'aliasesAndRelations', 'dates', 'events'] as const

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
