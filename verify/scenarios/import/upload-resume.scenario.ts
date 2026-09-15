import { defineScenario } from '@/verify/lib'
import { deleteImportOf, PRIVATE_1, PRIVATE_2, SELF_NAME, waitFor } from './_support'

// F5 (ARCHITECTURE §10): attachment uploads survive client-side navigation (count keeps rising), a reload shows
// "还没有上传 · 重新选择这份文件继续", a different file is refused, the same file finishes the queue.
// The status line is hosted on /dev/import/upload-status until import-result (wave 3) mounts it on /imports/:id.
export default defineScenario({
  id: 'import/upload-resume',
  description: '附件上传：离开再回来继续、刷新后提示重新选择文件、选错文件、续传完成',
  account: 'fresh',
  async run({ page, step, shot, check, helpers, api }) {
    const overlay = page.locator('[data-import-overlay]')
    const host = '/dev/import/upload-status'
    const uploaded = async (id: number) => (await api.get<{ uploads: { selected: number; uploaded: number } }>(`/api/imports/${id}`)).json!.uploads

    await step('setup', async () => {
      await api.patch('/api/settings', { selfDisplayNames: [SELF_NAME], onboarded: true })
      await deleteImportOf(api, PRIVATE_1)
      await helpers.goto(host)
    })

    // every PUT takes ≥ 2.5 s, so uploads are still running when we look
    const slow = await helpers.simulateLoading('**/api/imports/*/attachments/**', 2500)
    let importId = 0
    await step('import with 5 selected images → /imports/:id', async () => {
      await page.getByRole('button', { name: '导入', exact: true }).click()
      await helpers.setInputFiles('input[data-import-file]', [{ path: PRIVATE_1 }])
      await page.locator('[data-import-overlay][data-step="preview"]').waitFor({ timeout: 15_000 })
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/imports') && r.request().method() === 'POST'),
        overlay.getByRole('button', { name: '下一步' }).click(),
      ])
      importId = ((await res.json()) as { import: { id: number } }).import.id
      await page.locator('[data-import-overlay][data-step="mapping"]').waitFor()
      await overlay.getByRole('button', { name: '开始', exact: true }).click()
      await page.waitForURL((u) => u.pathname === `/imports/${importId}`, { timeout: 30_000 })
    })

    await step('navigate back (client-side) → upload still running', async () => {
      await page.goBack()
      await page.waitForURL((u) => u.pathname === host)
      await page.locator(`[data-upload-sample="${importId}"] [data-upload-phase="uploading"]`).waitFor({ timeout: 10_000 })
      check('line says 正在上传图片', await page.getByText('正在上传图片').isVisible())
    })
    await shot('uploading-after-navigation', { fullPage: false })

    await step('count rises on the server while the page is away from /imports/:id', async () => {
      const seen: number[] = []
      const rose = await waitFor(async () => {
        const u = await uploaded(importId)
        seen.push(u.uploaded)
        return u.uploaded >= 2
      }, 20_000, 300)
      check('uploaded count reached 2', rose, { seen })
      check('never decreases', seen.every((n, i) => i === 0 || n >= seen[i - 1]), { seen })
    })

    await step('reload mid-upload → needs the file again', async () => {
      await helpers.goto(`${host}?id=${importId}`)
      await page.locator('[data-upload-phase="needs_file"]').waitFor({ timeout: 15_000 })
      const u = await uploaded(importId)
      check('some images still pending on the server', u.uploaded < u.selected, u)
      check('line says 还没有上传', await page.getByText(/还没有上传/).isVisible())
    })
    await shot('reload-needs-file', { fullPage: false })
    await slow()

    await step('wrong file is refused', async () => {
      await helpers.setInputFiles('input[data-upload-resume-input]', [{ path: PRIVATE_2 }])
      await page.getByText('这不是同一份文件').waitFor({ timeout: 10_000 })
    })
    await shot('resume-wrong-file', { fullPage: false })

    await step('same file → uploads complete', async () => {
      await helpers.setInputFiles('input[data-upload-resume-input]', [{ path: PRIVATE_1 }])
      await page.locator('[data-upload-phase="done"]').waitFor({ timeout: 20_000 })
      const u = await uploaded(importId)
      check('all selected images uploaded', u.uploaded === u.selected && u.selected === 5, u)
      check('line says 图片已上传', await page.getByText('图片已上传').isVisible())
    })
    await shot('resumed-done', { fullPage: false })

    await step('cleanup', async () => {
      if (importId) await api.delete(`/api/imports/${importId}`)
    })
  },
})
