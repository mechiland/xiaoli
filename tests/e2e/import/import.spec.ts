// Import e2e (ARCHITECTURE §12 wave-2 behaviour). Synthetic ZIPs, a fresh account per test, no jobs/next (no live LLM).
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { macExportSample } from '../../../src/lib/wechat-export/test-synthetic'

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'
const FIXTURES = path.resolve(process.cwd(), 'fixtures', 'synthetic')
const PRIVATE_1 = path.join(FIXTURES, '聊天记录_20260405_223012.zip')
const PRIVATE_2 = path.join(FIXTURES, '聊天记录_20260914_211545.zip')

async function freshAccount(page: Page, tag: string) {
  const email = `e2e-import-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@xiaoli.test`
  const res = await page.request.post(`${BASE}/api/auth/sign-up/email`, {
    data: { email, password: 'e2e-import-2026', name: 'e2e' },
    headers: { origin: BASE },
  })
  expect(res.status()).toBe(200)
  const settings = await page.request.patch(`${BASE}/api/settings`, { data: { selfDisplayNames: ['小满'], onboarded: true }, headers: { origin: BASE } })
  expect(settings.status()).toBe(200)
}

async function toStep2(page: Page, file: string): Promise<number> {
  await page.getByRole('button', { name: '导入', exact: true }).click()
  await page.setInputFiles('input[data-import-file]', file)
  const overlay = page.locator('[data-import-overlay]')
  await expect(page.locator('[data-import-overlay][data-step="preview"]')).toBeVisible({ timeout: 15_000 })
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/imports') && r.request().method() === 'POST'),
    overlay.getByRole('button', { name: '下一步' }).click(),
  ])
  expect(res.status()).toBe(201)
  await expect(page.locator('[data-import-overlay][data-step="mapping"]')).toBeVisible()
  return ((await res.json()) as { import: { id: number } }).import.id
}

test('Mac English ZIP → preview → mapping with linked photos and normalized dates', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await freshAccount(page, 'mac')
  await page.goto('/')
  await expect(page.getByText('Chat History_20260101_120000.zip', { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('mac-empty-home.png'), fullPage: true, caret: 'initial', animations: 'disabled' })
  const sample = macExportSample()
  await page.setInputFiles('input[data-home-file-input]', { name: sample.fileName, mimeType: 'application/zip', buffer: Buffer.from(sample.zip) })
  const overlay = page.locator('[data-import-overlay]')
  await expect(overlay).toHaveAttribute('data-step', 'preview', { timeout: 15_000 })
  await expect(overlay.getByText(sample.fileName, { exact: true })).toBeVisible()
  await expect(page.locator('#att-image')).toHaveAttribute('data-state', 'checked')
  await expect(page.locator('#att-video')).toHaveAttribute('data-state', 'unchecked')
  await expect(overlay.getByText('示例乙', { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('mac-preview.png'), fullPage: true, caret: 'initial', animations: 'disabled' })
  const [created] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/imports') && r.request().method() === 'POST'),
    overlay.getByRole('button', { name: '下一步' }).click(),
  ])
  expect(created.status()).toBe(201)
  const payload = created.request().postDataJSON()
  expect(payload.fileName).toBe(sample.fileName)
  expect(payload.exportedAt).toBe('2026-01-05T04:00:00.000Z')
  expect(payload.messages).toHaveLength(7)
  expect(payload.messages[0].sentAt).toBe('2026-01-05 08:03')
  expect(payload.messages[3].attachmentName).toBe(sample.imageName)
  expect(payload.selectedAttachments).toEqual([sample.imageName, sample.secondImageName])
  await expect(overlay).toHaveAttribute('data-step', 'mapping')
  const importId = (await created.json()).import.id
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await page.request.get(`${BASE}/api/imports/${importId}`)).status()).toBe(404)
  await page.setInputFiles('input[data-home-file-input]', { name: sample.fileName, mimeType: 'application/zip', buffer: Buffer.from('not a zip') })
  await expect(overlay.getByText('无法识别这个文件')).toBeVisible()
  await expect(overlay.getByText('Chat History_20260101_120000.zip', { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('mac-parse-error.png'), fullPage: true, caret: 'initial', animations: 'disabled' })
  expect(errors).toEqual([])
})

test('file → preview → 这是谁的聊天 → 开始 → /imports/:id with jobs and rising uploads', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await freshAccount(page, 'flow')
  await page.goto('/')

  const overlay = page.locator('[data-import-overlay]')
  await page.getByRole('button', { name: '导入', exact: true }).click()
  await page.setInputFiles('input[data-import-file]', PRIVATE_1)
  await expect(overlay.getByText('207')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('#att-image')).toHaveAttribute('data-state', 'checked')
  await expect(page.locator('#att-video')).toHaveAttribute('data-state', 'unchecked')

  const [created] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/imports') && r.request().method() === 'POST'),
    overlay.getByRole('button', { name: '下一步' }).click(),
  ])
  const importId = ((await created.json()) as { import: { id: number } }).import.id
  await expect(overlay.getByRole('radio', { name: '私聊' })).toHaveAttribute('aria-checked', 'true')
  await expect(overlay.locator('[data-sender-row="小满"]').getByText('设置里登记的我的显示名')).toBeVisible()
  const start = overlay.getByRole('button', { name: '开始', exact: true })
  await expect(start).toBeEnabled()

  const [mapped] = await Promise.all([page.waitForResponse((r) => r.url().includes(`/api/imports/${importId}/mapping`)), start.click()])
  expect(mapped.status()).toBe(200)
  await expect(page).toHaveURL(new RegExp(`/imports/${importId}$`), { timeout: 30_000 })
  await expect(overlay).toHaveCount(0)
  await expect(page.locator('h1')).toBeVisible()

  let last = -1
  await expect
    .poll(
      async () => {
        const d = (await (await page.request.get(`${BASE}/api/imports/${importId}`)).json()) as {
          progress: { total: number }
          uploads: { selected: number; uploaded: number }
          import: { status: string; newMessageCount: number }
        }
        expect(d.progress.total).toBeGreaterThan(0)
        expect(d.import.status).toBe('extracting')
        expect(d.import.newMessageCount).toBe(207)
        expect(d.uploads.uploaded).toBeGreaterThanOrEqual(last)
        last = d.uploads.uploaded
        return d.uploads.uploaded === d.uploads.selected && d.uploads.selected === 5
      },
      { timeout: 30_000, intervals: [200] },
    )
    .toBe(true)
  expect(errors).toEqual([])
})

test('duplicate file is refused with a link to the earlier import; a non-ZIP says 无法识别这个文件', async ({ page }) => {
  await freshAccount(page, 'dup')
  await page.goto('/')
  const importId = await toStep2(page, PRIVATE_2)
  const overlay = page.locator('[data-import-overlay]')
  await overlay.getByRole('button', { name: '开始', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/imports/${importId}$`), { timeout: 30_000 })

  await page.getByRole('button', { name: '导入', exact: true }).click()
  await page.setInputFiles('input[data-import-file]', PRIVATE_2)
  await expect(overlay.getByText('这份文件已经导入过')).toBeVisible({ timeout: 15_000 })
  await expect(overlay.getByRole('link', { name: '查看当时的导入结果' })).toHaveAttribute('href', `/imports/${importId}`)
  await expect(overlay.getByRole('button', { name: '下一步' })).toHaveCount(0)

  await page.setInputFiles('input[data-import-file]', { name: '聊天记录_20260915_000000.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') })
  await expect(overlay.getByText('无法识别这个文件')).toBeVisible()

  await page.request.delete(`${BASE}/api/imports/${importId}`, { headers: { origin: BASE } })
})

test('closing the overlay at step 2 deletes the import; dropping a file anywhere opens the overlay', async ({ page }) => {
  await freshAccount(page, 'abandon')
  await page.goto('/')
  const importId = await toStep2(page, PRIVATE_1)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-import-overlay]')).toHaveCount(0)
  await expect.poll(async () => (await page.request.get(`${BASE}/api/imports/${importId}`)).status(), { timeout: 10_000 }).toBe(404)

  // global drop layer: dragenter shows the veil, drop opens step 1 with the file
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer()
    d.items.add(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], '聊天记录_20260915_000001.zip', { type: 'application/zip' }))
    return d
  })
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt })
  await expect(page.getByText('松开以导入')).toBeVisible()
  await page.dispatchEvent('body', 'drop', { dataTransfer: dt })
  await expect(page.getByText('松开以导入')).toHaveCount(0)
  await expect(page.locator('[data-import-overlay]')).toBeVisible()
  await expect(page.locator('[data-import-overlay]').getByText('无法识别这个文件')).toBeVisible({ timeout: 15_000 })
})
