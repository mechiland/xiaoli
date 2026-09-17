import path from 'node:path'
import { defineScenario } from '~/verify/lib'

// Empty account (SPEC §9.12): drop zone instead of the search box, drag-over state, drop and "选择文件" open the import
// overlay with the file (closed at the preview step: nothing is created), onboarding page and its inline error.
const ZIP = path.join(process.cwd(), 'fixtures/synthetic/聊天记录_20260405_223012.zip')

export default defineScenario({
  id: 'home/empty',
  description: '空状态：拖放区、拖入状态、拖放/选择文件唤起导入浮层、首次使用引导页',
  account: 'empty',
  expectedFailures: [{ urlPattern: '/api/settings', status: 500, step: 'welcome error', consoleText: 'Failed to load resource' }],
  async run({ page, step, shot, check, helpers, api }) {
    const main = page.locator('main')
    const zone = main.locator('[data-home-dropzone]')

    await step('empty home', async () => {
      const s = await api.get<{ settings: { onboardedAt: string | null } }>('/api/settings')
      check('account is not onboarded (seed state)', s.json?.settings.onboardedAt === null)
      await helpers.goto('/')
      check('drop zone replaces the search box', (await zone.isVisible()) && (await main.getByRole('button', { name: /搜索人物、别名或信息/ }).count()) === 0)
      check('export steps explained', (await zone.innerText()).includes('其他应用') && (await zone.innerText()).includes('保存到文件'))
      check('"选择文件" button', await zone.getByRole('button', { name: '选择文件' }).isVisible())
      check('no other home blocks', (await main.getByRole('heading', { name: '全部人物' }).count()) === 0)
    })
    await shot('empty')

    await step('drag over the drop zone', async () => {
      await helpers.dragOver([{ path: ZIP }], { target: '[data-home-dropzone]' })
      await page.waitForTimeout(150)
      check('zone shows drag-over state', (await zone.getAttribute('data-dragging')) === 'true')
      check('zone says 松开以导入', (await zone.innerText()).includes('松开以导入'))
      check('window veil not stacked on top', (await page.locator('[data-drop-veil]').count()) === 0)
    })
    await shot('drag-over', { fullPage: false })

    await step('drop opens the import overlay with the file', async () => {
      await page.dispatchEvent('[data-home-dropzone]', 'dragleave')
      await helpers.dropFiles([{ path: ZIP }], { target: '[data-home-dropzone]' })
      const dialog = page.getByRole('dialog')
      await dialog.waitFor({ timeout: 15_000 })
      await dialog.getByText(/条消息|消息/).first().waitFor({ timeout: 15_000 })
      check('overlay opened with the dropped file', await dialog.isVisible())
      check('zone left drag-over state', (await zone.getAttribute('data-dragging')) === 'false')
    })
    await shot('dropped', { fullPage: false })
    await step('close overlay at preview', async () => {
      await helpers.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 5000 })
    })

    await step('选择文件 opens the overlay', async () => {
      await helpers.setInputFiles('[data-home-file-input]', [{ path: ZIP }])
      const dialog = page.getByRole('dialog')
      await dialog.waitFor({ timeout: 15_000 })
      check('overlay opened from the file input', await dialog.isVisible())
      await helpers.press('Escape')
      await dialog.waitFor({ state: 'hidden', timeout: 5000 })
      const imports = await api.get<{ recentImports: unknown[]; isEmpty: boolean }>('/api/home')
      check('nothing was imported', imports.json?.isEmpty === true)
    })

    await step('onboarding page', async () => {
      await helpers.goto('/welcome')
      check('asks for the WeChat display name', await main.getByLabel('我在微信里的显示名').isVisible())
      check('says it can be skipped', (await main.innerText()).includes('可以跳过') && (await main.getByRole('button', { name: '跳过' }).isVisible()))
    })
    await shot('welcome')

    await step('welcome error', async () => {
      const un = await helpers.simulateError(/\/api\/settings$/, { status: 500 })
      await main.getByLabel('我在微信里的显示名').fill('小丽')
      await main.getByRole('button', { name: '保存', exact: true }).click()
      await main.getByRole('alert').waitFor({ timeout: 10_000 })
      check('inline error, still on /welcome', new URL(page.url()).pathname === '/welcome')
      await shot('welcome-error', { fullPage: false })
      await un()
      const s = await api.get<{ settings: { onboardedAt: string | null } }>('/api/settings')
      check('account still not onboarded', s.json?.settings.onboardedAt === null)
    })
  },
})
