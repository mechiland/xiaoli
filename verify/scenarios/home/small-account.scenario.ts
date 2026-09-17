import { defineScenario } from '@/verify/lib'

// Small real account (seed2: 10 people, 1 import, no important dates): "即将到来" hidden, short index, isolation.
export default defineScenario({
  id: 'home/small-account',
  description: '小账号首页：没有即将到来的日期、十个人物、隔离',
  account: 'seed2',
  async run({ page, step, shot, check, helpers }) {
    const main = page.locator('main')
    await step('home', async () => {
      await helpers.goto('/')
      check('即将到来 hidden when there are no dates', (await main.getByRole('heading', { name: '即将到来', exact: true }).count()) === 0)
      check('index lists the 10 people of this account only', (await main.locator('[id^="people-"] a').count()) === 10)
      check('search hero present', await main.getByRole('button', { name: /搜索人物、别名或信息/ }).isVisible())
    })
    await shot('small')
  },
})
