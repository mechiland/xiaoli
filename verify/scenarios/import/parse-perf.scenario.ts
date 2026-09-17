import { defineScenario } from '~/verify/lib'
import { PERF_5000 } from './_support'

// P1 (ARCHITECTURE §10): browser parse of a 5,000-message ZIP ≤ 3 s, from file set to preview rendered
// (performance marks xiaoli:parse:start / xiaoli:parse:end), 1440 only, 3 runs, median.
export default defineScenario({
  id: 'import/parse-perf',
  description: '浏览器解析 5000 条消息的 ZIP（选择文件 → 预览显示）≤ 3 秒，3 次取中位数',
  account: 'seed',
  widths: [1440],
  trace: false,
  async run({ page, step, shot, check, helpers, measure }) {
    const overlay = page.locator('[data-import-overlay]')
    await step('open home', () => helpers.goto('/'))
    const samples: number[] = []
    for (let i = 1; i <= 3; i++) {
      await step(`run ${i}: parse perf-5000.zip`, async () => {
        await page.getByRole('button', { name: '导入', exact: true }).click()
        await page.locator('[data-import-overlay][data-step="pick"]').waitFor()
        await helpers.setInputFiles('input[data-import-file]', [{ path: PERF_5000 }])
        await page.locator('[data-import-overlay][data-step="preview"]').waitFor({ timeout: 20_000 })
        const ms = await page.waitForFunction(
          `(() => { const s = performance.getEntriesByName('xiaoli:parse:start').at(-1); const e = performance.getEntriesByName('xiaoli:parse:end').at(-1); return s && e ? e.startTime - s.startTime : null })()`,
          undefined,
          { timeout: 5000 },
        )
        const value = Number(await ms.jsonValue())
        samples.push(value)
        check(`run ${i} measured`, Number.isFinite(value) && value > 0, { ms: value })
        check(`run ${i}: 5000 messages in the preview`, await overlay.getByText('5,000').first().isVisible())
      })
      if (i === 1) await shot('perf-5000-preview', { fullPage: false })
      await step(`run ${i}: close`, async () => {
        await page.getByRole('button', { name: '关闭' }).click()
        await overlay.waitFor({ state: 'detached' })
      })
    }
    const b = measure.record('import-parse-5000', samples, { targetMs: 3000, runs: 3, discard: 0 })
    check('median ≤ 3000 ms', b.passed, { samples, median: b.statisticMs })
  },
})
