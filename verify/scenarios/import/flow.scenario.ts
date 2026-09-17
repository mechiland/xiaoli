import { defineScenario } from '@/verify/lib'
import { deleteImportOf, PRIVATE_1, SELF_NAME, stubJobsNext, waitFor } from './_support'

// Wave-2 import flow (ARCHITECTURE §12): top bar 导入 → choose file → preview → step 2 → 开始 → /imports/:id.
// Asserts mapping 200, URL = importHref(id), placeholder page renders, progress.total > 0, uploads rising to done.
// Does not call jobs/next (no live LLM in UI tests).
export default defineScenario({
  id: 'import/flow',
  description: '导入完整流程（新账号，合成私聊）：预览 → 这是谁的聊天 → 开始 → 导入结果页，附件上传完成',
  account: 'fresh',
  async run({ page, step, shot, check, helpers, api }) {
    const overlay = page.locator('[data-import-overlay]')
    await step('setup', async () => {
      await api.patch('/api/settings', { selfDisplayNames: [SELF_NAME], onboarded: true })
      await stubJobsNext(page)
      await deleteImportOf(api, PRIVATE_1)
      await helpers.goto('/')
    })

    await step('choose file', async () => {
      await page.getByRole('button', { name: '导入', exact: true }).click()
      await helpers.setInputFiles('input[data-import-file]', [{ path: PRIVATE_1 }])
      await page.locator('[data-import-overlay][data-step="preview"]').waitFor({ timeout: 15_000 })
    })
    await shot('preview', { fullPage: false })

    let importId = 0
    await step('next', async () => {
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/imports') && r.request().method() === 'POST'),
        overlay.getByRole('button', { name: '下一步' }).click(),
      ])
      check('POST /api/imports 201', res.status() === 201)
      importId = ((await res.json()) as { import: { id: number } }).import.id
      await page.locator('[data-import-overlay][data-step="mapping"]').waitFor()
      check('chat choice: exactly one radio checked', (await overlay.locator('[data-chat-choice] [role="radio"][aria-checked="true"]').count()) === 1)
      check('private preselected for two senders',(await overlay.getByRole('radio', { name: '私聊' }).getAttribute('aria-checked')) === 'true')
      check('chat title defaults to the other sender', (await overlay.getByLabel('聊天名称').inputValue()) === '一舟')
    })
    await shot('mapping', { fullPage: false })

    await step('开始 → result page', async () => {
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().includes(`/api/imports/${importId}/mapping`)),
        overlay.getByRole('button', { name: '开始', exact: true }).click(),
      ])
      check('mapping 200', res.status() === 200, { status: res.status() })
      await page.waitForURL((u) => u.pathname === `/imports/${importId}`, { timeout: 30_000 })
      await overlay.waitFor({ state: 'detached' })
      await helpers.settle()
      check('result page placeholder renders', await page.locator('h1').first().isVisible())
    })
    await shot('result-page', { fullPage: false })

    await step('server: jobs created, uploads rising to done', async () => {
      type Detail = { progress: { total: number }; uploads: { selected: number; uploaded: number }; import: { newMessageCount: number } }
      const seen: number[] = []
      const box: { detail: Detail | null } = { detail: null }
      const done = await waitFor(async () => {
        const d = await api.get<Detail>(`/api/imports/${importId}`)
        box.detail = d.json
        if (d.json) seen.push(d.json.uploads.uploaded)
        return !!d.json && d.json.uploads.uploaded === d.json.uploads.selected
      }, 30_000, 100)
      const detail = box.detail
      check('progress.total > 0', (detail?.progress.total ?? 0) > 0, detail?.progress)
      check('207 new messages', detail?.import.newMessageCount === 207)
      check('5 selected images all uploaded', done && detail?.uploads.selected === 5, { seen })
      check('uploaded count never decreases', seen.every((n, i) => i === 0 || n >= seen[i - 1]), { seen })
    })

    await step('cleanup', async () => {
      // leave the result page first: its loop would otherwise 404 against the deleted import
      await helpers.goto('/')
      if (importId) await api.delete(`/api/imports/${importId}`)
    })
  },
})
