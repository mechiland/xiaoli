import type { Route } from 'playwright'
import type { ClaimDTO, ReviewItem } from '@/contracts'
import { defineScenario } from '@/verify/lib'
import { compactReview, elementShot, fulfillJson, guardJobs, itemsOf, reviewUrl, type Review } from './_support'

// Review actions on the import result page against a stateful route mock (seed account, read-only on the server):
// 确认 / 不对 / 改写 (text and date) stay in place, 变化 confirm strikes the old statement, 本节全部确认, the two-step
// high-confidence bulk, rename of a new person, "其实是……" merge, a failed save with retry, and 已全部处理.
// The real round trip (persistence after reload) is covered by `import-result/live-flow`.
export default defineScenario({
  id: 'import-result/actions',
  description: '导入结果页操作：确认、不对、改写（文字与日期）、变化确认、本节全部确认、两步批量确认、新人物改名、其实是……合并、保存失败重试、已全部处理（接口为有状态的路由模拟，不改种子数据）',
  account: 'seed',
  requiredTags: ['import:review-mixed', 'person:long-profile'],
  expectedFailures: [{ urlPattern: /\/api\/review\/claim\/\d+$/, status: 500, step: 'save fails, retry succeeds', consoleText: 'status of 500' }],
  async run(ctx) {
    const { page, step, shot, check, helpers, seed, api } = ctx
    const mixed = await seed.import('review-mixed')
    const target = await seed.person('long-profile')
    const state: Review = compactReview((await api.get<Review>(`/api/imports/${mixed.id}/review`)).json!)
    const newSection = state.sections.find((s) => s.person.isNew)!

    // ---- the mock --------------------------------------------------------------------------------------------
    const find = (type: string, id: number) => {
      for (const s of state.sections) for (const it of itemsOf(s)) if (it.type === type && it.item.id === id) return it
      return null
    }
    const accept = (it: ReviewItem): ClaimDTO[] => {
      it.item.status = 'confirmed'
      if (it.type === 'claim' && it.replaces) {
        it.replaces.status = 'superseded'
        it.replaces.statusReason = 'superseded'
        return [it.replaces]
      }
      return []
    }
    await guardJobs(page)
    await page.route(reviewUrl(mixed.id), (r: Route) => fulfillJson(r, state))
    await page.route(/\/api\/review\/bulk$/, (r: Route) => {
      const body = r.request().postDataJSON() as { items: { type: string; id: number }[] }
      for (const x of body.items) {
        const it = find(x.type, x.id)
        if (it && it.item.status === 'proposed') accept(it)
      }
      return fulfillJson(r, { updated: body.items.length, failed: [] })
    })
    await page.route(/\/api\/review\/(claim|handle|relation|date|event)\/\d+$/, (r: Route) => {
      const m = /\/api\/review\/(\w+)\/(\d+)$/.exec(r.request().url())!
      const it = find(m[1], Number(m[2]))
      if (!it) return fulfillJson(r, { error: { code: 'not_found', message: '没有找到' } }, 404)
      const body = r.request().postDataJSON() as { action: string; patch?: Record<string, unknown> }
      let superseded: ClaimDTO[] = []
      if (body.action === 'reject') it.item.status = 'rejected'
      else {
        if (body.action === 'edit' && body.patch) {
          const p = body.patch
          if (it.type === 'claim' && p.statement) it.item.statement = String(p.statement)
          if (it.type === 'handle' && p.value) it.item.value = String(p.value)
          if (it.type === 'relation' && p.label) it.item.label = String(p.label)
          if (it.type === 'event' && p.summary) it.item.summary = String(p.summary)
          if (it.type === 'date') Object.assign(it.item, { month: p.month, day: p.day, calendar: p.calendar, year: p.year ?? null, next: null })
        }
        superseded = accept(it)
      }
      return fulfillJson(r, { item: it.item, superseded })
    })
    await page.route(/\/api\/people\/\d+$/, (r: Route) => {
      if (r.request().method() !== 'PATCH') return r.fallback()
      const id = Number(/(\d+)$/.exec(r.request().url())![1])
      const { label } = r.request().postDataJSON() as { label: string }
      for (const s of state.sections) if (s.person.id === id) s.person.label = label
      return fulfillJson(r, { person: { id, label, isSelf: false, mergedIntoId: null, pinned: false, avatarUrl: null, lastMessageAt: null, createdAt: '2026-09-15T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z' } })
    })
    await page.route(/\/api\/people\/\d+\/merge$/, (r: Route) => {
      const fromId = Number(/people\/(\d+)\/merge/.exec(r.request().url())![1])
      const { intoId } = r.request().postDataJSON() as { intoId: number }
      const from = state.sections.find((s) => s.person.id === fromId)!
      state.sections = state.sections.filter((s) => s !== from)
      let into = state.sections.find((s) => s.person.id === intoId)
      if (!into) {
        into = { ...from, person: { id: intoId, label: target.label ?? '', isNew: false }, newClaims: [], changes: [], aliasesAndRelations: [], dates: [], events: [] }
        state.sections.unshift(into)
      }
      for (const g of ['newClaims', 'changes', 'aliasesAndRelations', 'dates', 'events'] as const) into[g].push(...(from[g] as never[]))
      return fulfillJson(r, { person: { id: intoId, label: target.label }, moved: { claim: from.newClaims.length, handle: 0, relation: 0, date: 0, event: 0 } })
    })

    const row = (key: string) => page.locator(`[data-review-item="${key}"]`)
    const firstOf = (type: string, sectionId: number, status = 'proposed') =>
      state.sections.find((s) => s.person.id === sectionId)!.newClaims.concat(state.sections.find((s) => s.person.id === sectionId)!.dates).find((i) => i.type === type && i.item.status === status)!

    await step('open', () => helpers.goto(`/imports/${mixed.id}`, { waitFor: '[data-review-body]' }))

    await step('确认 stays in place', async () => {
      const it = firstOf('claim', newSection.person.id)
      const key = `claim:${it.item.id}`
      const before = await page.locator('[data-review-item]').evaluateAll((els, k) => els.findIndex((e) => e.getAttribute('data-review-item') === k), key)
      await row(key).getByRole('button', { name: '确认' }).click()
      await page.locator(`[data-review-item="${key}"][data-status="confirmed"]`).waitFor()
      const after = await page.locator('[data-review-item]').evaluateAll((els, k) => els.findIndex((e) => e.getAttribute('data-review-item') === k), key)
      check('same position', before === after, { before, after })
      check('shows 已确认', ((await row(key).textContent()) ?? '').includes('已确认'))
    })

    await step('不对 strikes through', async () => {
      const it = firstOf('claim', newSection.person.id)
      const key = `claim:${it.item.id}`
      await row(key).getByRole('button', { name: '不对' }).click()
      await page.locator(`[data-review-item="${key}"][data-status="rejected"]`).waitFor()
      check('line-through', (await row(key).locator('.line-through').count()) > 0)
    })

    await step('改写 saves and confirms', async () => {
      const it = firstOf('claim', newSection.person.id)
      const key = `claim:${it.item.id}`
      await row(key).getByRole('button', { name: '改写' }).click()
      const ta = row(key).locator('textarea')
      await ta.fill('在青岛一家设计公司做产品设计')
      await ta.press('Enter')
      await page.locator(`[data-review-item="${key}"][data-status="confirmed"]`).waitFor()
      check('edited text shown', ((await row(key).textContent()) ?? '').includes('在青岛一家设计公司做产品设计'))
    })

    await step('日期 改写', async () => {
      const it = newSection.dates[0]
      const key = `date:${it.item.id}`
      await row(key).getByRole('button', { name: '改写' }).click()
      await row(key).getByLabel('月').fill('11')
      await row(key).getByLabel('日').fill('2')
      await row(key).getByRole('radio', { name: '农历' }).click()
    })
    await elementShot(ctx, 'date-editor', `[data-person-section="${newSection.person.id}"] [data-group="dates"]`)
    await step('日期 保存', async () => {
      const key = `date:${newSection.dates[0].item.id}`
      await row(key).getByRole('button', { name: '保存' }).click()
      await page.locator(`[data-review-item="${key}"][data-status="confirmed"]`).waitFor()
      check('lunar date text', ((await row(key).textContent()) ?? '').includes('农历冬月初二'))
    })

    await step('save fails, retry succeeds', async () => {
      const it = firstOf('claim', newSection.person.id)
      const key = `claim:${it.item.id}`
      const url = new RegExp(`/api/review/claim/${it.item.id}$`)
      const failOnce = (r: Route) => fulfillJson(r, { error: { code: 'internal', message: '服务器出错了' } }, 500)
      await page.route(url, failOnce)
      await row(key).getByRole('button', { name: '确认' }).click()
      await page.locator(`[data-review-item="${key}"]`).locator('xpath=..').locator('[role=alert]').waitFor()
    })
    await elementShot(ctx, 'row-error', `[data-person-section="${newSection.person.id}"] [data-group="newClaims"]`)
    await step('save fails, retry succeeds', async () => {
      const it = state.sections[0].newClaims.find((i) => i.item.status === 'proposed')!
      await page.unroute(new RegExp(`/api/review/claim/${it.item.id}$`))
      await page.locator(`[data-review-item="claim:${it.item.id}"]`).locator('xpath=..').getByRole('button', { name: '重试' }).click()
      await page.locator(`[data-review-item="claim:${it.item.id}"][data-status="confirmed"]`).waitFor()
    })

    await step('变化: confirm strikes the old statement', async () => {
      const change = state.sections.flatMap((s) => s.changes).find((c) => c.item.status === 'proposed')!
      const key = `claim:${change.item.id}`
      await row(key).getByRole('button', { name: '确认' }).click()
      await page.locator(`[data-review-item="${key}"][data-status="confirmed"]`).waitFor()
      check('old statement struck', (await row(key).locator('[data-change-old] .line-through').count()) === 1)
    })
    await elementShot(ctx, 'change-confirmed', '[data-group="changes"]')

    await step('本节全部确认', async () => {
      const s = state.sections.find((x) => !x.person.isNew && itemsOf(x).some((i) => i.item.status === 'proposed'))!
      const sec = page.locator(`[data-person-section="${s.person.id}"]`)
      await sec.locator('[data-section-accept]').click()
      await sec.locator('[data-section-accept]').waitFor({ state: 'detached' })
      check('no proposed rows left in the section', (await sec.locator('[data-review-item][data-status="proposed"]').count()) === 0)
    })

    await step('新人物: rename', async () => {
      const input = page.locator(`[data-person-section="${newSection.person.id}"] [data-person-label-input]`)
      await input.fill('贺知遥（大学）')
      await input.press('Enter')
      await page.locator(`[data-person-section="${newSection.person.id}"] h2`).getByText('贺知遥（大学）').waitFor()
      check('已保存', ((await page.locator(`[data-person-section="${newSection.person.id}"]`).textContent()) ?? '').includes('已保存'))
    })

    await step('bulk: two steps', async () => {
      const bar = page.locator('[data-bulk-high-confidence]')
      await bar.locator('[data-bulk-button]').click()
      check('armed', (await bar.getAttribute('data-armed')) === 'true')
      await bar.locator('[data-bulk-button]').click()
      await bar.waitFor({ state: 'detached', timeout: 10_000 })
      const leftover = state.highConfidence.filter((h) => find('claim', h.id)?.item.status === 'proposed')
      check('every high-confidence claim confirmed', leftover.length === 0, { leftover })
    })

    await step('其实是…… → merge', async () => {
      await page.locator(`[data-person-section="${newSection.person.id}"] [data-merge-open]`).click()
      await page.locator('[data-merge-dialog] input[role=combobox]').waitFor()
      await helpers.type(target.label ?? '')
      await page.locator('[data-merge-dialog] [role=option]').filter({ hasText: target.label ?? '' }).first().click()
      await page.locator('[data-merge-confirm]').waitFor()
    })
    await shot('merge-confirm-step', { fullPage: false })
    await step('merge executes', async () => {
      await page.locator('[data-merge-confirm]').click()
      await page.locator('[data-merge-dialog]').waitFor({ state: 'detached' })
      await page.locator(`[data-person-section="${target.id}"]`).waitFor({ timeout: 10_000 })
      check('new person section gone', (await page.locator(`[data-person-section="${newSection.person.id}"]`).count()) === 0)
    })

    await step('finish: 已全部处理', async () => {
      for (;;) {
        const btn = page.locator('[data-section-accept]').first()
        if ((await btn.count()) === 0) break
        await btn.click()
        await btn.waitFor({ state: 'detached' }).catch(() => undefined)
      }
      await page.locator('[data-all-handled]').waitFor({ timeout: 10_000 })
      check('handled rows stay on the page', (await page.locator('[data-review-item]').count()) === state.sections.reduce((n, s) => n + itemsOf(s).length, 0))
    })
    await shot('finished')
  },
})
