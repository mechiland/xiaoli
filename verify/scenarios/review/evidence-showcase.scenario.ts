import { defineScenario } from '@/verify/lib'

type Evidence = { sourceKind: string; items: { chatId: number; chatTitle: string; messages: { isEvidence: boolean }[] }[] }

// Shared evidence component (SPEC §9.6): fixture states on /dev/review/evidence plus the real API on seed claims.
export default defineScenario({
  id: 'review/evidence-showcase',
  description: '证据组件：多条证据跨两个聊天、灰色标签、手动添加、加载中、出错、长消息、真实接口（加载 → 出错 → 重试）',
  account: 'seed',
  requiredTags: ['claim:delete-me-shared', 'claim:claim-searchable'],
  expectedFailures: [{ urlPattern: '/api/evidence/claim/', status: 500, step: 'live: error state', consoleText: 'status of 500' }],
  async run({ page, step, shot, check, helpers, seed, api }) {
    // Element shots: the sticky top bar would be painted over the element (390 especially), so it is made
    // non-sticky just for the shot and restored right after.
    const elementShot = async (name: string, selector: string, opts: { settleMs?: number } = {}) => {
      const set = (on: boolean) =>
        page.evaluate((flag) => {
          const bar = document.querySelector<HTMLElement>('header.sticky')
          if (bar) bar.style.position = flag ? 'static' : ''
        }, on)
      await set(true)
      await page.locator(selector).first().scrollIntoViewIfNeeded()
      try {
        return await shot(name, { selector, fullPage: false, ...opts })
      } finally {
        await set(false)
      }
    }
    const shared = await seed.claim('delete-me-shared')
    const other = await seed.claim('claim-searchable')

    await step('api: seed claim evidence spans two chats', async () => {
      const r = await api.get<Evidence>(`/api/evidence/claim/${shared.id}`)
      const chats = new Set(r.json?.items.map((i) => i.chatId))
      check('GET /api/evidence 200', r.status === 200, { status: r.status })
      check('delete-me-shared has segments from 2 chats', chats.size >= 2, { chats: chats.size })
      check('every segment has an evidence message', Boolean(r.json?.items.every((i) => i.messages.some((m) => m.isEvidence))))
    })

    await step('open showcase', () => helpers.goto(`/dev/review/evidence?claim=${shared.id}&claim2=${other.id}`, { waitFor: '#row-multi [role=region]' }))
    await step('fixture states render', async () => {
      const multi = page.locator('#row-multi [role=region]')
      check('two chat segments in the multi block', (await multi.locator('section').count()) === 2)
      check('three evidence messages tinted', (await multi.locator('[data-evidence-message]').count()) === 3)
      for (const chip of ['语音 9 秒', '语音 14 秒', '转账', '红包', '视频通话', '图片']) {
        check(`chip ${chip}`, (await multi.getByText(chip, { exact: true }).count()) > 0)
      }
      check('在聊天中查看 links to /chats/:id?at=', /^\/chats\/\d+\?at=\d+$/.test((await multi.getByRole('link', { name: '在聊天中查看' }).first().getAttribute('href')) ?? ''))
      check('manual footer', (await page.locator('#row-manual').getByText('手动添加于 2026年9月1日').count()) === 1)
      check('loading skeleton', (await page.locator('#row-loading [aria-busy=true]').count()) > 0)
      check('error with retry', (await page.locator('#row-error [role=alert]').getByRole('button', { name: '重试' }).count()) === 1)
      check('disabled mark', await page.locator('[data-evidence-mark="claim:990008"]').isDisabled())
      const width = page.viewportSize()?.width ?? 1440
      const hit = await page.locator('[data-evidence-mark="claim:990001"]').evaluate((b) => {
        const r = (b.querySelector('[data-evidence-hit]') as HTMLElement | null)?.getBoundingClientRect()
        const g = b.getBoundingClientRect()
        const hidden = !r || r.width === 0
        return { w: hidden ? g.width : r.width, h: hidden ? g.height : r.height }
      })
      if (width < 640) check('mark tap area ≥ 24×24 on a phone', hit.w >= 24 && hit.h >= 24, hit)
    })
    await shot('overview')
    await elementShot('multi-block', '#multi')
    await elementShot('long-block', '#long')

    await step('toggle: click closes, click again opens (aria-expanded)', async () => {
      const mark = page.locator('[data-evidence-mark="claim:990001"]')
      await mark.click()
      check('closed after click', (await mark.getAttribute('aria-expanded')) === 'false' && (await page.locator('#row-multi [role=region]').count()) === 0)
      await mark.click()
      await page.locator('#row-multi [role=region]').waitFor()
      check('open again', (await mark.getAttribute('aria-expanded')) === 'true')
      const other = page.locator('[data-evidence-mark="relation:990006"]')
      await other.click()
      await page.locator('#multi li:nth-child(2) [role=region]').waitFor()
      check('relation row opens its own block', (await other.getAttribute('aria-expanded')) === 'true')
    })
    await elementShot('two-open', '#multi')

    await step('live: loading state', async () => {
      await helpers.simulateLoading(new RegExp(`/api/evidence/claim/${shared.id}(\\?|$)`), 3000)
      await page.locator('#live').scrollIntoViewIfNeeded()
      await page.locator(`[data-evidence-mark="claim:${shared.id}"]`).click()
      await page.locator('#live-row-1 [role=region][aria-busy=true]').waitFor({ timeout: 2000 })
    })
    await elementShot('live-loading', '#live', { settleMs: 50 })
    await step('live: loaded from the real API', async () => {
      await page.locator('#live-row-1 [role=region] section').first().waitFor({ timeout: 15_000 })
      check('live block has ≥ 2 chat segments', (await page.locator('#live-row-1 [role=region] section').count()) >= 2)
      await helpers.clearRoutes()
    })
    await elementShot('live-loaded', '#live')

    await step('live: error state', async () => {
      await helpers.simulateError(new RegExp(`/api/evidence/claim/${other.id}(\\?|$)`), { status: 500 })
      await page.locator(`[data-evidence-mark="claim:${other.id}"]`).click()
      await page.locator('#live-row-2 [role=alert]').waitFor({ timeout: 15_000 })
      check('row text still visible next to the error', await page.locator('#live-row-2').getByText(other.statement ?? '').first().isVisible())
    })
    await elementShot('live-error', '#live')
    await step('live: retry recovers', async () => {
      await helpers.clearRoutes()
      await page.locator('#live-row-2').getByRole('button', { name: '重试' }).click()
      await page.locator('#live-row-2 [role=region] section').first().waitFor({ timeout: 15_000 })
      check('retry loaded', (await page.locator('#live-row-2 [role=alert]').count()) === 0)
    })
    await elementShot('live-retried', '#live')
  },
})
