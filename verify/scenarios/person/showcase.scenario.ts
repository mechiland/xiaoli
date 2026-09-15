import { and, eq, isNotNull } from 'drizzle-orm'
import { withPlatform } from '@/scripts/with-platform'
import { persons } from '@/server/db'
import { defineScenario } from '@/verify/lib'

// Person page representative states on seed data (synthetic): long rich profile, sparse, only-proposed, lunar birthday,
// history expanded, alias list expanded, evidence open, hover actions, edit-in-place, 补充 input, ⋯ menu + merge picker +
// delete confirm (never confirmed), loading, block error, not found, merged redirect, 390 infobox collapsed/expanded,
// anchor highlight. Nothing is written: every edit control is cancelled.
type Profile = {
  person: { id: number; label: string }
  sections: { category: string; claims: { id: number; status: string; statement: string }[] }[]
  history: { id: number }[]
  aliases: { items: { id: number }[] }[]
  infobox: { birthday: { id: number; calendar: string } | null; chats: { chat: { id: number } }[] }
}

/** Merged (hidden) persons of the account → the person each finally lands on. Read-only, local D1 side channel (§4.3). */
async function mergedPersons(ownerId: string): Promise<{ id: number; landsOn: number }[]> {
  const rows = await withPlatform(({ db }) =>
    db.select({ id: persons.id, into: persons.mergedIntoId }).from(persons).where(and(eq(persons.ownerId, ownerId), isNotNull(persons.mergedIntoId))),
  )
  const into = new Map(rows.map((r) => [r.id, r.into!]))
  return rows.map((r) => {
    let at = r.id
    for (let i = 0; i < 10 && into.has(at); i++) at = into.get(at)!
    return { id: r.id, landsOn: at }
  })
}

const dupIds = () => {
  const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
  return ids.filter((x, i) => ids.indexOf(x) !== i)
}

export default defineScenario({
  id: 'person/showcase',
  description: '人物页：长档案、稀疏、只有未确认、农历生日、历史、别名、证据、悬停操作、改写、补充、工具菜单、加载、错误、找不到、窄屏、锚点',
  account: 'seed',
  requiredTags: ['person:long-profile', 'person:sparse-profile', 'person:with-history', 'person:review-new-person', 'person:lunar-birthday-soon'],
  expectedFailures: [
    { urlPattern: /\/api\/people\/\d+$/, status: 500, step: 'block-error', consoleText: 'Failed to load resource' },
  ],
  async run({ page, step, shot, check, helpers, seed, api, width, measure }) {
    const long = await seed.person('long-profile')
    const sparse = await seed.person('sparse-profile')
    const history = await seed.person('with-history')
    const proposedOnly = await seed.person('review-new-person')
    const lunar = await seed.person('lunar-birthday-soon')
    const narrow = width < 1024
    const topbarStatic = () => page.addStyleTag({ content: 'header.sticky{position:static!important}' })

    await step('long rich profile', async () => {
      await helpers.goto(`/p/${long.id}`, { waitFor: '[data-person-id]' })
      check('title is the label', (await page.locator('h1').first().innerText()).includes(long.label!))
      check('又名 line lists aliases', (await page.getByRole('button', { name: /^又名：/ }).innerText()).includes('阿夏'))
      const r = await api.get<Profile>(`/api/people/${long.id}`)
      check('API 200 with sections', r.status === 200 && (r.json?.sections.length ?? 0) >= 5, { status: r.status })
      const headings = await page.locator('[data-block=body] h2').allInnerTexts()
      const order = ['工作', '所在地', '教育', '家庭', '偏好与习惯', '经历', '其他']
      check('body sections in SPEC order', JSON.stringify(headings) === JSON.stringify(order.filter((h) => headings.includes(h))), { headings })
      check('every DOM id is unique', (await page.evaluate(dupIds)).length === 0, { dup: await page.evaluate(dupIds) })
      check('events block is titled 经历', (await page.locator('#sec-events').innerText()).trim() === '经历')
      if (!narrow) {
        const heights = await page.locator('[data-infobox-chats] li').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
        check('共同聊天: one line per chat', heights.length === (r.json?.infobox.chats.length ?? -1) && heights.every((h) => h <= 26), { heights })
      }
    })
    await shot('long-profile')
    if (!narrow) await shot('long-profile-top', { fullPage: false })

    if (narrow) {
      await step('390 infobox collapsed to two lines', async () => {
        await page.evaluate('window.scrollTo(0,0)')
        const summary = page.locator('[data-infobox-summary]')
        check('summary visible', await summary.isVisible())
        const h = await summary.evaluate((el) => el.getBoundingClientRect().height)
        check('summary is at most two lines', h <= 50, { h })
      })
      await shot('infobox-collapsed', { fullPage: false })
      await step('390 infobox expanded', async () => {
        await page.getByRole('button', { name: '展开信息框' }).click()
        await page.locator('#infobox-fields').waitFor()
        const heights = await page.locator('[data-infobox-chats] li').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
        check('共同聊天: one line per chat (390)', heights.length > 0 && heights.every((h) => h <= 26), { heights })
      })
      await shot('infobox-expanded', { fullPage: false })
      await step('scroll wide check', async () => {
        const sw = Number(await page.evaluate('document.documentElement.scrollWidth'))
        check('no horizontal scroll at 390', sw <= 390, { sw })
        await page.getByRole('button', { name: '收起信息框' }).click()
      })
    }

    await step('alias list expanded', async () => {
      await page.getByRole('button', { name: /^又名：/ }).click()
      await page.locator('#alias-panel').waitFor()
      const groups = await page.locator('#alias-panel dt').allInnerTexts()
      check('alias groups', JSON.stringify(groups) === JSON.stringify(['私聊备注名', '群内显示名', '真名', '称呼']), { groups })
    })
    await shot('aliases-expanded', { fullPage: false })

    await step('evidence open on a claim', async () => {
      await page.getByRole('button', { name: /^又名：/ }).click()
      const row = page.locator('[data-block=body] li[id^=claim-]').first()
      await row.locator('[data-evidence-mark]').click()
      await row.locator('.evidence-block [data-evidence-message]').first().waitFor({ timeout: 10_000 })
      await row.scrollIntoViewIfNeeded()
    })
    await shot('evidence-open', { fullPage: false })

    await step('hover actions on a confirmed claim', async () => {
      const row = page.locator('[data-block=body] li[id^=claim-]').nth(2)
      await row.scrollIntoViewIfNeeded()
      if (narrow) await row.locator('.loam-prose > span').first().click()
      else await row.hover()
      const actions = row.locator('[data-claim-actions]')
      check('改写 / 已过时 / 删除 visible', (await actions.evaluate((el) => getComputedStyle(el).visibility)) === 'visible')
    })
    await shot('hover-actions', { fullPage: false })

    await step('edit in place (cancelled)', async () => {
      const row = page.locator('[data-block=body] li[id^=claim-]').nth(2)
      await row.getByRole('button', { name: '改写' }).click()
      await row.getByRole('textbox', { name: '改写这条信息' }).waitFor()
    })
    await shot('edit-in-place', { fullPage: false })
    await step('cancel edit, open 已过时 form (cancelled)', async () => {
      const row = page.locator('[data-block=body] li[id^=claim-]').nth(2)
      await page.keyboard.press('Escape')
      const actions = row.locator('[data-claim-actions]')
      // on touch widths the row stays revealed after cancelling; tap only when the actions are hidden
      if (narrow) {
        if (!(await actions.isVisible())) await row.locator('.loam-prose > span').first().click()
      } else await row.hover()
      await row.getByRole('button', { name: '已过时' }).click()
      await row.locator('#outdated-now').waitFor()
    })
    await shot('outdated-form', { fullPage: false })
    await step('cancel outdated, open 补充', async () => {
      await page.locator('#outdated-now').press('Escape')
      const add = page.locator('[data-add-claim=work]')
      await add.scrollIntoViewIfNeeded()
      await add.click()
      await page.getByRole('textbox', { name: '补充一条工作信息' }).waitFor()
    })
    await shot('add-claim-input', { fullPage: false })
    await step('close 补充', async () => {
      await page.getByRole('textbox', { name: '补充一条工作信息' }).press('Escape')
    })

    await step('⋯ menu', async () => {
      await page.evaluate('window.scrollTo(0,0)')
      await page.getByRole('button', { name: '页面工具' }).click()
      await page.getByRole('menuitem', { name: '合并到其他人物' }).waitFor()
    })
    await shot('tools-menu', { fullPage: false })
    await step('merge picker', async () => {
      await page.getByRole('menuitem', { name: '合并到其他人物' }).click()
      const dialog = page.getByRole('dialog', { name: '合并到其他人物' })
      await dialog.getByRole('combobox').fill('邓')
      await dialog.getByRole('option').first().waitFor({ timeout: 8000 })
      await helpers.settle({ quietMs: 300 })
    })
    await shot('merge-picker', { fullPage: false })
    await step('merge confirm step (not confirmed)', async () => {
      const dialog = page.getByRole('dialog', { name: '合并到其他人物' })
      await dialog.getByRole('option').first().click()
      await dialog.getByRole('button', { name: '合并', exact: true }).waitFor()
      check('merge button enabled after pick', await dialog.getByRole('button', { name: '合并', exact: true }).isEnabled())
    })
    await shot('merge-confirm', { fullPage: false })
    await step('cancel merge, open delete confirm (not confirmed)', async () => {
      await page.getByRole('dialog', { name: '合并到其他人物' }).getByRole('button', { name: '取消' }).click()
      await page.getByRole('button', { name: '页面工具' }).click()
      await page.getByRole('menuitem', { name: '删除此人' }).click()
      await page.getByRole('alertdialog').waitFor()
    })
    await shot('delete-confirm', { fullPage: false })
    await step('cancel delete, split dialog', async () => {
      await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click()
      await page.getByRole('button', { name: '页面工具' }).click()
      await page.getByRole('menuitem', { name: '拆出别名' }).click()
      await page.getByRole('dialog', { name: '拆出别名' }).waitFor()
    })
    await shot('split-dialog', { fullPage: false })
    await step('cancel split; person still exists', async () => {
      await page.getByRole('dialog', { name: '拆出别名' }).getByRole('button', { name: '取消' }).click()
      check('long-profile still 200', (await api.get(`/api/people/${long.id}`)).status === 200)
    })

    await step('history expanded', async () => {
      await helpers.goto(`/p/${history.id}`, { waitFor: '[data-person-id]' })
      await topbarStatic()
      const btn = page.locator('[data-block=history]').getByRole('button', { name: '展开' })
      await btn.click()
      await page.locator('#history-list li').first().waitFor()
      check('history rows note when/why', (await page.locator('#history-list li p').first().innerText()).match(/\d{4}年\d+月\d+日/) !== null)
      await page.locator('[data-block=history]').scrollIntoViewIfNeeded()
    })
    await shot('history-expanded')

    await step('sparse profile', async () => {
      await helpers.goto(`/p/${sparse.id}`, { waitFor: '[data-person-id]' })
    })
    await shot('sparse-profile')

    await step('person with only proposed items', async () => {
      await helpers.goto(`/p/${proposedOnly.id}`, { waitFor: '[data-person-id]' })
      check('proposed rows show 确认', (await page.getByRole('button', { name: '确认', exact: true }).count()) > 0)
    })
    await shot('only-proposed')

    await step('lunar birthday soon', async () => {
      await helpers.goto(`/p/${lunar.id}`, { waitFor: '[data-person-id]' })
      if (narrow) await page.getByRole('button', { name: '展开信息框' }).click()
      const text = await page.locator('#infobox-fields').innerText()
      check('lunar birthday shows 农历 and solar date + days', /农历/.test(text) && /公历 \d+月\d+日/.test(text) && /还有 \d+ 天|就是今天|明天/.test(text), { text })
    })
    await shot('lunar-birthday', { fullPage: false })

    await step('anchor highlight from a search link', async () => {
      const r = await api.get<Profile>(`/api/people/${long.id}`)
      const claims = r.json!.sections.flatMap((s) => s.claims)
      const target = claims[Math.floor(claims.length * 0.7)]
      await helpers.goto(`/p/${long.id}#claim-${target.id}`, { waitFor: '[data-person-id]' })
      const el = page.locator(`#claim-${target.id}`)
      await page.waitForFunction(`document.getElementById('claim-${target.id}')?.getAttribute('data-highlight') === 'true'`, undefined, { timeout: 5000 })
      const box = await el.boundingBox()
      const vh = page.viewportSize()!.height
      check('anchored row near viewport centre', !!box && Math.abs(box.y + box.height / 2 - vh / 2) < vh * 0.25, { box, vh })
    })
    await shot('anchor-highlight', { fullPage: false, settleMs: 50 })
    await step('highlight clears after 2 s; hash to a history claim expands history', async () => {
      await page.waitForTimeout(2300)
      check('highlight cleared', (await page.locator('[data-highlight=true]').count()) === 0)
      const h = await api.get<Profile>(`/api/people/${history.id}`)
      const hid = h.json!.history[0].id
      await helpers.goto(`/p/${history.id}#claim-${hid}`, { waitFor: '[data-person-id]' })
      await page.waitForFunction(`document.getElementById('claim-${hid}')?.getAttribute('data-highlight') === 'true'`, undefined, { timeout: 5000 })
      check('history expanded by anchor', await page.locator('#history-list li').first().isVisible())
    })

    if (narrow) {
      await step('390 #date- anchor opens the infobox, centres and highlights the date', async () => {
        const r = await api.get<Profile>(`/api/people/${long.id}`)
        const bid = r.json!.infobox.birthday!.id
        await helpers.goto(`/p/${long.id}#date-${bid}`, { waitFor: '[data-person-id]' })
        await page.waitForFunction(`document.getElementById('date-${bid}')?.getAttribute('data-highlight') === 'true'`, undefined, { timeout: 5000 })
        check('one element carries the date id', (await page.locator(`[id="date-${bid}"]`).count()) === 1)
        const box = await page.locator(`#date-${bid}`).boundingBox()
        const vh = page.viewportSize()!.height
        check('date row near viewport centre', !!box && Math.abs(box.y + box.height / 2 - vh / 2) < vh * 0.25, { box, vh })
      })
      await shot('date-anchor-highlight', { fullPage: false, settleMs: 50 })
    }

    await step('merged person redirects', async () => {
      const m = (await seed.manifest()) as { userId: string }
      const merged = await mergedPersons(m.userId)
      check('seed has merged persons', merged.length > 0, { merged })
      const pick = merged.find((x) => x.landsOn === long.id) ?? merged[0]
      await helpers.goto(`/p/${pick.id}`, { waitFor: '[data-person-id]' })
      check('merged id lands on the surviving person', new URL(page.url()).pathname === `/p/${pick.landsOn}`, { url: page.url(), pick })
      if (pick.landsOn === long.id) check('lands on the tagged long-profile', true)
    })

    await step('loading', async () => {
      const un = await helpers.simulateLoading(/\/api\/people\/\d+$/, 3000)
      await page.goto(`/dev/person/live/${long.id}`)
      await page.locator('[data-person-skeleton]').waitFor({ timeout: 5000 })
      await shot('loading', { fullPage: false, settleMs: 50 })
      await page.locator('[data-person-id]').waitFor({ timeout: 15_000 })
      await un()
    })

    await step('block-error', async () => {
      const un = await helpers.simulateError(/\/api\/people\/\d+$/, { status: 500 })
      await page.goto(`/dev/person/live/${long.id}`)
      await page.locator('[data-person-error]').waitFor({ timeout: 15_000 })
      check('top bar still renders', await page.getByRole('link', { name: '小丽' }).isVisible())
      await shot('block-error', { fullPage: false })
      await un()
      await page.locator('[data-person-error]').getByRole('button', { name: '重试' }).click()
      await page.locator('[data-person-id]').waitFor({ timeout: 15_000 })
      check('retry recovers', true)
    })

    await step('not-found', async () => {
      // core's app/(app)/loading.tsx streams the shell first, so notFound() renders with HTTP 200 (DECISIONS person P6)
      await helpers.goto('/p/99999999')
      check('not found copy', await page.getByText('没有找到这个人物').isVisible())
    })
    await shot('not-found', { fullPage: false })

    if (width === 1440) {
      await step('perf budgets (P2)', async () => {
        await measure.page('/p/<long-profile> TTFB', `/p/${long.id}`)
        await measure.api('GET /api/people/<long-profile>', `/api/people/${long.id}`)
      })
    }
  },
})
