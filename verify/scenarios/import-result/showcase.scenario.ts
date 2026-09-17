import type { Route } from 'playwright'
import { defineScenario } from '@/verify/lib'
import type { EvidenceResponse } from '@/contracts'
import {
  allHandledReview,
  clone,
  closedLoopBody,
  compactReview,
  detailUrl,
  elementShot,
  fulfillJson,
  guardInteraction,
  guardJobs,
  importConversations,
  longContentReview,
  reviewUrl,
  withLoops,
  type Detail,
  type Review,
} from './_support'

// Import result page (SPEC §9.9, ARCHITECTURE §1.10/§12) on the seed account. Read-only: every write and every
// jobs/next call is answered by a route stub, so the seed data and the LLM budget are untouched.
export default defineScenario({
  id: 'import-result/showcase',
  description: '导入结果页：完整分组（新人物、变化、未结事项）、未结事项四种状态与「已经了结了」、「这次聊了什么」在与不在、自己显示为「我」、消息在已删除的导入里读过、读取中逐步出现、失败窗口与重试、全部处理、没有产出、未完成导入、批量确认第一步、删除对话框、加载中、区块出错、长内容、窄屏变化上下排列',
  account: 'seed',
  requiredTags: ['import:review-mixed', 'import:review-empty', 'import:in-progress', 'import:failed-windows', 'import:unfinished', 'person:long-label', 'person:self'],
  expectedFailures: [
    { urlPattern: /\/api\/imports\/\d+\/review$/, status: 500, step: 'error: review block 500', consoleText: 'status of 500' },
    { urlPattern: /\/api\/imports\/\d+$/, status: 500, step: 'error: detail 500', consoleText: 'status of 500' },
  ],
  async run(ctx) {
    const { page, step, shot, check, helpers, seed, api } = ctx
    const mixed = await seed.import('review-mixed')
    const empty = await seed.import('review-empty')
    const inProgress = await seed.import('in-progress')
    const failed = await seed.import('failed-windows')
    const unfinished = await seed.import('unfinished')
    const longLabel = (await seed.person('long-label')).label ?? ''
    const self = await seed.person('self')
    const selfLabel = self.label ?? ''

    const fullMixed = (await api.get<Review>(`/api/imports/${mixed.id}/review`)).json!
    // Loops and conversation summaries are injected into the stubbed answers: the seed imports predate the
    // interaction layer, so `GET /api/imports/:id/interaction` has nothing to give and the review carries no loops.
    const compact = withLoops(compactReview(fullMixed))
    const firstClaim = compact.sections.flatMap((s) => s.newClaims).find((i) => i.type === 'claim')
    const loopEvidence = firstClaim
      ? { ...(await api.get<EvidenceResponse>(`/api/evidence/claim/${firstClaim.item.id}`)).json!, target: { type: 'loop' as const, id: 990_401 } }
      : undefined
    const chat = { id: fullMixed.chat?.id ?? 1, title: fullMixed.chat?.title ?? '聊天' }
    const conversations = importConversations(chat.id, chat.title)

    /** jobs/next + the interaction endpoints. Re-installed after every `clearRoutes`, like `guardJobs` alone was. */
    const stubs = async (body: unknown = { conversations: [] }) => {
      await guardJobs(page)
      await guardInteraction(page, body, loopEvidence)
    }

    const realInteraction = await api.get<{ conversations?: unknown[] }>(`/api/imports/${mixed.id}/interaction`)
    check('GET /api/imports/:id/interaction answers (its data is stubbed below either way)', realInteraction.status === 200, {
      status: realInteraction.status,
      conversations: realInteraction.json?.conversations?.length ?? null,
    })
    await stubs()

    // ---- normal: every group ----------------------------------------------------------------------------------
    await step('normal: all groups', async () => {
      await helpers.stubJson(reviewUrl(mixed.id), compact)
      await helpers.goto(`/imports/${mixed.id}`, { waitFor: '[data-review-body]' })
      check('title', (await page.locator('h1').first().textContent()) === '这份聊天记录带来的变化')
      const sub = (await page.locator('[data-import-subtitle]').textContent()) ?? ''
      check('subtitle: chat · range · 新增 N 条消息', /大学同学群 · \d{4}年\d+月\d+日 – \d+月\d+日 · 新增 \d+ 条消息/.test(sub.replace(/\s*·\s*/g, ' · ').replace(/\s+/g, ' ')), { sub })
      const first = page.locator('[data-person-section]').first()
      check('new person first, marked 新', (await first.locator('h2').textContent())?.trim().endsWith('新') === true)
      check('新人物 group with label input and 其实是……', (await first.locator('[data-person-label-input]').count()) === 1 && (await first.getByRole('button', { name: '其实是……' }).count()) === 1)
      for (const g of ['newClaims', 'changes', 'aliasesAndRelations', 'dates', 'events', 'loops']) check(`group ${g} present`, (await page.locator(`[data-group="${g}"]`).count()) > 0)
      check('every item has an evidence mark', (await page.locator('[data-review-item]').count()) <= (await page.locator('[data-evidence-mark]').count()))
      check('proposed items show 确认 / 不对 / 改写', (await page.locator('[data-row-actions]').first().textContent())?.replace(/\s/g, '') === '确认不对改写')
      check('本节全部确认 on sections', (await page.locator('[data-section-accept]').count()) > 0)
      check('delete control at the foot', await page.locator('footer [data-delete-import]').isVisible())
      const w = page.viewportSize()?.width ?? 1440
      const change = page.locator('[data-change]').first()
      const oldBox = await change.locator('[data-change-old]').boundingBox()
      const newBox = await change.locator('[data-change-new]').boundingBox()
      if (w < 640) check('390: 变化 stacked (old above new)', !!oldBox && !!newBox && oldBox.y + oldBox.height <= newBox.y + 1, { oldBox, newBox })
      else check('desktop: 变化 side by side', !!oldBox && !!newBox && oldBox.x + oldBox.width <= newBox.x && Math.abs(oldBox.y - newBox.y) < 4, { oldBox, newBox })
      check('no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      // every proposed row's actions share one position: desktop = one right column; phone = own line under the text, right-aligned
      const boxes = await page.locator('[data-review-item][data-status="proposed"]').evaluateAll((rows) =>
        rows.map((row) => {
          const a = row.querySelector('[data-row-actions]')!.getBoundingClientRect()
          const t = (row.firstElementChild as HTMLElement).getBoundingClientRect()
          return { right: Math.round(a.right), width: Math.round(a.width), below: a.top >= t.bottom - 1 }
        }),
      )
      check('actions: one right edge for all rows', new Set(boxes.map((b) => b.right)).size === 1, { rights: [...new Set(boxes.map((b) => b.right))] })
      if (w < 640) check('390: actions always on their own line under the text', boxes.every((b) => b.below), { inline: boxes.filter((b) => !b.below).length })
      else check('desktop: actions beside the text', boxes.every((b) => !b.below))
    })
    await shot('normal')
    await elementShot(ctx, 'changes-group', '[data-group="changes"]')

    await step('relation rows: no spaces around 是 / 的', async () => {
      const rows = page.locator('[data-review-item^="relation:"]')
      const n = await rows.count()
      check('seed has relation rows', n > 0, { n })
      for (let i = 0; i < n; i++) {
        const text = ((await rows.nth(i).locator('span').first().textContent()) ?? '').trim()
        check(`relation ${i}: "A是B的…" without ASCII spaces`, /是/.test(text) && !/\s是|是\s|\s的/.test(text), { text })
      }
    })
    await elementShot(ctx, 'relation-row', '[data-review-item^="relation:"]')

    // ---- 未结事项 (SPEC §9.9) ------------------------------------------------------------------------------------
    const loopRow = (id: number) => page.locator(`[data-review-item="loop:${id}"]`)
    const loopText = async (id: number) => ((await loopRow(id).locator('span').first().textContent()) ?? '').trim()

    await step('未结事项: proposed / confirmed / rejected / already closed', async () => {
      const label = compact.sections[0].person.label
      check('group 未结事项 present, titled', ((await page.locator('[data-group="loops"] h3').first().textContent()) ?? '').trim() === '未结事项')
      check('gutter says what kind it is, not the enum', ((await page.locator('[data-group="loops"]').first().textContent()) ?? '').includes('承诺'))
      check('mine promise: 你答应…', (await loopText(990_401)) === '你答应帮她看简历', { t: await loopText(990_401) })
      const q = await loopText(990_402)
      check('question: who asked, and that the answer is on the user', q === `${label}问你国庆有没有空，你没回`, { q })
      check('plan: 约好…', (await loopText(990_403)) === '约好下个月去成都', { t: await loopText(990_403) })
      check('theirs promise names the person', (await loopText(990_411)).startsWith(compact.sections[1].person.label), { t: await loopText(990_411) })
      const group = ((await page.locator('[data-group="loops"]').first().textContent()) ?? '') + ((await page.locator('[data-group="loops"]').last().textContent()) ?? '')
      check('no raw enum on the page', !/promise|question|plan|mine|theirs|mutual/i.test(group), { group })
      check('opening day in small type', ((await loopRow(990_401).textContent()) ?? '').includes('2026年9月13日起'))
      check('a 约定 also carries the day it is for', ((await loopRow(990_403).textContent()) ?? '').includes('约在2026年10月4日'))
      check('evidence mark like every other item', (await loopRow(990_401).locator('[data-evidence-mark]').count()) === 1)
      check(
        'proposed loop: 确认 / 不对 / 改写 / 已经了结了',
        ((await loopRow(990_401).locator('[data-row-actions]').textContent()) ?? '').replace(/\s/g, '') === '确认不对改写已经了结了',
      )
      check('confirmed loop reads 已确认', ((await loopRow(990_411).locator('[data-row-state]').textContent()) ?? '').trim() === '已确认')
      const rejected = loopRow(990_412)
      check(
        'rejected loop stays in place, struck through, 已划掉',
        ((await rejected.locator('[data-row-state]').textContent()) ?? '').trim() === '已划掉' &&
          ((await rejected.locator('span').first().getAttribute('class')) ?? '').includes('line-through'),
      )
      const done = loopRow(990_413)
      check(
        'a loop already closed by a later message reads 已了结 and has nothing left to close',
        ((await done.locator('[data-row-state]').textContent()) ?? '').trim() === '已了结' && (await done.locator('[data-row-close]').count()) === 0,
      )
      check('SPEC §9.3: no counts, no badges, no red dots in the group', !/\d+\s*条未/.test(group))
    })
    await elementShot(ctx, 'loops-group', '[data-group="loops"]')

    await step('未结事项 are not in the bulk "确认所有可信度高的条目" set', async () => {
      check('the payload keeps loops out of highConfidence', compact.highConfidence.every((h) => h.type === 'claim'), { highConfidence: compact.highConfidence.length })
      await page.locator('[data-bulk-button]').click()
      const text = ((await page.locator('[data-bulk-high-confidence]').textContent()) ?? '').replace(/\s+/g, ' ')
      const shown = Number(/将确认 (\d+) 条/.exec(text)?.[1] ?? -1)
      const proposedLoops = await page.locator('[data-review-item^="loop:"][data-status="proposed"]').count()
      check('the count before confirming is the claims only', shown === compact.highConfidence.length && proposedLoops > 0, { shown, expected: compact.highConfidence.length, proposedLoops })
      await page.locator('[data-bulk-high-confidence]').getByRole('button', { name: '取消' }).click()
    })

    await step('已经了结了: one click confirms and closes', async () => {
      const first = compact.sections[0].loops[0]
      check('the fixture starts with a proposed, open loop', first?.type === 'loop' && first.item.status === 'proposed' && first.item.state === 'open')
      if (first?.type !== 'loop') return
      const answer = closedLoopBody(first)
      let posted: { url: string; body: unknown } | null = null
      let closed = false
      // what the next GET /review returns once the close landed, so the coalesced refetch cannot undo it
      const after = clone(compact)
      after.sections[0].loops[0] = { type: 'loop', item: answer.loop }
      await helpers.clearRoutes()
      await stubs()
      await page.route(reviewUrl(mixed.id), (r: Route) => fulfillJson(r, closed ? after : compact))
      await page.route(/\/api\/loops\/\d+\/close$/, async (r: Route) => {
        posted = { url: r.request().url(), body: r.request().postDataJSON() as unknown }
        closed = true
        await fulfillJson(r, answer)
      })
      await helpers.goto(`/imports/${mixed.id}`, { waitFor: '[data-review-body]' })
      await loopRow(990_401).locator('[data-row-close]').click()
      await page.locator('[data-review-item="loop:990401"][data-status="confirmed"]').waitFor({ timeout: 10_000 })
      const sent = posted as { url: string; body: unknown } | null
      check('one request, to the interaction endpoint, with reason done', !!sent && sent.url.endsWith('/api/loops/990401/close') && JSON.stringify(sent.body) === '{"reason":"done"}', { sent })
      check('the row is handled, not still pending', (await loopRow(990_401).locator('[data-row-actions]').count()) === 0)
      check('and says 已了结, not 已确认', ((await loopRow(990_401).locator('[data-row-state]').textContent()) ?? '').trim() === '已了结')
      // the coalesced review refetch lands ~900 ms later: the row must not flip back to pending
      await helpers.settle()
      check('still handled after the review refetch', (await loopRow(990_401).locator('[data-row-close]').count()) === 0)
    })
    await elementShot(ctx, 'loop-closed', '[data-review-item="loop:990401"]')

    // ---- 这次聊了什么 (SPEC §9.9: narrative, never a review queue) --------------------------------------------------
    await step('这次聊了什么: present, above the sections, with no confirm affordance', async () => {
      await helpers.clearRoutes()
      await stubs(conversations)
      await helpers.stubJson(reviewUrl(mixed.id), compact)
      await helpers.goto(`/imports/${mixed.id}`, { waitFor: '[data-block="import-conversations"]' })
      const block = page.locator('[data-block="import-conversations"]')
      check('heading', ((await block.locator('h2').textContent()) ?? '').trim() === '这次聊了什么')
      check('one row per conversation', (await block.locator('[data-conversation]').count()) === 2)
      check(
        'above the per-person sections',
        await page.evaluate(() => {
          const b = document.querySelector('[data-block="import-conversations"]')
          const s = document.querySelector('[data-person-section]')
          return !!b && !!s && (b.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        }),
      )
      check('no 确认 / 不对 inside', (await block.getByRole('button', { name: '确认' }).count()) === 0 && (await block.getByRole('button', { name: '不对' }).count()) === 0)
      check('not a reviewable item', (await block.locator('[data-review-item]').count()) === 0 && (await block.locator('[data-row-actions]').count()) === 0)
      check('only 改写 / 隐藏 on a summary', ((await block.locator('[data-segment]').first().textContent()) ?? '').includes('改写'))
      check('no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    })
    await shot('conversations')
    await elementShot(ctx, 'conversations-block', '[data-block="import-conversations"]')

    await step('这次聊了什么: no summaries → the block is not there at all', async () => {
      await helpers.clearRoutes()
      await stubs()
      await helpers.stubJson(reviewUrl(mixed.id), compact)
      await helpers.goto(`/imports/${mixed.id}`, { waitFor: '[data-review-body]' })
      await helpers.settle()
      check('block absent', (await page.locator('[data-block="import-conversations"]').count()) === 0)
      check('the review body is unaffected', (await page.locator('[data-person-section]').count()) === compact.sections.length)
    })

    await helpers.clearRoutes()
    await stubs()
    await helpers.stubJson(reviewUrl(mixed.id), compact)
    await helpers.goto(`/imports/${mixed.id}`, { waitFor: '[data-review-body]' })

    // The user's own person reads as 我, as on the person page: relation endpoints both ways and its section heading.
    await step('self reads as 我', async () => {
      const r = clone(compact)
      const rel = r.sections.flatMap((x) => x.aliasesAndRelations).find((i) => i.type === 'relation')
      const date = r.sections.flatMap((x) => x.dates)[0]
      const otherSection = r.sections.find((x) => !x.person.isNew && x.person.id !== self.id)
      check('compact review has a relation, a date and a plain section', !!rel && !!date && !!otherSection)
      if (!rel || rel.type !== 'relation' || !date || !otherSection) return
      const other = otherSection.person
      // a display name on the self person (the seed labels it 我), so the page has to replace it with 我
      const me = { id: self.id, label: selfLabel === '我' ? '小满' : selfLabel }
      const ref = { id: other.id, label: other.label }
      const fromSelf = { type: 'relation' as const, item: { ...clone(rel.item), id: 990_201, fromPersonId: me.id, from: me, toPersonId: ref.id, to: ref, type: 'parent', label: '爸爸', status: 'proposed' as const } }
      const toSelf = { type: 'relation' as const, item: { ...clone(rel.item), id: 990_202, fromPersonId: ref.id, from: ref, toPersonId: me.id, to: me, type: 'service_provider', label: '柜子定制商家', status: 'proposed' as const } }
      otherSection.aliasesAndRelations.push(toSelf)
      r.sections.push({
        ...clone(otherSection),
        person: { id: me.id, label: me.label, isNew: false },
        newClaims: [],
        changes: [],
        aliasesAndRelations: [fromSelf],
        dates: [{ ...clone(date), item: { ...clone(date.item), id: 990_203, personId: me.id, status: 'proposed' } } as typeof date],
        events: [],
        loops: [],
      })
      await helpers.stubJson(reviewUrl(mixed.id), r)
      await helpers.goto(`/imports/${mixed.id}`, { waitFor: `[data-person-section="${self.id}"]` })
      const heading = ((await page.locator(`[data-person-section="${self.id}"] h2`).textContent()) ?? '').trim()
      check('self section heading is 我', heading === '我', { heading })
      const t1 = ((await page.locator('[data-review-item="relation:990201"] span').first().textContent()) ?? '').trim()
      const t2 = ((await page.locator('[data-review-item="relation:990202"] span').first().textContent()) ?? '').trim()
      check('from self: 我是X的爸爸', t1 === `我是${other.label}的爸爸`, { t1 })
      check('to self: X是我的…', t2 === `${other.label}是我的柜子定制商家`, { t2 })
      check('display name of self not shown in those rows', !t1.includes(me.label) && !t2.includes(me.label), { name: me.label, t1, t2 })
      check('我 in another section links to the self page', (await page.locator(`[data-review-item="relation:990202"] a[href="/p/${self.id}"]`).textContent())?.trim() === '我')
    })
    await elementShot(ctx, 'self-section', `[data-person-section="${self.id}"]`)
    await page.locator('[data-review-item="relation:990202"]').scrollIntoViewIfNeeded()
    await shot('self-relation-row', { fullPage: false })
    await helpers.clearRoutes()
    await stubs()
    await helpers.stubJson(reviewUrl(mixed.id), compact)
    await helpers.goto(`/imports/${mixed.id}`, { waitFor: '[data-review-body]' })

    await step('evidence opens under a row', async () => {
      await page.locator('[data-review-item] [data-evidence-mark]').first().click()
      await page.locator('[data-review-body] [role=region][aria-label="证据"] section').first().waitFor({ timeout: 15_000 })
    })
    await elementShot(ctx, 'evidence-open', '[data-person-section]')
    await page.locator('[data-review-item] [data-evidence-mark]').first().click()

    await step('bulk confirm: step 1 shows the count', async () => {
      await page.locator('[data-bulk-button]').click()
      const text = (await page.locator('[data-bulk-high-confidence]').textContent()) ?? ''
      check('armed with count', /将确认 \d+ 条/.test(text) && text.includes(`确认这 ${compact.highConfidence.length} 条`), { text })
    })
    await shot('bulk-step-1', { fullPage: false })
    await page.locator('[data-bulk-high-confidence]').getByRole('button', { name: '取消' }).click()

    await step('inline edit open', async () => {
      await page.locator('[data-review-item][data-status="proposed"]').first().getByRole('button', { name: '改写' }).click()
      await page.locator('[data-editor] textarea').waitFor()
    })
    await elementShot(ctx, 'edit-open', '[data-person-section]')
    await page.locator('[data-editor]').getByRole('button', { name: '取消' }).click()

    await step('其实是…… dialog', async () => {
      await page.locator('[data-merge-open]').first().click()
      await page.locator('[data-merge-dialog] input[role=combobox]').waitFor()
      await helpers.type('林')
      await page.locator('[data-merge-dialog] [role=option]').first().waitFor({ timeout: 10_000 })
    })
    await shot('merge-dialog', { fullPage: false })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    await step('delete dialog open', async () => {
      await page.locator('[data-merge-dialog]').waitFor({ state: 'detached' })
      await page.locator('[data-delete-import]').click()
      await page.locator('[data-delete-dialog]').waitFor()
      check('dialog copy', ((await page.locator('[data-delete-dialog]').textContent()) ?? '').includes('还有其他证据的信息会保留'))
    })
    await shot('delete-dialog', { fullPage: false })
    await page.locator('[data-delete-dialog]').getByRole('button', { name: '取消' }).click()

    // ---- extracting with partial results ------------------------------------------------------------------------
    await step('extracting: partial results, loop advances', async () => {
      await helpers.clearRoutes()
      await stubs()
      const realDetail = (await api.get<Detail>(`/api/imports/${inProgress.id}`)).json!
      const realReview = (await api.get<Review>(`/api/imports/${inProgress.id}/review`)).json!
      const total = 8
      let done = 2
      const progress = () => ({ total, done, failed: 0, pending: total - done, running: 0 })
      const visible = () => Math.min(realReview.sections.length, 2 + (done - 2) * 2)
      await page.route(detailUrl(inProgress.id), (r: Route) => fulfillJson(r, { ...clone(realDetail), progress: progress(), import: { ...realDetail.import, status: 'extracting' } }))
      await page.route(reviewUrl(inProgress.id), (r: Route) =>
        fulfillJson(r, { ...clone(realReview), progress: progress(), sections: realReview.sections.slice(0, visible()), import: { ...realReview.import, status: 'extracting' } }),
      )
      await page.route(/\/api\/imports\/\d+\/jobs\/next$/, async (r: Route) => {
        await new Promise((res) => setTimeout(res, done < 3 ? 1200 : 60_000))
        done = Math.min(total, done + 1)
        await fulfillJson(r, { processed: { jobId: 1, status: 'done', itemsCreated: 4 }, progress: progress(), importStatus: 'extracting' })
      })
      await page.goto(`/imports/${inProgress.id}`)
      await page.locator('[data-extraction-progress]').waitFor({ timeout: 20_000 })
      await page.locator('[data-review-body]').waitFor()
      check('progress line text', ((await page.locator('[data-extraction-progress]').textContent()) ?? '').includes('正在读取 3 / 8 段对话'))
      check('离开页面后会暂停', ((await page.locator('[data-extraction-progress]').textContent()) ?? '').includes('离开页面后会暂停'))
      check('partial sections', (await page.locator('[data-person-section]').count()) === 2)
      await page.waitForFunction(() => document.querySelectorAll('[data-person-section]').length === 4, null, { timeout: 15_000 })
      check('next window: 正在读取 4 / 8', ((await page.locator('[data-extraction-progress]').textContent()) ?? '').includes('正在读取 4 / 8'))
      check('new sections fade in', (await page.locator('[data-person-section].animate-in').count()) > 0)
    })
    await shot('extracting', { fullPage: false })

    // ---- failed windows + retry -------------------------------------------------------------------------------
    await step('failed windows', async () => {
      await page.goto('about:blank')
      await helpers.clearRoutes()
      await stubs()
      await helpers.goto(`/imports/${failed.id}`, { waitFor: '[data-failed-windows]' })
      check('failed count', ((await page.locator('[data-failed-windows]').textContent()) ?? '').includes('有 2 段对话没有读取成功'))
    })
    await shot('failed-windows', { fullPage: false })
    await step('failed windows: retry re-runs them', async () => {
      const base = { total: 5, done: 3, failed: 0, running: 0 }
      await page.route(/\/api\/imports\/\d+\/jobs\/retry$/, (r: Route) => fulfillJson(r, { reset: 2, progress: { ...base, pending: 2 } }))
      await page.route(/\/api\/imports\/\d+\/jobs\/next$/, async (r: Route) => {
        await new Promise((res) => setTimeout(res, 60_000))
        await fulfillJson(r, { processed: null, progress: { ...base, pending: 2 }, importStatus: 'extracting' })
      })
      await page.locator('[data-failed-windows]').getByRole('button', { name: '重试' }).click()
      await page.locator('[data-extraction-progress]').waitFor({ timeout: 10_000 })
      check('back to reading: 4 / 5', ((await page.locator('[data-extraction-progress]').textContent()) ?? '').includes('正在读取 4 / 5'))
      check('failed line hidden while reading', (await page.locator('[data-failed-windows]').count()) === 0)
    })
    await shot('failed-retrying', { fullPage: false })

    // ---- all handled / empty / unfinished / not found -----------------------------------------------------------
    await step('all handled (with 这次聊了什么 still on the page)', async () => {
      await page.goto('about:blank')
      await helpers.clearRoutes()
      // the only thing left un-actioned is the narrative block: it is outside progress and allHandled (DECISIONS I4)
      await stubs(conversations)
      await helpers.stubJson(reviewUrl(mixed.id), allHandledReview(compact))
      await helpers.goto(`/imports/${mixed.id}`, { waitFor: '[data-all-handled]' })
      check('已全部处理 with person links', (await page.locator('[data-all-handled] a').count()) === compact.sections.length)
      check('未结事项 count toward it: none left pending', (await page.locator('[data-review-item^="loop:"][data-status="proposed"]').count()) === 0)
      check('a conversation summary never blocks 已全部处理', (await page.locator('[data-block="import-conversations"] [data-conversation]').count()) === 2)
      check('no actions left', (await page.locator('[data-row-actions]').count()) === 0)
      check('struck rows stay', (await page.locator('[data-review-item][data-status="rejected"]').count()) > 0)
      check('bulk button hidden', (await page.locator('[data-bulk-high-confidence]').count()) === 0)
    })
    await shot('all-handled')

    await step('empty output', async () => {
      await helpers.clearRoutes()
      await stubs()
      await helpers.goto(`/imports/${empty.id}`, { waitFor: '[data-empty-result]' })
      check('no-output message', ((await page.locator('[data-empty-result]').textContent()) ?? '').includes('这段聊天里没有找到需要记下来的信息'))
    })
    await shot('empty', { fullPage: false })

    await step('nothing new (re-export: 0 new messages, no windows)', async () => {
      await helpers.clearRoutes()
      await stubs()
      const realDetail = (await api.get<Detail>(`/api/imports/${empty.id}`)).json!
      const realReview = (await api.get<Review>(`/api/imports/${empty.id}/review`)).json!
      check('seed review-empty did run windows (keeps the SPEC copy above)', realReview.progress.total > 0, { progress: realReview.progress })
      const none = { total: 0, done: 0, failed: 0, pending: 0, running: 0 }
      const imp = { ...realDetail.import, status: 'done' as const, newMessageCount: 0 }
      await page.route(detailUrl(empty.id), (r: Route) => fulfillJson(r, { ...clone(realDetail), import: imp, progress: none }))
      await page.route(reviewUrl(empty.id), (r: Route) => fulfillJson(r, { ...clone(realReview), import: imp, progress: none, sections: [], highConfidence: [], highConfidenceCount: 0, empty: true }))
      await helpers.goto(`/imports/${empty.id}`, { waitFor: '[data-empty-result]' })
      const text = (await page.locator('[data-empty-result]').textContent()) ?? ''
      check('kind nothing-new', (await page.locator('[data-empty-result]').getAttribute('data-empty-result')) === 'nothing-new')
      check('says nothing new was read', text.includes('这份记录里的消息之前都导入过，没有新的消息需要读取'), { text })
      check('no SPEC no-output copy', !text.includes('没有找到需要记下来的信息'))
      const people = page.locator('[data-earlier-people] a[href^="/p/"]')
      if (realDetail.persons.length > 0) check('links the people of the import, not the chat', (await people.count()) === Math.min(8, realDetail.persons.length) && (await page.locator('[data-empty-result] a[href^="/chats/"]').count()) === 0)
      else check('no people known: names the chat', (await page.locator('[data-empty-result] a[href^="/chats/"]').count()) === 1)
      check('subtitle 新增 0 条消息', ((await page.locator('[data-import-subtitle]').textContent()) ?? '').replace(/\s/g, '').includes('新增0条消息'))
    })
    await shot('nothing-new', { fullPage: false })

    await step('read before (earlier import deleted: messages handed over, no windows)', async () => {
      await helpers.clearRoutes()
      await stubs()
      const realDetail = (await api.get<Detail>(`/api/imports/${empty.id}`)).json!
      const realReview = (await api.get<Review>(`/api/imports/${empty.id}/review`)).json!
      const none = { total: 0, done: 0, failed: 0, pending: 0, running: 0 }
      const imp = { ...realDetail.import, status: 'done' as const, newMessageCount: 36 }
      await page.route(detailUrl(empty.id), (r: Route) => fulfillJson(r, { ...clone(realDetail), import: imp, progress: none }))
      await page.route(reviewUrl(empty.id), (r: Route) => fulfillJson(r, { ...clone(realReview), import: imp, progress: none, sections: [], highConfidence: [], highConfidenceCount: 0, empty: true }))
      await helpers.goto(`/imports/${empty.id}`, { waitFor: '[data-empty-result]' })
      const text = (await page.locator('[data-empty-result]').textContent()) ?? ''
      check('kind read-before', (await page.locator('[data-empty-result]').getAttribute('data-empty-result')) === 'read-before')
      check('says where the messages were read', text.includes('这份记录里的消息在之前那次导入时读过（那次导入已删除），这次没有再读取'), { text })
      check('no "之前都导入过" copy', !text.includes('之前都导入过'))
      const sub = ((await page.locator('[data-import-subtitle]').textContent()) ?? '').replace(/\s/g, '')
      check('subtitle: 36 条消息 without 新增', sub.includes('36条消息') && !sub.includes('新增'), { sub })
      check('people linked', realDetail.persons.length === 0 || (await page.locator('[data-earlier-people] a[href^="/p/"]').count()) > 0, { persons: realDetail.persons.length })
    })
    await shot('read-before', { fullPage: false })

    await step('unfinished (mapping)', async () => {
      await helpers.goto(`/imports/${unfinished.id}`, { waitFor: '[data-import-status="mapping"]' })
      check('title', (await page.locator('h1').first().textContent()) === '这次导入没有完成')
      check('one line + delete', (await page.getByText('可以重新导入这份文件。').count()) === 1 && (await page.locator('[data-delete-import]').count()) === 1)
    })
    await shot('unfinished', { fullPage: false })

    await step('not found', async () => {
      const hits: string[] = []
      const onRequest = (req: { url(): string }) => {
        if (req.url().includes('/api/imports/99999999')) hits.push(req.url())
      }
      page.on('request', onRequest)
      await helpers.goto('/imports/99999999', { waitFor: '[data-import-result-missing]' })
      await helpers.settle()
      page.off('request', onRequest)
      check('rendered by the server: no client request for the unknown import', hits.length === 0, { hits })
    })
    await shot('not-found', { fullPage: false })

    // ---- loading / errors / long ------------------------------------------------------------------------------
    await step('loading (3 s)', async () => {
      await helpers.simulateLoading(detailUrl(mixed.id), 3000)
      await helpers.simulateLoading(reviewUrl(mixed.id), 3000)
      await page.goto(`/imports/${mixed.id}`)
      await page.locator('[data-review-loading]').waitFor({ timeout: 10_000 })
    })
    await shot('loading', { fullPage: false, settleMs: 400 })

    await step('error: review block 500', async () => {
      await page.goto('about:blank')
      await helpers.clearRoutes()
      await stubs()
      await helpers.simulateError(reviewUrl(mixed.id), { status: 500 })
      await page.goto(`/imports/${mixed.id}`)
      await page.locator('[data-review-error] [role=alert]').waitFor({ timeout: 20_000 })
      check('header still renders', ((await page.locator('[data-import-subtitle]').textContent()) ?? '').includes('新增'))
      check('delete control still renders', await page.locator('[data-delete-import]').isVisible())
    })
    await shot('error-review', { fullPage: false })
    await step('error: retry recovers', async () => {
      await helpers.clearRoutes()
      await stubs()
      await helpers.stubJson(reviewUrl(mixed.id), compact)
      await page.locator('[data-review-error]').getByRole('button', { name: '重试' }).click()
      await page.locator('[data-review-body]').waitFor({ timeout: 15_000 })
    })

    await step('error: detail 500', async () => {
      await page.goto('about:blank')
      await helpers.simulateError(detailUrl(mixed.id), { status: 500 })
      await page.goto(`/imports/${mixed.id}`)
      await page.locator('[data-review-body]').waitFor({ timeout: 20_000 })
      check('subtitle falls back to the review data', ((await page.locator('[data-import-subtitle]').textContent()) ?? '').includes('新增'))
    })
    await shot('error-detail', { fullPage: false })

    await step('long content', async () => {
      await page.goto('about:blank')
      await helpers.clearRoutes()
      await stubs()
      await helpers.stubJson(reviewUrl(mixed.id), longContentReview(compact, longLabel))
      await helpers.goto(`/imports/${mixed.id}`, { waitFor: '[data-review-body]' })
      check('no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    })
    await shot('long-content')

    await step('real long import (185 sections)', async () => {
      await helpers.clearRoutes()
      await stubs()
      await helpers.goto(`/imports/${mixed.id}`, { waitFor: '[data-review-body]' })
      check('all sections render', (await page.locator('[data-person-section]').count()) === fullMixed.sections.length)
      await page.locator('footer [data-delete-import]').scrollIntoViewIfNeeded()
    })
    await shot('real-long-foot', { fullPage: false })
  },
})
