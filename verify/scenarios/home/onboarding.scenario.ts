import { defineScenario } from '~/verify/lib'

// First run (SPEC §9.12) on a fresh account (shared across widths): 1440 fills the display names and saves;
// 390 then sees them prefilled and skips (names kept). Both land on the empty home.
type Settings = { settings: { selfDisplayNames: string[]; onboardedAt: string | null } }

export default defineScenario({
  id: 'home/onboarding',
  description: '首次使用：注册后的引导页，保存 / 跳过，回到空首页',
  account: 'fresh',
  async run({ page, step, shot, check, helpers, api, width }) {
    const main = page.locator('main')
    const input = main.getByLabel('我在微信里的显示名')

    await step('welcome page', async () => {
      await helpers.goto('/welcome')
      await input.waitFor()
      check('display name field focused', await input.evaluate((el) => el === document.activeElement))
    })

    if (width === 1440) {
      await shot('welcome-blank', { fullPage: false })
      await step('fill and save', async () => {
        const before = await api.get<Settings>('/api/settings')
        check('fresh account is not onboarded', before.json?.settings.onboardedAt === null)
        await input.fill('小丽、丽丽')
        await shot('welcome-filled', { fullPage: false })
        await Promise.all([page.waitForURL((u) => u.pathname === '/', { timeout: 15_000 }), main.getByRole('button', { name: '保存', exact: true }).click()])
        await main.locator('[data-home-dropzone]').waitFor({ timeout: 15_000 })
        const after = await api.get<Settings>('/api/settings')
        check('names saved', JSON.stringify(after.json?.settings.selfDisplayNames) === JSON.stringify(['小丽', '丽丽']), after.json)
        check('onboarded', !!after.json?.settings.onboardedAt)
        check('empty home no longer shows the onboarding hint', (await main.locator('a[href="/welcome"]').count()) === 0)
      })
      await shot('after-save')
    } else {
      await step('prefilled; skip keeps the names', async () => {
        check('names prefilled', (await input.inputValue()) === '小丽、丽丽', { value: await input.inputValue() })
        await shot('welcome-prefilled', { fullPage: false })
        await Promise.all([page.waitForURL((u) => u.pathname === '/', { timeout: 15_000 }), main.getByRole('button', { name: '跳过', exact: true }).click()])
        await main.locator('[data-home-dropzone]').waitFor({ timeout: 15_000 })
        const after = await api.get<Settings>('/api/settings')
        check('skip keeps saved names', after.json?.settings.selfDisplayNames.length === 2, after.json)
        check('still onboarded', !!after.json?.settings.onboardedAt)
      })
      await shot('after-skip')
      await step('save with empty field asks to fill or skip', async () => {
        await helpers.goto('/welcome')
        await input.fill('   ')
        await main.getByRole('button', { name: '保存', exact: true }).click()
        const alert = main.getByRole('alert')
        await alert.waitFor()
        check('validation message', (await alert.innerText()).includes('先填写显示名'))
      })
      await shot('welcome-validation', { fullPage: false })
    }
  },
})
