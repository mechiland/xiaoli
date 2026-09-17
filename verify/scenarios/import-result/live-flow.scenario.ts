import path from 'node:path'
import type { ImportReviewResponse } from '@/contracts'
import { defineScenario } from '~/verify/lib'

// The one real end-to-end run (LIVE LLM): a throwaway account imports the smallest synthetic eval ZIP (178 messages)
// through the overlay, the result page drives extraction through jobs/next, then confirm / reject / edit / section
// confirm / merge, reload to prove persistence, and finally delete the import from the page (F7 on real items).
// Costs real tokens, so it only runs with XIAOLI_LIVE_LLM=1 (check `pnpm llm:usage` first). Otherwise it records a
// note and passes without touching anything.
const ZIP = path.resolve(process.cwd(), 'fixtures', 'synthetic', '聊天记录_20260910_183020.zip')
const SELF = '小满'
const CHAT_TITLE = '三年二班家长群'

type Review = ImportReviewResponse
const itemsOf = (s: Review['sections'][number]) => [...s.newClaims, ...s.changes, ...s.aliasesAndRelations, ...s.dates, ...s.events]

export default defineScenario({
  id: 'import-result/live-flow',
  description: '真实端到端（需 XIAOLI_LIVE_LLM=1，调用真实模型）：新账号经导入浮层导入最小的合成 ZIP，结果页推进抽取并逐步出现条目，确认/不对/改写/本节确认/合并，刷新后仍在，最后删除这次导入',
  account: 'fresh',
  widths: [1440],
  trace: false,
  // after the delete the scenario probes the deleted import and its claims on purpose (404 = gone)
  expectedFailures: [
    { urlPattern: /\/api\/imports\/\d+$/, status: 404, step: 'delete this import from the page' },
    { urlPattern: /\/api\/evidence\/claim\/\d+/, status: 404, step: 'delete this import from the page' },
  ],
  async run({ page, step, shot, check, helpers, api, log }) {
    if (process.env.XIAOLI_LIVE_LLM !== '1') {
      log('skipped: set XIAOLI_LIVE_LLM=1 to run the live extraction flow (uses the LLM budget)')
      return
    }
    const overlay = page.locator('[data-import-overlay]')
    let importId = 0

    await step('setup', async () => {
      await api.patch('/api/settings', { selfDisplayNames: [SELF], onboarded: true })
      await helpers.goto('/')
    })

    await step('overlay: preview', async () => {
      await page.getByRole('button', { name: '导入', exact: true }).click()
      await helpers.setInputFiles('input[data-import-file]', [{ path: ZIP }])
      await page.locator('[data-import-overlay][data-step="preview"]').waitFor({ timeout: 20_000 })
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/imports') && r.request().method() === 'POST'),
        overlay.getByRole('button', { name: '下一步' }).click(),
      ])
      check('POST /api/imports 201', res.status() === 201)
      importId = ((await res.json()) as { import: { id: number } }).import.id
      await page.locator('[data-import-overlay][data-step="mapping"]').waitFor()
    })

    await step('overlay: who is who', async () => {
      await overlay.getByLabel('聊天名称').fill(CHAT_TITLE)
      const rows = overlay.locator('[data-sender-row]')
      for (let i = 0; i < (await rows.count()); i++) {
        const row = rows.nth(i)
        const name = (await row.getAttribute('data-sender-row')) ?? ''
        const trigger = row.locator('button[aria-haspopup="listbox"]')
        if (name === SELF || (await trigger.textContent())?.trim() !== '选择是谁') continue
        await trigger.click()
        await page.getByRole('option', { name: new RegExp(`新建人物『${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}』`) }).click()
      }
    })
    await shot('mapping', { fullPage: false })

    await step('开始 → result page', async () => {
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().includes(`/api/imports/${importId}/mapping`)),
        overlay.getByRole('button', { name: '开始', exact: true }).click(),
      ])
      check('mapping 200', res.status() === 200, { status: res.status() })
      await page.waitForURL((u) => u.pathname === `/imports/${importId}`, { timeout: 30_000 })
      await page.locator('[data-extraction-progress]').waitFor({ timeout: 30_000 })
    })
    await shot('reading-start', { fullPage: false })

    await step('extraction advances while the page is open', async () => {
      await page.waitForFunction(() => /正在读取 [2-9]/.test(document.querySelector('[data-extraction-progress]')?.textContent ?? ''), null, { timeout: 180_000 })
    })
    await shot('reading-partial', { fullPage: false })

    await step('extraction finishes', async () => {
      await page.waitForFunction(() => document.querySelector('[data-import-result]')?.getAttribute('data-import-status') !== 'extracting', null, { timeout: 900_000 })
      await page.locator('[data-review-body], [data-empty-result]').first().waitFor({ timeout: 30_000 })
      const d = await api.get<{ progress: { total: number; done: number; failed: number } }>(`/api/imports/${importId}`)
      log('progress', d.json?.progress)
      check('all windows processed', !!d.json && d.json.progress.done + d.json.progress.failed === d.json.progress.total, d.json?.progress)
    })
    await shot('done')

    const keys: { confirmed?: string; rejected?: string; edited?: string } = {}
    await step('confirm / reject / edit', async () => {
      const proposed = page.locator('[data-review-item][data-status="proposed"]')
      const keyAt = async (i: number) => (await proposed.nth(i).getAttribute('data-review-item')) ?? ''
      check('at least 3 proposed items', (await proposed.count()) >= 3, { count: await proposed.count() })
      keys.confirmed = await keyAt(0)
      await page.locator(`[data-review-item="${keys.confirmed}"]`).getByRole('button', { name: '确认' }).click()
      await page.locator(`[data-review-item="${keys.confirmed}"][data-status="confirmed"]`).waitFor()
      keys.rejected = await keyAt(0)
      await page.locator(`[data-review-item="${keys.rejected}"]`).getByRole('button', { name: '不对' }).click()
      await page.locator(`[data-review-item="${keys.rejected}"][data-status="rejected"]`).waitFor()
      const claims = page.locator('[data-review-item^="claim:"][data-status="proposed"]')
      keys.edited = (await claims.first().getAttribute('data-review-item')) ?? ''
      const row = page.locator(`[data-review-item="${keys.edited}"]`)
      await row.getByRole('button', { name: '改写' }).click()
      await row.locator('textarea').fill('（改写）孩子在三年二班，家长群里很活跃')
      await row.locator('textarea').press('Enter')
      await page.locator(`[data-review-item="${keys.edited}"][data-status="confirmed"]`).waitFor()
    })
    await shot('after-actions')

    await step('本节全部确认', async () => {
      const btn = page.locator('[data-section-accept]').first()
      if ((await btn.count()) === 0) return log('no section left with proposed items')
      const section = page.locator('[data-person-section]').filter({ has: btn })
      const id = await section.first().getAttribute('data-person-section')
      await btn.click()
      await page.locator(`[data-person-section="${id}"] [data-section-accept]`).waitFor({ state: 'detached', timeout: 15_000 })
      check('section has no proposed items', (await page.locator(`[data-person-section="${id}"] [data-review-item][data-status="proposed"]`).count()) === 0)
    })

    await step('其实是…… merge a new person into an existing one', async () => {
      const sec = page.locator('[data-person-section]').filter({ has: page.locator('[data-merge-open]') }).first()
      if ((await sec.count()) === 0) return log('no new person section')
      const fromId = Number(await sec.getAttribute('data-person-section'))
      const created = await api.post<{ person: { id: number; label: string } }>('/api/people', { label: '合并目标（测试）' })
      check('POST /api/people 201', created.status === 201)
      await sec.locator('[data-merge-open]').click()
      await page.locator('[data-merge-dialog] input[role=combobox]').waitFor()
      await helpers.type('合并目标')
      await page.locator('[data-merge-dialog] [role=option]').filter({ hasText: '合并目标（测试）' }).first().click()
      await page.locator('[data-merge-confirm]').click()
      await page.locator('[data-merge-dialog]').waitFor({ state: 'detached', timeout: 20_000 })
      await page.locator(`[data-person-section="${created.json!.person.id}"]`).waitFor({ timeout: 20_000 })
      check('merged section gone', (await page.locator(`[data-person-section="${fromId}"]`).count()) === 0)
    })
    await shot('after-merge')

    await step('reload: everything persisted', async () => {
      await page.reload()
      await page.locator('[data-review-body]').waitFor({ timeout: 30_000 })
      for (const [status, key] of [
        ['confirmed', keys.confirmed],
        ['rejected', keys.rejected],
        ['confirmed', keys.edited],
      ] as const) {
        check(`${key} is ${status} after reload`, (await page.locator(`[data-review-item="${key}"][data-status="${status}"]`).count()) === 1)
      }
      check('edited text persisted', ((await page.locator(`[data-review-item="${keys.edited}"]`).textContent()) ?? '').includes('（改写）'))
      const r = (await api.get<Review>(`/api/imports/${importId}/review`)).json!
      const all = r.sections.flatMap(itemsOf)
      check('API agrees', all.some((i) => `${i.type}:${i.item.id}` === keys.rejected && i.item.status === 'rejected'))
    })
    await shot('after-reload')
    await page.setViewportSize({ width: 390, height: 844 })
    await helpers.settle()
    await shot('after-reload-390')
    await page.setViewportSize({ width: 1440, height: 900 })

    await step('delete this import from the page', async () => {
      const claimIds = (await api.get<Review>(`/api/imports/${importId}/review`)).json!.sections.flatMap(itemsOf).filter((i) => i.type === 'claim').map((i) => i.item.id)
      await page.locator('[data-delete-import]').scrollIntoViewIfNeeded()
      await page.locator('[data-delete-import]').click()
      await page.locator('[data-delete-confirm]').click()
      await page.waitForURL((u) => u.pathname === '/', { timeout: 30_000 })
      check('import 404', (await api.get(`/api/imports/${importId}`)).status === 404)
      let gone = 0
      for (const id of claimIds.slice(0, 10)) if ((await api.get(`/api/evidence/claim/${id}`)).status === 404) gone++
      check('claims evidenced only by this import are gone', gone === Math.min(10, claimIds.length), { gone, sampled: Math.min(10, claimIds.length) })
    })
  },
})
