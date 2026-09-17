import { defineScenario } from '~/verify/lib'

// Small real account (seed2: 10 people, 1 import, no important dates): "事项" empty state, short index, isolation.
export default defineScenario({
  id: 'home/small-account',
  description: '小账号首页：没有即将到来的日期、十个人物、隔离',
  account: 'seed2',
  async run({ page, step, shot, check, helpers }) {
    const main = page.locator('main')
    await step('home', async () => {
      await helpers.goto('/')
      check('事项 shows an empty state when there are no dates', await main.getByText('未来 7 天暂无事项。', { exact: true }).isVisible())
      check('index lists the 10 people of this account only', (await main.locator('[id^="people-"] a').count()) === 10)
      check('search hero present', await main.getByRole('button', { name: /搜索人物、别名或信息/ }).isVisible())
    })
    await shot('small')
  },
})
