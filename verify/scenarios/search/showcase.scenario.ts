import { readFileSync } from 'node:fs'
import path from 'node:path'
import { defineScenario } from '~/verify/lib'

// Search overlay states on seed data: open (empty), person results, alias match, claim highlight + keyboard to #claim-,
// the 来往 group (SPEC §9.8; stubbed — the hits come from the interaction module), long list, no results + 新建人物
// (POST stubbed: the create route is review's), loading, error, "/" guard, isolation.
type SearchBody = {
  q: string
  people: { person: { id: number; label: string }; matchedAlias: string | null }[]
  claims: { claimId: number; person: { id: number } }[]
  interaction: unknown[]
}

export default defineScenario({
  id: 'search/showcase',
  description: '搜索浮层：结果、别名、信息高亮、来往、键盘、长列表、没有找到与新建、加载、错误、窄屏',
  account: 'seed',
  requiredTags: ['person:long-profile', 'claim:claim-searchable', 'chat:group-owners'],
  expectedFailures: [{ urlPattern: '/api/search', status: 500, step: 'error-state', consoleText: 'Failed to load resource' }],
  async run({ page, step, shot, check, helpers, seed, api, width, measure }) {
    const long = await seed.person('long-profile')
    const claim = await seed.claim('claim-searchable')
    const dialog = page.getByRole('dialog', { name: '搜索' })
    const input = dialog.getByRole('combobox')

    const openOverlay = async () => {
      if (width < 640) await page.getByRole('button', { name: '搜索', exact: true }).click()
      else await helpers.press('Mod+K')
      await input.waitFor()
    }
    const search = async (q: string, waitText?: string) => {
      await input.fill(q)
      if (waitText) await dialog.getByRole('option').filter({ hasText: waitText }).first().waitFor({ timeout: 8000 })
      await helpers.settle({ quietMs: 300 })
    }

    await step('home with top bar trigger', async () => {
      await helpers.goto('/')
    })
    await shot('trigger', { fullPage: false })

    await step('open overlay', openOverlay)
    await shot('open-empty', { fullPage: false })

    await step('person results', async () => {
      await search(long.label!, long.label!)
      const first = await dialog.getByRole('option').first().innerText()
      check('first result is the exact label match', first.includes(long.label!), { first })
      check('"人物" and "信息" groups present', (await dialog.getByRole('group', { name: '人物' }).count()) === 1)
    })
    await shot('results-person', { fullPage: false })

    await step('alias match shows 又名', async () => {
      await search('夏夏', '又名')
      const aliasRow = dialog.getByRole('option').filter({ hasText: long.label! }).first()
      check('alias row names the person and the alias', (await aliasRow.innerText()).includes('又名'), { text: await aliasRow.innerText() })
    })
    await shot('alias-match', { fullPage: false })

    await step('claim match with keyword highlight', async () => {
      await search('景德镇', '景德镇')
      check('claim keyword is marked', (await dialog.locator('mark', { hasText: '景德镇' }).count()) > 0)
    })
    await shot('claim-highlight', { fullPage: false })

    await step('keyboard: ↓ ↑ Enter opens the claim anchor', async () => {
      const opts = dialog.getByRole('option')
      const texts = await opts.allInnerTexts()
      const idx = texts.findIndex((t) => t.includes(claim.statement!))
      check('claim-searchable is in the results', idx >= 0, { texts })
      await helpers.press('ArrowDown')
      await helpers.press('ArrowUp')
      for (let i = 0; i < idx; i++) await helpers.press('ArrowDown')
      const activeText = await dialog.locator('[role=option][aria-selected=true]').innerText()
      check('active option follows the keyboard', activeText.includes(claim.statement!), { activeText })
      await helpers.press('Enter')
      await page.waitForURL((u) => u.pathname === `/p/${claim.personId}` && u.hash === `#claim-${claim.id}`, { timeout: 10_000 })
      check('overlay closed after navigation', !(await dialog.isVisible()))
    })

    // SPEC §9.8「来往」: third and last group. searchInteraction is the interaction module's (ARCHITECTURE §1.17) and is
    // still a stub, so the hits are stubbed here; what is verified is the group's place, its row and where it navigates.
    await step('来往 is the last group; a 段落 hit opens the chat at that message', async () => {
      const chat = await seed.chat('group-owners')
      const msgs = await api.get<{ messages: { id: number }[] }>(`/api/chats/${chat.id}/messages?limit=1`)
      const messageId = msgs.json?.messages[0]?.id
      check('a real message to anchor the 段落 hit at', typeof messageId === 'number', { status: msgs.status, messageId })
      const q = '装修'
      const un = await helpers.stubJson('**/api/search?*', {
        q,
        people: [{ person: { id: long.id, label: long.label! }, matchedAlias: null }],
        claims: [{ person: { id: long.id, label: long.label! }, claimId: claim.id, statement: claim.statement!, highlights: [] }],
        interaction: [
          {
            kind: 'segment',
            id: 9001,
            person: { id: long.id, label: long.label! },
            chatId: chat.id,
            chatTitle: chat.title ?? '小区业主群',
            at: '2026-08-12 21:04',
            text: '和丽娟聊了装修排期，说下周去看瓷砖',
            href: `/chats/${chat.id}?at=${messageId}`,
            highlights: [[5, 7]],
          },
          {
            kind: 'loop',
            id: 9002,
            person: { id: long.id, label: long.label! },
            chatId: null,
            chatTitle: null,
            at: '2026-07-30 09:12',
            text: '你答应帮她问装修队的报价',
            href: `/p/${long.id}#loop-9002`,
            highlights: [[6, 8]],
          },
        ],
      })
      await openOverlay()
      await search(q, '装修排期')
      const groups = await dialog.getByRole('group').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
      check('groups are 人物, 信息, 来往 in that order', JSON.stringify(groups) === JSON.stringify(['人物', '信息', '来往']), { groups })
      const rows = await dialog.getByRole('group', { name: '来往' }).getByRole('option').allInnerTexts()
      check('a 来往 row reads 日期 · 聊天名 · 那句话', Boolean(rows[0]?.includes('8月12日') && rows[0]?.includes(chat.title ?? '') && rows[0]?.includes('装修排期')), { rows })
      check('the query is highlighted in both 来往 rows', (await dialog.getByRole('group', { name: '来往' }).locator('mark', { hasText: q }).count()) === 2)
      await shot('interaction-group', { fullPage: false })
      const total = await dialog.getByRole('option').count()
      for (let i = 0; i < total - 1; i++) await helpers.press('ArrowDown')
      const lastText = await dialog.locator('[role=option][aria-selected=true]').innerText()
      check('keyboard reaches the last 来往 row', lastText.includes('装修队的报价'), { lastText, total })
      await helpers.press('ArrowUp')
      await helpers.press('Enter')
      await page.waitForURL((u) => u.pathname === `/chats/${chat.id}` && u.searchParams.get('at') === String(messageId), { timeout: 10_000 })
      check('段落 hit opened the chat at that message', new URL(page.url()).searchParams.get('at') === String(messageId))
      await un()
    })

    await step('"/" does not open while typing in a field', async () => {
      await helpers.goto('/')
      await page.evaluate("(() => { const i = document.createElement('input'); i.id = 'tmp-typing'; document.querySelector('main').appendChild(i); i.focus(); })()")
      await helpers.press('/')
      await page.waitForTimeout(200)
      check('overlay stays closed', !(await dialog.isVisible()))
      check('"/" was typed into the field', (await page.locator('#tmp-typing').inputValue()) === '/')
      await page.evaluate("document.getElementById('tmp-typing').remove()")
    })

    await step('"/" opens from the page; long list scrolls with the keyboard', async () => {
      if (width < 640) await openOverlay()
      else {
        await page.locator('body').click({ position: { x: 5, y: 300 } })
        await helpers.press('/')
        await input.waitFor()
      }
      await search('喜欢', '喜欢')
      check('long list has many results', (await dialog.getByRole('option').count()) >= 15)
    })
    await shot('long-list', { fullPage: false })
    await step('scroll to the end of the list', async () => {
      const n = await dialog.getByRole('option').count()
      for (let i = 0; i < n - 1; i++) await helpers.press('ArrowDown')
      await page.waitForTimeout(150)
      check('last option is visible after ↓', await dialog.getByRole('option').last().isVisible())
    })
    await shot('long-list-end', { fullPage: false })

    await step('no results + 新建人物', async () => {
      await search('完全没有这个人', '新建人物')
      check('"没有找到" shown', await dialog.getByText('没有找到', { exact: true }).isVisible())
      check('create row carries the query', (await dialog.getByRole('option').first().innerText()).includes('新建人物『完全没有这个人』'))
    })
    await shot('no-results', { fullPage: false })
    await step('Enter on 新建人物 posts and opens the new person (POST /api/people stubbed)', async () => {
      const now = new Date().toISOString()
      const un = await helpers.stubJson(
        '**/api/people',
        { person: { id: long.id, label: '完全没有这个人', isSelf: false, mergedIntoId: null, pinned: false, avatarUrl: null, lastMessageAt: null, createdAt: now, updatedAt: now } },
        { status: 201 },
      )
      await helpers.press('Enter')
      await page.waitForURL((u) => u.pathname === `/p/${long.id}`, { timeout: 10_000 })
      await un()
      check('navigated to the created person', new URL(page.url()).pathname === `/p/${long.id}`)
    })

    await step('Escape closes', async () => {
      await openOverlay()
      await helpers.press('Escape')
      await page.waitForTimeout(250)
      check('overlay closed by Escape', !(await dialog.isVisible()))
    })

    await step('loading-state', async () => {
      const un = await helpers.simulateLoading(/\/api\/search\?/, 3000)
      await openOverlay()
      await input.fill('林')
      await dialog.locator('[aria-busy=true]').waitFor({ timeout: 3000 })
      await shot('loading', { fullPage: false })
      await dialog.getByRole('option').first().waitFor({ timeout: 10_000 })
      await un()
      await helpers.press('Escape')
    })

    await step('error-state', async () => {
      const un = await helpers.simulateError(/\/api\/search\?/, { status: 500 })
      await openOverlay()
      await input.fill('邓')
      await dialog.getByText('搜索没有完成').waitFor({ timeout: 10_000 })
      await shot('error', { fullPage: false })
      await un()
      await dialog.getByRole('button', { name: '重试' }).click()
      await dialog.getByRole('option').first().waitFor({ timeout: 10_000 })
      check('retry recovers results', (await dialog.getByRole('option').count()) > 0)
      await helpers.press('Escape')
    })

    await step('isolation and API contract', async () => {
      const manifest = JSON.parse(readFileSync(path.join(process.cwd(), '.dev/seed-manifest.json'), 'utf8'))
      const overlapId: number | undefined = manifest.accounts?.seed2?.persons?.['overlap-long-profile']?.id
      const r = await api.get<SearchBody>(`/api/search?q=${encodeURIComponent(long.label!)}`)
      const ids = r.json?.people.map((p) => p.person.id) ?? []
      check('seed search finds long-profile', r.status === 200 && ids[0] === long.id, { ids })
      check("seed2's overlapping person never appears", overlapId === undefined || !ids.includes(overlapId), { overlapId })
      const pinyin = await api.get<SearchBody>('/api/search?q=lzx&types=people')
      check('pinyin initials find long-profile', (pinyin.json?.people ?? []).some((p) => p.person.id === long.id))
      const idx = await api.get<{ total: number; groups: { letter: string }[] }>('/api/people?index=pinyin')
      const letters = idx.json?.groups.map((g) => g.letter) ?? []
      check('people index: 200 visible persons, # last', idx.json?.total === 200 && letters[letters.length - 1] === '#', { total: idx.json?.total, letters })
      if (width === 1440) {
        await measure.api('GET /api/search (claims + people)', `/api/search?q=${encodeURIComponent('喜欢')}`)
        await measure.api('GET /api/people?index=pinyin', '/api/people?index=pinyin')
      }
    })
  },
})
