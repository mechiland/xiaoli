import type { Route } from 'playwright'
import type { ClaimDTO, ProfileResponse, ReviewItem } from '@/contracts'
import { formatIsoDate } from '@/lib/time'
import { defineScenario } from '@/verify/lib'
import { clone, compactReview, elementShot, fulfillJson, guardJobs, itemsOf, reviewUrl, type Review } from './_support'

// Review actions on the import result page against a stateful route mock (seed account, read-only on the server):
// 确认 / 不对 / 改写 (text and date) stay in place, 变化 confirm strikes the old statement, 本节全部确认, the two-step
// high-confidence bulk, rename of a new person, "其实是……" merge, a failed save with retry, and 已全部处理.
// The real round trip (persistence after reload) is covered by `import-result/live-flow`.
export default defineScenario({
  id: 'import-result/actions',
  description: '导入结果页操作：确认、不对、改写（文字与日期）、变化确认、本节全部确认、两步批量确认、新人物改名（与已有人物同名）、其实是……同名候选带上下文与合并、合并后与名字相同的别名变淡、保存失败重试、已全部处理（接口为有状态的路由模拟，不改种子数据）',
  account: 'seed',
  requiredTags: ['import:review-mixed', 'person:long-profile'],
  expectedFailures: [{ urlPattern: /\/api\/review\/claim\/\d+$/, status: 500, step: 'save fails, retry succeeds', consoleText: 'status of 500' }],
  async run(ctx) {
    const { page, step, shot, check, helpers, seed, api } = ctx
    const mixed = await seed.import('review-mixed')
    const target = await seed.person('long-profile')
    const state: Review = compactReview((await api.get<Review>(`/api/imports/${mixed.id}/review`)).json!)
    const newSection = state.sections.find((s) => s.person.isNew)!
    // A real name that repeats the target's label: after the merge it must read as muted ("和名字相同"), not as news.
    const baseHandle = itemsOf(newSection).find((i) => i.type === 'handle')
    const echoHandleId = 990_001
    if (baseHandle && baseHandle.type === 'handle')
      newSection.aliasesAndRelations.push({ type: 'handle', item: { ...baseHandle.item, id: echoHandleId, kind: 'real_name', value: target.label ?? '', chatTitle: null, status: 'proposed' } })

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

    // Renamed to exactly the target's label: the duplicate-person case the 其实是…… dialog has to disambiguate.
    await step('新人物: rename', async () => {
      const input = page.locator(`[data-person-section="${newSection.person.id}"] [data-person-label-input]`)
      await input.fill(target.label ?? '')
      await input.press('Enter')
      await page.locator(`[data-person-section="${newSection.person.id}"] h2`).getByText(target.label ?? '', { exact: true }).waitFor()
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

    // The target as a person made by hand (no chats, no aliases, no claims): its context line is
    // "没有聊天记录 · 还没有信息 · <date>建立", the line whose date used to break mid-token at 1440 (overall critic r3).
    const realProfile = (await api.get<ProfileResponse>(`/api/people/${target.id}`)).json!
    const handMade: ProfileResponse = { ...clone(realProfile), aliases: [], sections: [], infobox: { ...clone(realProfile.infobox), chats: [] } }
    await page.route(new RegExp(`/api/people/${target.id}$`), (r: Route) => (r.request().method() === 'GET' ? fulfillJson(r, handMade) : r.fallback()))

    await step('其实是……: same-label person listed first, with context', async () => {
      await page.locator(`[data-person-section="${newSection.person.id}"] [data-merge-open]`).click()
      await page.locator('[data-merge-dialog] input[role=combobox]').waitFor()
      const option = page.locator('[data-merge-dialog] [role=option]').filter({ hasText: /个聊天|『|没有聊天记录/ }).first()
      await option.waitFor({ timeout: 10_000 })
      const text = (await option.textContent()) ?? ''
      check('candidate is the same-label target', text.startsWith(target.label ?? '\u0000'), { text })
      check('candidate carries context (chats / aliases)', /个聊天|『.+』|没有聊天记录/.test(text), { text })
      const label = option.locator('span').first()
      check('label is not truncated by the context', await label.evaluate((el) => el.scrollWidth <= el.clientWidth), { label: await label.textContent() })
    })
    await shot('merge-picker-same-label', { fullPage: false })
    await step('其实是…… → merge', async () => {
      await helpers.type(target.label ?? '')
      await page.locator('[data-merge-dialog] [role=option]').filter({ hasText: target.label ?? '' }).first().click()
      await page.locator('[data-merge-confirm]').waitFor()
      const q = (await page.locator('[data-merge-question]').textContent()) ?? ''
      check('question says which is which', q === `把这次导入新出现的「${target.label}」合并到已有的「${target.label}」？`, { q })
      await page.locator('[data-merge-target-context]').filter({ hasText: '建立' }).waitFor({ timeout: 10_000 })
      const ctxText = (await page.locator('[data-merge-context]').textContent()) ?? ''
      check('both sides have context', ctxText.includes('这次导入新建') && /\d+ 条新信息/.test(ctxText) && /建立/.test(ctxText), { ctxText })
      check('no to-do wording (SPEC §9.3)', !ctxText.includes('待处理'), { ctxText })
      const createdAt = handMade.person.createdAt
      const day = formatIsoDate(createdAt, 'Asia/Shanghai')
      const targetText = ((await page.locator('[data-merge-target-context]').textContent()) ?? '').trim()
      check('hand-made target context', targetText === `· 没有聊天记录 · 还没有信息 · ${day}建立`, { targetText })
      check('creation date is the local day (Asia/Shanghai), not the UTC date', ctxText.includes(`${day}建立`), { createdAt, ctxText })
      // every count / date piece sits on one line (an inline span that wraps has more than one client rect)
      const pieces = await page.locator('[data-merge-context] [data-context-piece]').evaluateAll((els) =>
        els.map((el) => ({ text: el.textContent ?? '', lines: el.getClientRects().length, nowrap: getComputedStyle(el).whiteSpace === 'nowrap' })),
      )
      const datePiece = pieces.find((p) => p.text.endsWith('建立'))
      check('date piece is nowrap and on one line', !!datePiece && datePiece.nowrap && datePiece.lines === 1, { datePiece })
      check('no count/date piece is broken across lines', pieces.filter((p) => p.nowrap).every((p) => p.lines === 1), { pieces })
    })
    await shot('merge-confirm-step', { fullPage: false })
    await elementShot(ctx, 'merge-confirm-dialog', '[data-merge-dialog]')
    await step('merge executes', async () => {
      await page.locator('[data-merge-confirm]').click()
      await page.locator('[data-merge-dialog]').waitFor({ state: 'detached' })
      await page.locator(`[data-person-section="${target.id}"]`).waitFor({ timeout: 10_000 })
      check('new person section gone', (await page.locator(`[data-person-section="${newSection.person.id}"]`).count()) === 0)
    })
    if (baseHandle) {
      await step('merged: a handle equal to the label is muted', async () => {
        const echo = page.locator(`[data-person-section="${target.id}"] [data-review-item="handle:${echoHandleId}"]`)
        await echo.waitFor()
        check('marked as label echo', (await echo.locator('[data-label-echo]').count()) === 1)
        check('muted color', (await echo.locator('[data-label-echo]').getAttribute('class'))?.includes('text-ink-3') === true)
        check('meta says 和名字相同', ((await echo.textContent()) ?? '').includes('和名字相同 · 真名'))
        const other = page.locator(`[data-person-section="${target.id}"] [data-review-item^="handle:"]:not([data-review-item="handle:${echoHandleId}"])`).first()
        if ((await other.count()) > 0) check('other aliases not muted', (await other.locator('[data-label-echo]').count()) === 0)
      })
      await elementShot(ctx, 'merged-aliases', `[data-person-section="${target.id}"] [data-group="aliasesAndRelations"]`)
    }

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
