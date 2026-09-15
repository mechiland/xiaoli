import { defineScenario } from '@/verify/lib'

// Home (SPEC §9.4): seeded full home (200 people), first screen, search from the hero, letter jump, loading (client
// fallback delayed 3 s), one block failing while the others render, showcase variants (>200 collapsed, lunar + solar
// upcoming, no upcoming, long content, empty + onboarding hint), P3 budget at 1440.
const HOME_API = /\/api\/home(\?|$)/

export default defineScenario({
  id: 'home/showcase',
  description: '首页：种子数据、首屏、字母跳转、加载中、单块错误、>200 折叠、农历、无即将到来、长内容、窄屏',
  account: 'seed',
  requiredTags: ['person:long-profile', 'person:long-label', 'person:lunar-birthday-soon'],
  expectedFailures: [{ urlPattern: '/api/home', status: 500, step: 'error-state', consoleText: 'Failed to load resource' }],
  async run({ page, step, shot, check, helpers, seed, width, measure }) {
    const longLabel = await seed.person('long-label')
    const lunarSoon = await seed.person('lunar-birthday-soon')
    const main = page.locator('main')
    const heading = (name: string) => main.getByRole('heading', { name, exact: true })
    // `has:` locators are resolved relative to the outer element, so they must not be rooted at main
    const section = (name: string) => main.locator('section', { has: page.getByRole('heading', { name, exact: true }) })

    await step('seeded home', async () => {
      const status = await helpers.goto('/')
      check('home answers 200', status === 200, { status })
      for (const name of ['即将到来', '最近有新信息的人', '关注的人', '全部人物', '最近导入']) {
        check(`section "${name}" present`, await heading(name).isVisible())
      }
      const hero = main.getByRole('button', { name: /搜索人物、别名或信息/ })
      const box = await hero.boundingBox()
      check('hero search is wide and tall', !!box && box.height >= 60 && box.width >= Math.min(600, width - 48), box)
      check('hero search sits in the first screen', !!box && box.y + box.height < (page.viewportSize()?.height ?? 800), box)
      check('index lists exactly 200 people', (await main.locator('[id^="people-"] a').count()) === 200)
      check('index is not collapsed at 200', (await main.locator('[data-index-collapsed]').count()) === 0)
      check('long label is a link in the index', (await main.locator('[id^="people-"] a', { hasText: longLabel.label! }).count()) === 1)
      const upcomingText = await section('即将到来').innerText()
      check('lunar upcoming row shows the lunar date and its solar day', /农历.+·\s*\d+月\d+日/.test(upcomingText) && upcomingText.includes(lunarSoon.label!))
      const updated = await section('最近有新信息的人').locator('a[href*="claim-"]').allInnerTexts()
      check('recently updated never shows a sensitive placeholder as latest', updated.length > 0 && !updated.some((x) => x.startsWith('提供过')), { rows: updated.length })
      const importRows = await section('最近导入').locator('a[href^="/imports/"]').count()
      check('recent imports: at most 5 links to the result page', importRows > 0 && importRows <= 5, { importRows })
      const text = await main.innerText()
      check('no counts or badges (SPEC §9.3)', !/\d+\s*(个人|位|条新|项|条待)|待确认|未读/.test(text))
    })
    await shot('first-screen', { fullPage: false })
    await shot('full')

    await step('hero opens the search overlay', async () => {
      await main.getByRole('button', { name: /搜索人物、别名或信息/ }).click()
      const dialog = page.getByRole('dialog', { name: '搜索' })
      await dialog.waitFor()
      check('search overlay opened from the hero', await dialog.isVisible())
      await helpers.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
    })

    await step('letter navigation jumps to the group', async () => {
      await main.getByRole('navigation', { name: '按首字母跳转' }).getByRole('link', { name: 'L', exact: true }).click()
      await page.waitForTimeout(300)
      check('hash is #people-L', new URL(page.url()).hash === '#people-L')
      const top = await main.locator('#people-L').evaluate((el) => el.getBoundingClientRect().top)
      check('group L is below the sticky top bar', top >= 52 && top < 200, { top })
    })
    await shot('letter-jump', { fullPage: false })

    await step('loading-state', async () => {
      const un = await helpers.simulateLoading(HOME_API, 3000)
      await page.goto('/?devFail=all', { waitUntil: 'domcontentloaded' })
      await main.locator('[data-home-loading]').first().waitFor({ timeout: 5000 })
      check('hero renders while blocks load', await main.getByRole('button', { name: /搜索人物、别名或信息/ }).isVisible())
      await shot('loading', { fullPage: false })
      await main.locator('[id^="people-"]').first().waitFor({ timeout: 15_000 })
      check('blocks filled in after the delayed response', (await main.locator('[data-home-loading]').count()) === 0)
      await un()
    })

    await step('error-state', async () => {
      const un = await helpers.simulateError(HOME_API, { status: 500 })
      await page.goto('/?devFail=upcoming', { waitUntil: 'load' })
      const alert = section('即将到来').getByRole('alert')
      await alert.waitFor({ timeout: 15_000 })
      check('failing block shows BlockError', (await alert.innerText()).includes('这一块没有加载出来'))
      check('other blocks still render', (await main.locator('[id^="people-"] a').count()) === 200 && (await heading('关注的人').isVisible()))
      check('only one block is in error', (await main.getByRole('alert').count()) === 1)
      await shot('block-error', { fullPage: false })
      await un()
      await alert.getByRole('button', { name: '重试' }).click()
      await section('即将到来').locator('li').first().waitFor({ timeout: 15_000 })
      check('retry recovers the block', (await main.getByRole('alert').count()) === 0)
    })

    await step('variant: more than 200 people collapses to letters', async () => {
      await helpers.goto('/dev/home/showcase?variant=collapsed')
      check('collapsed index rendered', (await main.locator('[data-index-collapsed]').count()) === 1)
      check('no names listed while collapsed', (await main.locator('[id^="people-"] a').count()) === 0)
    })
    await shot('collapsed')
    await step('collapsed: open letter Z', async () => {
      await main.getByRole('navigation', { name: '按首字母查看' }).getByRole('button', { name: 'Z', exact: true }).click()
      check('group Z shown', (await main.locator('#people-Z a').count()) > 0)
      await page.evaluate('window.scrollTo(0, 0)')
    })
    await shot('collapsed-open')

    await step('variant: lunar + solar upcoming', async () => {
      await helpers.goto('/dev/home/showcase?variant=lunar')
      const t = await section('即将到来').innerText()
      check('today / tomorrow wording and a lunar row', t.includes('今天') && t.includes('明天') && t.includes('农历'), { t })
    })
    await shot('lunar', { fullPage: false })

    await step('variant: no upcoming dates hides the block', async () => {
      await helpers.goto('/dev/home/showcase?variant=no-upcoming')
      check('即将到来 hidden', (await heading('即将到来').count()) === 0)
    })
    await shot('no-upcoming', { fullPage: false })

    await step('variant: long content', async () => {
      await helpers.goto('/dev/home/showcase?variant=long')
      const overflow = await page.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth')
      check('no horizontal overflow with long content', overflow === false)
      // a wrapped line never starts with a " ·" separator (the dot glues to the piece before it)
      const lineStarts = await page.evaluate(`[...document.querySelectorAll('main [data-home-sep]')].filter((sep) => {
        const row = sep.closest('li').getBoundingClientRect()
        const rects = sep.getClientRects()
        return rects.length > 0 && rects[0].left - row.left < 2
      }).length`)
      const seps = await main.locator('[data-home-sep]').count()
      check('no line starts with a separator', seps > 0 && lineStarts === 0, { seps, lineStarts })
    })
    await shot('long')

    await step('variant: empty home with onboarding hint', async () => {
      await helpers.goto('/dev/home/showcase?variant=empty-onboarding')
      check('drop zone shown', await main.locator('[data-home-dropzone]').isVisible())
      check('onboarding hint links to /welcome', (await main.locator('a[href="/welcome"]').count()) === 1)
    })
    await shot('empty-onboarding')

    if (width === 1440) {
      await step('P3 page / (TTFB)', () => measure.page('P3 page / (TTFB)', '/'))
      await step('P3 GET /api/home (Server-Timing)', () => measure.api('P3 GET /api/home (Server-Timing)', '/api/home'))
    }
  },
})
