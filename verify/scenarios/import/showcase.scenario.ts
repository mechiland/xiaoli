import { defineScenario } from '@/verify/lib'
import { deleteImportOf, GROUP, importViaApi, PRIVATE_1, PRIVATE_2, SELF_NAME, stubJobsNext, waitFor } from './_support'

// Import overlay states (ARCHITECTURE §12 import/showcase): drop veil, step 1 pick / loading / preview / attachments,
// duplicate, parse error, step 2 with a recommended chat + picker, step 2 new group chat (long sender list),
// step 2 error, close at step 2 (import deleted), step 3 → /imports/:id, upload status line states.
// Fresh account per run: the setup import makes "duplicate" and "recommended chat" deterministic.
export default defineScenario({
  id: 'import/showcase',
  description: '导入浮层：拖放、预览、重复文件、无法识别、第二步推荐与新建、错误、第二步关闭、第三步',
  account: 'fresh',
  expectedFailures: [
    { urlPattern: '/mapping', status: 500, step: 'step 2: mapping fails', consoleText: 'Failed to load resource' },
    { urlPattern: '/api/imports/999002', status: 500, step: 'upload status samples', consoleText: 'Failed to load resource' },
    // PUTs start failing in step 3 (right after 开始) and keep failing until 重试 in the error step
    { urlPattern: '/attachments/', status: 500, consoleText: 'Failed to load resource' },
    // fake sample ids reach the real server only if a query refetches after the stubs are removed
    { urlPattern: /\/api\/imports\/99900\d/, status: 404, consoleText: 'Failed to load resource' },
    // the scenario polls GET /api/imports/:id until the abandoned import is gone
    { urlPattern: '/api/imports/', status: 404, step: 'close at step 2 → import deleted' },
  ],
  async run({ page, step, shot, check, helpers, api }) {
    const overlay = page.locator('[data-import-overlay]')
    const atStep = (s: string) => page.locator(`[data-import-overlay][data-step="${s}"]`)

    await step('setup: self display name + one finished import of the first private export', async () => {
      await api.patch('/api/settings', { selfDisplayNames: [SELF_NAME], onboarded: true })
      await deleteImportOf(api, PRIVATE_2)
      await importViaApi(api, PRIVATE_1, { title: '一舟', kind: 'private' })
      await helpers.goto('/')
    })

    await step('open overlay from the top bar', async () => {
      await page.getByRole('button', { name: '导入', exact: true }).click()
      await atStep('pick').waitFor()
    })
    await shot('step1-pick', { fullPage: false })

    await step('parse error: not a WeChat ZIP', async () => {
      await helpers.setInputFiles('input[data-import-file]', [{ name: '聊天记录_20260915_000000.zip', buffer: Buffer.from('这不是一个 zip 文件'), mimeType: 'application/zip' }])
      await atStep('parse_error').waitFor()
      check('parse error copy', await overlay.getByText('无法识别这个文件').isVisible())
    })
    await shot('parse-error', { fullPage: false })

    await step('duplicate: the file imported during setup', async () => {
      await helpers.setInputFiles('input[data-import-file]', [{ path: PRIVATE_1 }])
      await atStep('duplicate').waitFor()
      check('duplicate copy', await overlay.getByText('这份文件已经导入过').isVisible())
      check('link to the earlier import result', (await overlay.getByRole('link', { name: '查看当时的导入结果' }).getAttribute('href'))?.startsWith('/imports/') === true)
      check('cannot continue', (await overlay.getByRole('button', { name: '下一步' }).count()) === 0)
    })
    await shot('duplicate', { fullPage: false })

    await step('close overlay', async () => {
      await page.getByRole('button', { name: '关闭' }).click()
      await overlay.waitFor({ state: 'detached' })
    })

    await step('drag a ZIP over the page', async () => {
      await helpers.dragOver([{ path: PRIVATE_2 }])
      await page.locator('[data-drop-veil]').waitFor()
      check('veil copy', await page.getByText('松开以导入').isVisible())
    })
    await shot('drop-veil', { fullPage: false })

    const unroute = await helpers.simulateLoading('**/api/imports/check', 3000)
    await step('drop → parsing (loading)', async () => {
      await helpers.dropFiles([{ path: PRIVATE_2 }])
      check('veil gone after drop', (await page.locator('[data-drop-veil]').count()) === 0)
      await atStep('parsing').waitFor()
      await page.waitForTimeout(400)
    })
    await shot('step1-loading', { fullPage: false })
    await step('preview appears', async () => {
      await atStep('preview').waitFor({ timeout: 15_000 })
      await unroute()
      check('message count shown', await overlay.getByText('204').first().isVisible())
      check('focus is on the dialog, not on ×', await page.evaluate(() => document.activeElement?.hasAttribute('data-import-overlay') === true))
      const sizes = await overlay.locator('[data-attachment-bytes]').allInnerTexts()
      check('attachment groups show their total size, never "0 B"', sizes.length > 0 && sizes.every((t) => t.startsWith('共 ') && t !== '共 0 B'), sizes)
    })
    await shot('step1-preview', { fullPage: false })

    await step('attachments: images checked, video unchecked, per-item list', async () => {
      check('images group checked', (await page.locator('#att-image').getAttribute('data-state')) === 'checked')
      check('video group unchecked', (await page.locator('#att-video').getAttribute('data-state')) === 'unchecked')
      await overlay.getByRole('button', { name: '逐项调整' }).first().click()
      await overlay.locator('[data-slot="checkbox"]').nth(2).waitFor()
    })
    await shot('step1-attachments', { fullPage: false })

    let importId = 0
    await step('next → step 2 with the recommended chat', async () => {
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/imports') && r.request().method() === 'POST'),
        overlay.getByRole('button', { name: '下一步' }).click(),
      ])
      importId = ((await res.json()) as { import: { id: number } }).import.id
      await atStep('mapping').waitFor()
      await overlay.getByText('『一舟』在这个聊天里出现过').waitFor()
      check('recommended chat preselected', (await overlay.getByRole('radio', { name: /一舟/ }).first().getAttribute('aria-checked')) === 'true')
      check('self auto-selected from settings', await overlay.locator(`[data-sender-row="${SELF_NAME}"]`).getByText('设置里登记的我的显示名').isVisible())
      check('开始 enabled (all mapped)', await overlay.getByRole('button', { name: '开始', exact: true }).isEnabled())
    })
    await shot('step2-recommended', { fullPage: false })

    await step('step 2: sender picker open', async () => {
      await overlay.locator('[data-sender-row="一舟"] button').first().click()
      await page.locator('[data-radix-popper-content-wrapper]').waitFor()
      const pop = await page.locator('[data-radix-popper-content-wrapper] [role="listbox"]').boundingBox()
      const frame = await overlay.boundingBox()
      check('picker popover stays inside the overlay', !!pop && !!frame && pop.x >= frame.x - 0.5 && pop.x + pop.width <= frame.x + frame.width + 0.5, { pop, frame })
    })
    await shot('step2-picker', { fullPage: false })
    await step('close picker', () => helpers.press('Escape'))

    await step('step 2: mapping fails', async () => {
      const off = await helpers.simulateError('**/api/imports/*/mapping', { status: 500 })
      await overlay.getByRole('button', { name: '开始', exact: true }).click()
      await overlay.getByRole('alert').waitFor()
      check('error line', await overlay.getByText('没有开始成功').isVisible())
      check('still on step 2', (await atStep('mapping').count()) === 1)
      await off()
    })
    await shot('step2-error', { fullPage: false })

    await step('close at step 2 → import deleted', async () => {
      await page.getByRole('button', { name: '关闭' }).click()
      await overlay.waitFor({ state: 'detached' })
      const gone = await waitFor(async () => (await api.get(`/api/imports/${importId}`)).status === 404)
      check('abandoned import answers 404', gone, { importId })
    })
    await shot('closed-after-step2', { fullPage: false })

    await step('group export → step 2 new group chat (long sender list)', async () => {
      await page.getByRole('button', { name: '导入', exact: true }).click()
      await helpers.setInputFiles('input[data-import-file]', [{ path: GROUP }])
      await atStep('preview').waitFor({ timeout: 15_000 })
      await overlay.getByRole('button', { name: '下一步' }).click()
      await atStep('mapping').waitFor()
      check('new chat selected', (await overlay.getByRole('radio', { name: '新建聊天' }).getAttribute('aria-checked')) === 'true')
      check('group preselected', (await overlay.getByRole('radio', { name: '群聊' }).getAttribute('aria-checked')) === 'true')
      check('开始 disabled until every sender is chosen', await overlay.getByRole('button', { name: '开始', exact: true }).isDisabled())
      check('no chat recommended when the group shares only me', (await overlay.getByText('在这个聊天里出现过').count()) === 0)
    })
    await shot('step2-new-group', { fullPage: false })
    await step('scroll step 2 body to the end', async () => {
      await overlay.locator('[data-sender-row]').last().scrollIntoViewIfNeeded()
    })
    await shot('step2-new-group-bottom', { fullPage: false })
    await step('group: every sender picked, title still empty → the hint names the title', async () => {
      const unpicked = overlay.locator('[data-sender-row] button', { hasText: '选择是谁' })
      for (let guard = 0; guard < 30 && (await unpicked.count()) > 0; guard++) {
        await unpicked.first().click()
        await page.locator('[data-radix-popper-content-wrapper]').getByRole('option', { name: /^新建人物/ }).click()
        await page.locator('[data-radix-popper-content-wrapper]').waitFor({ state: 'detached' })
      }
      check('every sender picked', (await unpicked.count()) === 0)
      check('开始 still disabled (no title)', await overlay.getByRole('button', { name: '开始', exact: true }).isDisabled())
      check('hint asks for the title', (await overlay.locator('[data-start-hint]').innerText()) === '给新聊天起个名字')
      await overlay.locator('[data-start-hint]').scrollIntoViewIfNeeded()
    })
    await shot('step2-new-group-title-hint', { fullPage: false })
    await step('typing a title enables 开始', async () => {
      await overlay.getByPlaceholder(/聊天/).first().fill('家长群')
      check('开始 enabled', await overlay.getByRole('button', { name: '开始', exact: true }).isEnabled())
      check('hint gone', (await overlay.locator('[data-start-hint]').count()) === 0)
    })
    await step('close group import at step 2', async () => {
      await page.getByRole('button', { name: '关闭' }).click()
      await overlay.waitFor({ state: 'detached' })
    })

    let startedId = 0
    let failUploads: null | (() => Promise<void>) = null
    await step('step 3: start → /imports/:id', async () => {
      // start from the upload-status host so a client-side back shows this tab's upload runner (F5)
      await stubJobsNext(page)
      await helpers.goto('/dev/import/upload-status')
      failUploads = await helpers.simulateError('**/api/imports/*/attachments/**', { status: 500 })
      await page.getByRole('button', { name: '导入', exact: true }).click()
      await helpers.setInputFiles('input[data-import-file]', [{ path: PRIVATE_2 }])
      await atStep('preview').waitFor({ timeout: 15_000 })
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/imports') && r.request().method() === 'POST'),
        overlay.getByRole('button', { name: '下一步' }).click(),
      ])
      startedId = ((await res.json()) as { import: { id: number } }).import.id
      await atStep('mapping').waitFor()
      await overlay.getByRole('button', { name: '开始', exact: true }).click()
      await page.waitForURL((u) => u.pathname === `/imports/${startedId}`, { timeout: 30_000 })
      await overlay.waitFor({ state: 'detached' })
      await helpers.settle()
      const detail = await api.get<{ import: { status: string; newMessageCount: number }; progress: { total: number } }>(`/api/imports/${startedId}`)
      check('mapping done: extracting with jobs', detail.json?.import.status === 'extracting' && (detail.json?.progress.total ?? 0) > 0, detail.json)
      check('172 new messages (32 already stored)', detail.json?.import.newMessageCount === 172, detail.json?.import)
    })
    await shot('step3-result-page', { fullPage: false })

    await step('step 3: uploads fail → error line', async () => {
      await page.goBack()
      await page.waitForURL((u) => u.pathname === '/dev/import/upload-status')
      const line = page.locator(`[data-upload-sample="${startedId}"] [data-upload-phase="error"]`)
      await line.waitFor({ timeout: 60_000 })
      check('error copy', /没有上传成功/.test(await line.innerText()), await line.innerText())
      check('retry button', await line.getByRole('button', { name: '重试' }).isVisible())
      await line.scrollIntoViewIfNeeded()
    })
    await shot('upload-error', { fullPage: false })
    await step('重试 after the server recovers → uploaded', async () => {
      await failUploads?.()
      await page.locator(`[data-upload-sample="${startedId}"]`).getByRole('button', { name: '重试' }).click()
      await page.locator(`[data-upload-sample="${startedId}"] [data-upload-phase="done"]`).waitFor({ timeout: 30_000 })
    })

    await step('upload status samples', async () => {
      const detail = (pending: string[], selected: number, uploaded: number) => ({
        import: { id: 1, fileSha256: '0'.repeat(64) },
        uploads: { selected, uploaded, pendingNames: pending },
      })
      await helpers.stubJson('**/api/imports/999001', detail(['微信图片_202603221005_1.jpg', '微信图片_202603221005_2.jpg', '微信图片_202603221005_3.jpg'], 5, 2))
      await helpers.stubJson('**/api/imports/999003', detail([], 5, 5))
      await helpers.simulateError('**/api/imports/999002', { status: 500 })
      const live = await waitFor(async () => {
        const d = await api.get<{ uploads: { selected: number; uploaded: number } }>(`/api/imports/${startedId}`)
        return !!d.json && d.json.uploads.uploaded === d.json.uploads.selected
      })
      check('step-3 uploads finished on the server', live)
      await helpers.goto(`/dev/import/upload-status?id=999001,999003,999002,${startedId}`)
      await page.locator('[data-upload-phase="needs_file"]').waitFor()
      check('needs_file copy', await page.getByText('重新选择这份文件继续').isVisible())
      await page.locator('[data-upload-sample="999002"] [data-upload-phase="load_error"]').waitFor({ timeout: 15_000 })
      check('error sample shows its own inline error', await page.locator('[data-upload-sample="999002"]').getByText('上传状态没有加载出来').isVisible())
      check('done sample says 图片已上传', await page.locator('[data-upload-sample="999003"]').getByText('图片已上传').isVisible())
    })
    await shot('upload-status-lines')

    await step('cleanup: remove the step-3 import so the next width can run it again', async () => {
      await helpers.goto('/')
      await helpers.clearRoutes()
      if (startedId) await api.delete(`/api/imports/${startedId}`)
    })
  },
})
