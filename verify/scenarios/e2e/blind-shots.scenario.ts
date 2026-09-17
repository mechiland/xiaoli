import { defineScenario } from '@/verify/lib'

// Screenshots for the blind comparison (ARCHITECTURE §12.2): synthetic seed account only, 1440, full page.
export default defineScenario({
  id: 'e2e/blind-shots',
  description: '盲评截图：首页与 long-profile 人物页（种子账号，1440 全页）',
  account: 'seed',
  widths: [1440],
  async run({ step, shot, seed, helpers, check }) {
    await step('home', async () => {
      check('home answers 200', (await helpers.goto('/')) === 200)
    })
    await shot('home')
    const person = await step('resolve long-profile', () => seed.person('long-profile'))
    await step('person', async () => {
      check('person page answers 200', (await helpers.goto(`/p/${person.id}`)) === 200)
    })
    await shot('person')
  },
})
