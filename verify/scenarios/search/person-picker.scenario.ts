import { defineScenario } from '~/verify/lib'

// Shared PersonPicker at /dev/search/person-picker: select variant (我 / 推荐 / 新建), search + keyboard pick,
// inline alias match, no results, loading, error, long list, narrow width.
export default defineScenario({
  id: 'search/person-picker',
  description: '人物选择器：推荐项、搜索、别名、键盘选择、没有找到、加载、错误、长列表、窄屏',
  account: 'seed',
  requiredTags: ['person:long-profile'],
  expectedFailures: [{ urlPattern: '/api/search', status: 500, step: 'error-state', consoleText: 'Failed to load resource' }],
  async run({ page, step, shot, check, helpers, seed }) {
    const long = await seed.person('long-profile')
    const row = page.locator('[data-sender="知夏"]')
    const trigger = row.getByRole('button').first()
    const popover = page.locator('[data-slot=popover-content]')
    const actually = page.locator('[data-demo=actually]')
    const merge = page.locator('[data-demo=merge]')

    await step('open showcase', async () => {
      await helpers.goto('/dev/search/person-picker')
      await actually.getByRole('option').first().waitFor({ timeout: 10_000 })
    })
    await shot('default')

    await step('select: open with 我 + 推荐 + 新建', async () => {
      await trigger.click()
      await popover.getByRole('combobox').waitFor()
      const texts = await popover.getByRole('option').allInnerTexts()
      check('first option is 我', texts[0]?.trim() === '我', { texts })
      check('candidate shows its reason', texts.some((t) => t.includes(long.label!) && t.includes('也叫这个名字')), { texts })
      check('last option is 新建人物『知夏』', texts[texts.length - 1]?.includes('新建人物『知夏』'), { texts })
    })
    await shot('select-open', { fullPage: false })

    await step('select: search and pick with the keyboard', async () => {
      await popover.getByRole('combobox').fill('邓')
      await popover.getByRole('option').filter({ hasText: '邓' }).nth(0).waitFor({ timeout: 8000 })
      await helpers.settle({ quietMs: 300 })
    })
    await shot('select-search', { fullPage: false })
    await step('select: ↓ Enter picks and closes', async () => {
      const texts = await popover.getByRole('option').allInnerTexts()
      const idx = texts.findIndex((t) => t.includes('邓') && !t.includes('新建'))
      for (let i = 0; i < idx; i++) await helpers.press('ArrowDown')
      const picked = texts[idx].split(/\s/)[0]
      await helpers.press('Enter')
      await popover.waitFor({ state: 'hidden' })
      const label = (await trigger.innerText()).trim()
      check('trigger shows the picked person', label.includes(picked), { label, picked })
    })
    await shot('select-picked', { fullPage: false })

    await step('select: Esc clears then closes', async () => {
      await trigger.click()
      await popover.getByRole('combobox').fill('林')
      await helpers.press('Escape')
      check('first Esc clears the query, popover stays', (await popover.getByRole('combobox').inputValue()) === '' && (await popover.isVisible()))
      await helpers.press('Escape')
      await popover.waitFor({ state: 'hidden' })
    })

    await step('inline: alias match', async () => {
      await actually.getByRole('combobox').fill('夏夏')
      await actually.getByRole('option').filter({ hasText: '又名' }).first().waitFor({ timeout: 8000 })
      await helpers.settle({ quietMs: 300 })
    })
    await shot('inline-alias')
    await step('inline: click picks', async () => {
      await actually.getByRole('option').filter({ hasText: '又名' }).first().click()
      check('picked value shown', (await page.getByTestId('actually-value').innerText()).includes('已有人物'))
    })

    await step('inline: no results', async () => {
      await merge.getByRole('combobox').fill('完全没有这个人')
      await merge.getByText('没有找到').waitFor({ timeout: 8000 })
    })
    await shot('inline-empty')

    await step('inline: long list', async () => {
      await merge.getByRole('combobox').fill('l')
      await merge.getByRole('option').nth(10).waitFor({ timeout: 8000 })
      for (let i = 0; i < 14; i++) await helpers.press('ArrowDown')
      await page.waitForTimeout(150)
      check('long list is scrollable and keeps the active row visible', await merge.locator('[role=option][data-active=true]').isVisible())
    })
    await shot('inline-long')

    await step('loading-state', async () => {
      const un = await helpers.simulateLoading(/\/api\/search\?/, 3000)
      await merge.getByRole('combobox').fill('孟')
      await merge.getByText('正在查找…').waitFor({ timeout: 3000 })
      await shot('loading')
      await merge.getByRole('option').first().waitFor({ timeout: 10_000 })
      await un()
    })

    await step('error-state', async () => {
      const un = await helpers.simulateError(/\/api\/search\?/, { status: 500 })
      await merge.getByRole('combobox').fill('闫')
      await merge.getByText('没有查到').waitFor({ timeout: 10_000 })
      await shot('error')
      await un()
    })
  },
})
