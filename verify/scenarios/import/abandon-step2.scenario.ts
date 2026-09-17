import { defineScenario } from '~/verify/lib'
import { deleteImportOf, parseFixture, PRIVATE_2, SELF_NAME, waitFor } from './_support'

// F4 (ARCHITECTURE §10): closing the overlay at step 2 deletes the import; the same file can be imported again;
// a stale `mapping` import (tab closed mid-step-2) never blocks: check says no duplicate, a new POST replaces it.
export default defineScenario({
  id: 'import/abandon-step2',
  description: '第二步关闭浮层会删除导入；同一文件可以重新导入；遗留的 mapping 导入不挡路',
  account: 'fresh',
  expectedFailures: [
    { urlPattern: '/api/imports/', status: 404, step: 'close at step 2 → DELETE' },
    { urlPattern: '/api/imports/', status: 404, step: 'stale mapping import is replaced by a new POST' },
  ],
  async run({ page, step, shot, check, helpers, api }) {
    const overlay = page.locator('[data-import-overlay]')
    await step('setup', async () => {
      await api.patch('/api/settings', { selfDisplayNames: [SELF_NAME], onboarded: true })
      await deleteImportOf(api, PRIVATE_2)
      await helpers.goto('/')
    })

    let importId = 0
    await step('reach step 2', async () => {
      await page.getByRole('button', { name: '导入', exact: true }).click()
      await helpers.setInputFiles('input[data-import-file]', [{ path: PRIVATE_2 }])
      await page.locator('[data-import-overlay][data-step="preview"]').waitFor({ timeout: 15_000 })
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/imports') && r.request().method() === 'POST'),
        overlay.getByRole('button', { name: '下一步' }).click(),
      ])
      importId = ((await res.json()) as { import: { id: number } }).import.id
      await page.locator('[data-import-overlay][data-step="mapping"]').waitFor()
    })
    await shot('step2', { fullPage: false })

    await step('close at step 2 → DELETE', async () => {
      const del = page.waitForRequest((r) => r.method() === 'DELETE' && r.url().endsWith(`/api/imports/${importId}`))
      await helpers.press('Escape')
      await overlay.waitFor({ state: 'detached' })
      await del
      check('DELETE sent on close', true)
      const gone = await waitFor(async () => (await api.get(`/api/imports/${importId}`)).status === 404)
      check('import answers 404 after closing', gone, { importId })
    })
    await shot('closed', { fullPage: false })

    await step('same file again → preview, not duplicate', async () => {
      await page.getByRole('button', { name: '导入', exact: true }).click()
      await helpers.setInputFiles('input[data-import-file]', [{ path: PRIVATE_2 }])
      await page.locator('[data-import-overlay][data-step="preview"]').waitFor({ timeout: 15_000 })
      check('not reported as duplicate', (await overlay.getByText('这份文件已经导入过').count()) === 0)
    })
    await shot('reopened-preview', { fullPage: false })
    await step('close at preview (nothing created)', async () => {
      await page.getByRole('button', { name: '关闭' }).click()
      await overlay.waitFor({ state: 'detached' })
    })

    await step('stale mapping import is replaced by a new POST', async () => {
      const p = await parseFixture(PRIVATE_2)
      const body = { fileName: p.fileName, sha256: p.sha256, exportedAt: p.exportedAt, parserVersion: p.parserVersion, messages: p.messages, media: p.media, selectedAttachments: [] }
      const a = await api.post<{ import: { id: number } }>('/api/imports', body)
      check('first POST 201', a.status === 201)
      const c = await api.post<{ duplicate: boolean }>('/api/imports/check', { sha256: p.sha256 })
      check('check ignores the mapping import', c.json?.duplicate === false)
      const b = await api.post<{ import: { id: number } }>('/api/imports', body)
      check('second POST 201 with a new id', b.status === 201 && b.json?.import.id !== a.json?.import.id)
      check('old import 404', (await api.get(`/api/imports/${a.json?.import.id}`)).status === 404)
      if (b.json) await api.delete(`/api/imports/${b.json.import.id}`)
    })
  },
})
