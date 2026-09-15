import { defineScenario } from '@/verify/lib'
import type { Dump } from './_support'

// Settings page states (SPEC §9.11, ARCHITECTURE §12 showcase): filled, saving, saved, name/threshold validation,
// empty display names, long content, password validation (client + wrong current password), delete-all dialog with
// wrong and right text (never executed), export download, loading (3 s), block error (GET /api/settings 500), 390.
// Fresh throwaway account: the seed account's settings are read by other modules' screenshots, so we never PATCH them.
const LONG = [
  '小满',
  'Xiaoman Chen（工作号，请勿在周末联系）',
  '满满满满满满满满满满满满满满满满满满满满满满满满满满满满满满满满满满满满满满满',
  '陈小满-2019年以前用的名字',
  'xiaoman_chen_1990_official_account_abcd',
]

export default defineScenario({
  id: 'settings/showcase',
  description: '设置页：已填写、保存中、校验错误、显示名为空、长内容、改密码校验、删除全部数据对话框（错误与正确的确认文字，不执行）、导出、加载中、区块出错',
  account: 'fresh',
  expectedFailures: [
    { urlPattern: '/api/settings', status: 500, step: 'block error: GET /api/settings 500', consoleText: 'Failed to load resource' },
    { urlPattern: '/api/auth/change-password', status: 400, step: 'password: wrong current password', consoleText: 'Failed to load resource' },
  ],
  async run({ page, step, shot, check, helpers, api, width }) {
    const block = (name: string) => page.locator(`[data-settings-block="${name}"]`)
    const noHorizontalOverflow = async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    /** screenshot the viewport with `selector` scrolled just below the sticky top bar */
    const viewShot = async (name: string, selector: string) => {
      await page.locator(selector).first().evaluate((node) => {
        // start at the section heading, not the block, so the sticky top bar never covers the title
        const el = node.closest('section') ?? node
        const top = el.getBoundingClientRect().top + window.scrollY - 72
        window.scrollTo(0, Math.max(0, top))
      })
      return shot(name, { fullPage: false, settleMs: 250 })
    }

    await step('setup: filled settings', async () => {
      const r = await api.patch('/api/settings', { selfDisplayNames: ['小满', 'Xiaoman', '满满（工作号）'], extractModel: 'deepseek-v4-pro', highConfidenceThreshold: 0.85, onboarded: true })
      check('PATCH /api/settings 200', r.status === 200, { status: r.status })
    })

    await step('open /settings (filled)', async () => {
      await helpers.goto('/settings', { waitFor: '[data-self-names]' })
      check('title 设置', await page.getByRole('heading', { level: 1, name: '设置' }).isVisible())
      for (const s of ['我', '抽取', '数据', '账户']) check(`section ${s}`, await page.getByRole('heading', { level: 2, name: s, exact: true }).isVisible())
      check('3 names listed', (await page.locator('[data-self-names] li').count()) === 3)
      check('model shows deepseek-v4-pro', (await page.locator('#extract-model').innerText()).includes('deepseek-v4-pro'))
      check('threshold 0.85', (await page.locator('#high-confidence').inputValue()) === '0.85')
      check('恢复默认 offered for a non-default threshold', await block('extract').getByRole('button', { name: '恢复默认' }).isVisible())
      check('email shown', (await page.locator('[data-account-email]').innerText()).includes('@xiaoli.test'))
      check('no horizontal overflow', await noHorizontalOverflow())
      check('no toast / badge elements', (await page.locator('[data-sonner-toaster], [role="status"][data-toast], .badge').count()) === 0)
    })
    await shot('filled')

    await step('model select open', async () => {
      await page.locator('#extract-model').click()
      await page.getByRole('option', { name: '默认（deepseek-flash）' }).waitFor()
      check('options: 默认 + v4-pro', (await page.getByRole('option').allInnerTexts()).join('|') === '默认（deepseek-flash）|deepseek-v4-pro')
    })
    await viewShot('model-select-open', '[data-settings-block="extract"]')

    await step('model → 默认 saves null', async () => {
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/settings') && r.request().method() === 'PATCH'),
        page.getByRole('option', { name: '默认（deepseek-flash）' }).click(),
      ])
      check('PATCH body extractModel null', (res.request().postDataJSON() as { extractModel?: unknown }).extractModel === null)
      await block('extract').locator('[data-save-state="saved"]').first().waitFor()
      check('trigger shows 默认（deepseek-flash）', (await page.locator('#extract-model').innerText()).includes('默认（deepseek-flash）'))
    })

    const unrouteSave = await helpers.simulateLoading(/\/api\/settings$/, 3000)
    await step('add a name → saving (PATCH delayed 3 s)', async () => {
      await page.locator('#self-name-input').fill('阿满')
      await page.locator('#self-name-input').press('Enter')
      await block('self').locator('[data-save-state="saving"]').waitFor()
      check('new name appears immediately', await page.locator('[data-self-names]').getByText('阿满', { exact: true }).isVisible())
      check('input cleared', (await page.locator('#self-name-input').inputValue()) === '')
    })
    await viewShot('saving', '[data-settings-block="self"]')
    await step('saved → quiet note', async () => {
      await block('self').locator('[data-save-state="saved"]').waitFor({ timeout: 8000 })
      check('已保存 text', await block('self').getByText('已保存').isVisible())
      await unrouteSave()
      const s = await api.get<{ settings: { selfDisplayNames: string[] } }>('/api/settings')
      check('server has 4 names', s.json?.settings.selfDisplayNames.length === 4, s.json)
    })
    await viewShot('saved', '[data-settings-block="self"]')

    await step('name validation: duplicate', async () => {
      await page.locator('#self-name-input').fill('小满')
      await page.locator('#self-name-input').press('Enter')
      await page.locator('#self-name-error').waitFor()
      check('duplicate message', (await page.locator('#self-name-error').innerText()) === '这个名字已经登记过了')
      check('input aria-invalid', (await page.locator('#self-name-input').getAttribute('aria-invalid')) === 'true')
    })
    await step('threshold validation: 1.5', async () => {
      await page.locator('#high-confidence').fill('1.5')
      await page.locator('#high-confidence').press('Enter')
      await page.locator('#high-confidence-error').waitFor()
      check('threshold message', (await page.locator('#high-confidence-error').innerText()) === '请填 0.5 到 1 之间的数')
      const s = await api.get<{ settings: { highConfidenceThreshold: number } }>('/api/settings')
      check('nothing saved', s.json?.settings.highConfidenceThreshold === 0.85, s.json)
    })
    await viewShot('validation-errors', '[data-settings-block="self"]')
    await step('threshold 0.9 saves', async () => {
      await page.locator('#high-confidence').fill('0.9')
      await page.locator('#high-confidence').blur()
      await block('extract').locator('[data-save-state="saved"]').last().waitFor()
      const s = await api.get<{ settings: { highConfidenceThreshold: number } }>('/api/settings')
      check('saved 0.9', s.json?.settings.highConfidenceThreshold === 0.9, s.json)
      await page.locator('#self-name-input').fill('')
    })

    await step('password: client validation (mismatch)', async () => {
      await page.locator('#current-password').fill('whatever-1')
      await page.locator('#new-password').fill('new-password-1')
      await page.locator('#repeat-password').fill('new-password-2')
      await page.getByRole('button', { name: '修改密码' }).click()
      await block('account').getByRole('alert').waitFor()
      check('mismatch message', await block('account').getByText('两次输入的新密码不一样').isVisible())
    })
    await viewShot('password-validation', '[data-password-form]')
    await step('password: wrong current password', async () => {
      await page.locator('#current-password').fill('definitely-wrong-1')
      await page.locator('#repeat-password').fill('new-password-1')
      await page.getByRole('button', { name: '修改密码' }).click()
      await block('account').getByText('当前密码不对').waitFor()
      check('server error mapped to 当前密码不对', true)
      await page.locator('#current-password').fill('')
      await page.locator('#new-password').fill('')
      await page.locator('#repeat-password').fill('')
    })

    await step('export downloads a JSON dump', async () => {
      const [download] = await Promise.all([page.waitForEvent('download'), block('data').getByRole('button', { name: '导出为 JSON' }).click()])
      const name = download.suggestedFilename()
      check('file name', /^xiaoli-export-\d{8}\.json$/.test(name), name)
      const path = await download.path()
      const { readFileSync } = await import('node:fs')
      const dump = JSON.parse(readFileSync(path, 'utf8')) as Dump
      check('dump version 1 with settings', dump.version === 1 && dump.settings.selfDisplayNames.includes('阿满'), dump.settings)
      await block('data').getByText(`已下载 ${name}`).waitFor()
    })

    await step('delete-all dialog: wrong text', async () => {
      await block('data').getByRole('button', { name: '删除全部数据…' }).click()
      const dialog = page.locator('[data-delete-all-dialog]')
      await dialog.waitFor()
      await page.locator('#delete-all-confirm').fill('删除全部')
      check('confirm disabled', await dialog.getByRole('button', { name: '删除全部数据', exact: true }).isDisabled())
      check('mismatch hint', (await dialog.locator('[data-confirm-state]').getAttribute('data-confirm-state')) === 'mismatch')
    })
    await shot('delete-dialog-wrong', { fullPage: false })
    await step('delete-all dialog: right text (not executed)', async () => {
      const dialog = page.locator('[data-delete-all-dialog]')
      await page.locator('#delete-all-confirm').fill('删除全部数据')
      check('confirm enabled', await dialog.getByRole('button', { name: '删除全部数据', exact: true }).isEnabled())
      check('match hint', (await dialog.locator('[data-confirm-state]').getAttribute('data-confirm-state')) === 'match')
    })
    await shot('delete-dialog-right', { fullPage: false })
    await step('cancel keeps data', async () => {
      await page.locator('[data-delete-all-dialog]').getByRole('button', { name: '取消' }).click()
      await page.locator('[data-delete-all-dialog]').waitFor({ state: 'detached' })
      const s = await api.get<{ settings: { selfDisplayNames: string[] } }>('/api/settings')
      check('names still there', (s.json?.settings.selfDisplayNames.length ?? 0) === 4, s.json)
      await block('data').getByRole('button', { name: '删除全部数据…' }).click()
      check('reopened dialog input is empty', (await page.locator('#delete-all-confirm').inputValue()) === '')
      await page.keyboard.press('Escape')
      await page.locator('[data-delete-all-dialog]').waitFor({ state: 'detached' })
    })

    await step('empty display names', async () => {
      await api.patch('/api/settings', { selfDisplayNames: [], extractModel: null, highConfidenceThreshold: 0.8 })
      await helpers.goto('/settings', { waitFor: '[data-self-names-empty]' })
      check('empty copy', await page.getByText('还没有登记。导入时需要手动指出哪位发送者是你。').isVisible())
      check('no 恢复默认 at the default threshold', (await block('extract').getByRole('button', { name: '恢复默认' }).count()) === 0)
    })
    await shot('empty')

    await step('long content', async () => {
      await api.patch('/api/settings', { selfDisplayNames: [...LONG, '小满2', '小满3', '小满4', '小满5', '小满6'] })
      await helpers.goto('/settings', { waitFor: '[data-self-names]' })
      check('10 names listed', (await page.locator('[data-self-names] li').count()) === 10)
      check('input disabled at 10', await page.locator('#self-name-input').isDisabled())
      check('no horizontal overflow', await noHorizontalOverflow())
    })
    await viewShot('long-names', '[data-settings-block="self"]')

    await step('loading (GET /api/settings and /api/me delayed 3 s)', async () => {
      const off1 = await helpers.simulateLoading(/\/api\/settings$/, 3000)
      const off2 = await helpers.simulateLoading(/\/api\/me$/, 3000)
      await page.goto('/settings', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-settings-block="extract"][aria-busy="true"]').waitFor()
      check('data block usable while loading', await block('data').getByRole('button', { name: '导出为 JSON' }).isEnabled())
      await page.waitForTimeout(500)
      await shot('loading', { fullPage: false, settleMs: 0 })
      await page.locator('[data-self-names]').waitFor({ timeout: 10_000 })
      await off1()
      await off2()
    })

    await step('block error: GET /api/settings 500', async () => {
      const off = await helpers.simulateError(/\/api\/settings$/, { status: 500 })
      await page.goto('/settings', { waitUntil: 'domcontentloaded' })
      await page.locator('section.settings-block [role="alert"]').nth(1).waitFor({ timeout: 15_000 })
      check('我 and 抽取 show BlockError', (await page.locator('section.settings-block [role="alert"]').count()) === 2)
      check('数据 still renders', await block('data').getByRole('button', { name: '导出为 JSON' }).isVisible())
      check('账户 still renders', await page.locator('[data-account-email]').isVisible())
      check('title still renders', await page.getByRole('heading', { level: 1, name: '设置' }).isVisible())
      await off()
    })
    await shot('block-error', { fullPage: width < 640 })
    await step('retry recovers', async () => {
      await page.locator('section.settings-block [role="alert"]').first().getByRole('button', { name: '重试' }).click()
      await page.locator('[data-self-names]').waitFor({ timeout: 10_000 })
      check('names back after retry', (await page.locator('[data-self-names] li').count()) === 10)
    })
  },
})
