import { defineScenario } from '@/verify/lib'

// Alias: `pnpm verify perf`. 300 ms budgets P2/P3 (ARCHITECTURE §8, §10): 4 sequential loads, first discarded, median of 2–4.
// Pages still showing core's placeholder and routes still answering 501 are reported as MISSING (never passing).
export default defineScenario({
  id: '_smoke/perf-budgets',
  description: '首页与人物页服务端响应 ≤ 300ms（种子数据 200 人 / 5000 条 claim）',
  account: 'seed',
  widths: [1440],
  trace: false,
  async run({ step, measure, seed, check }) {
    const person = await step('resolve long-profile', () => seed.person('long-profile'))
    const manifest = (await seed.manifest()) as { counts?: Record<string, number> } | null
    check('seed data at budget scale (≥ 200 persons, ≥ 5000 claims)', (manifest?.counts?.visiblePersons ?? 0) >= 200 && (manifest?.counts?.claims ?? 0) >= 5000, manifest?.counts)

    await step('P3 home page TTFB', () => measure.page('P3 page / (TTFB)', '/'))
    await step('P3 GET /api/home', () => measure.api('P3 GET /api/home (Server-Timing)', '/api/home'))
    await step('P2 person page TTFB', () => measure.page('P2 page /p/:id long-profile (TTFB)', `/p/${person.id}`))
    await step('P2 GET /api/people/:id', () => measure.api('P2 GET /api/people/:id long-profile (Server-Timing)', `/api/people/${person.id}`))
  },
})
