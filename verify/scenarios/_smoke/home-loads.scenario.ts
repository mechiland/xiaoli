import { defineScenario, SEED_ACCOUNTS } from '@/verify/lib'

// Alias: `pnpm verify smoke`. Sign-in page (signed out), sign-in through the form, app shell on home and a person page.
export default defineScenario({
  id: '_smoke/home-loads',
  description: '登录页 + 应用外壳（顶栏、首页、账户菜单、人物页）',
  account: 'seed',
  async run({ page, context, step, shot, check, helpers, seed, api }) {
    await step('signed out: / redirects to /sign-in', async () => {
      await context.clearCookies()
      await helpers.goto('/')
      check('unauthenticated / lands on /sign-in', new URL(page.url()).pathname === '/sign-in', { url: page.url() })
      await page.getByLabel('邮箱').waitFor()
    })
    await shot('sign-in')

    await step('sign in through the form', async () => {
      await page.getByLabel('邮箱').fill(SEED_ACCOUNTS.seed.email)
      await page.getByLabel('密码').fill(SEED_ACCOUNTS.seed.password)
      await Promise.all([
        page.waitForURL((u) => u.pathname === '/', { timeout: 30_000 }),
        page.getByRole('button', { name: '登录', exact: true }).click(),
      ])
      await helpers.settle()
    })
    await step('shell on home', async () => {
      check('top bar: product name links home', await page.getByRole('link', { name: '小丽', exact: true }).isVisible())
      check('top bar: 导入 button', await page.getByRole('button', { name: '导入', exact: true }).isVisible())
      check('top bar: search entry', await page.getByRole('button', { name: /搜索/ }).first().isVisible())
      const me = await api.get<{ user?: { email?: string } }>('/api/me')
      check('GET /api/me is the seed account', me.status === 200 && me.json?.user?.email === SEED_ACCOUNTS.seed.email, { status: me.status })
    })
    await shot('shell-home')

    await step('account menu', async () => {
      await page.getByRole('button', { name: '账户' }).click()
      await page.getByRole('menuitem', { name: '设置' }).waitFor()
      check('account menu has 设置 and 退出', await page.getByRole('menuitem', { name: '退出' }).isVisible())
    })
    await shot('account-menu', { fullPage: false })
    await step('close menu', () => helpers.press('Escape'))

    const person = await step('resolve seed person long-profile', () => seed.person('long-profile'))
    await step('person page shell', async () => {
      const status = await helpers.goto(`/p/${person.id}`)
      check('person page answers 200', status === 200, { status })
    })
    await shot('shell-person')
  },
})
