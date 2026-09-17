import { eq } from 'drizzle-orm'
import { withPlatform } from '~/scripts/with-platform'
import { claims, owned, withOwner } from '@/server/db'
import { defineScenario } from '~/verify/lib'

// Person page write path on a throwaway account (never seed data): confirm / reject a proposed claim, rewrite,
// mark outdated with "现在的情况", delete, add a manual claim with 补充, pin; then reload and check everything persisted
// (UI + API), and finally delete the person from the ⋯ menu. Proposed claims only come from extraction, so they are
// inserted through the local D1 side channel (ARCHITECTURE §4.3), owner = this run's fresh account.
type Claim = { id: number; statement: string; status: string; statusReason: string | null; category: string; sourceKind: string; supersededByClaimId: number | null }
type Profile = { person: { id: number; label: string; pinned: boolean }; sections: { category: string; claims: Claim[] }[]; history: Claim[] }

const T0 = '2026-09-01T00:00:00.000Z'

async function insertProposed(ownerId: string, personId: number, rows: { statement: string; category: 'preference' | 'location' }[]) {
  let lastError: unknown
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await withPlatform(async ({ db }) => {
        await db.delete(claims).where(owned(claims, ownerId, eq(claims.personId, personId), eq(claims.status, 'proposed')))
        for (const r of rows)
          await db.insert(claims).values(
            withOwner<typeof claims>(ownerId, {
              personId,
              statement: r.statement,
              statementNorm: r.statement,
              category: r.category,
              validFrom: null,
              validTo: null,
              learnedAt: T0,
              confidence: 0.9,
              sensitive: false,
              status: 'proposed',
              statusReason: null,
              statusChangedAt: T0,
              supersedesClaimId: null,
              supersededByClaimId: null,
              importId: null,
              jobId: null,
              sourceKind: 'ai',
            }),
          )
      })
    } catch (e) {
      lastError = e
      await new Promise((r) => setTimeout(r, 250 * attempt))
    }
  }
  throw lastError
}

export default defineScenario({
  id: 'person/actions',
  description: '人物页写操作（一次性账号）：确认、不对、改写、已过时、删除、补充、关注，刷新后仍然保存，最后删除此人',
  account: 'fresh',
  destructive: false,
  // the last step asserts the deleted person is gone
  expectedFailures: [{ urlPattern: /\/api\/people\/\d+$/, status: 404, step: 'delete the person from ⋯ (throwaway) → home, 404 afterwards' }],
  async run({ page, step, shot, check, helpers, api, width }) {
    const narrow = width < 640
    const label = `测试人物${width}`
    let personId = 0
    const row = (text: string) => page.locator('[data-block=body] li[id^=claim-]', { hasText: text })
    const reveal = async (text: string) => {
      const r = row(text)
      await r.scrollIntoViewIfNeeded()
      if (narrow) await r.locator('.loam-prose > span').first().click()
      else await r.hover()
      return r
    }
    const profile = async () => (await api.get<Profile>(`/api/people/${personId}`)).json!
    const allClaims = (p: Profile) => p.sections.flatMap((s) => s.claims)

    await step('setup: person with 3 confirmed manual claims and 2 proposed claims', async () => {
      const me = (await api.get<{ user: { id: string } }>('/api/me')).json!.user.id
      const created = await api.post<{ person: { id: number } }>('/api/people', { label })
      check('person created', created.status === 201, { status: created.status })
      personId = created.json!.person.id
      for (const statement of ['在杭州一家设计公司做设计师', '在上海做过两年记者', '在宁波做外贸'])
        check(`manual claim ${statement}`, (await api.post(`/api/people/${personId}/claims`, { statement, category: 'work' })).status === 201)
      await insertProposed(me, personId, [
        { statement: '喜欢周末去爬山', category: 'preference' },
        { statement: '住在苏州园区', category: 'location' },
      ])
      await helpers.goto(`/p/${personId}`, { waitFor: '[data-person-id]' })
      check('proposed rows render with 确认', (await row('喜欢周末去爬山').getByRole('button', { name: '确认' }).count()) === 1)
    })
    // full-page shots: keep the sticky top bar at the top of the image (as review R19 does for element shots)
    await page.addStyleTag({ content: 'header.sticky{position:static!important}' })
    await shot('before')

    await step('confirm a proposed claim', async () => {
      await row('喜欢周末去爬山').getByRole('button', { name: '确认' }).click()
      await row('喜欢周末去爬山').getByRole('button', { name: '确认' }).waitFor({ state: 'detached', timeout: 10_000 })
    })
    await step('reject a proposed claim', async () => {
      await row('住在苏州园区').getByRole('button', { name: '不对' }).click()
      await row('住在苏州园区').waitFor({ state: 'detached', timeout: 10_000 })
    })

    await step('rewrite a confirmed claim in place', async () => {
      const r = await reveal('在杭州一家设计公司做设计师')
      await r.getByRole('button', { name: '改写' }).click()
      const input = page.getByRole('textbox', { name: '改写这条信息' })
      await input.fill('在杭州一家设计公司做设计总监')
      await input.press('Enter')
      await row('在杭州一家设计公司做设计总监').waitFor({ timeout: 10_000 })
    })
    await shot('after-rewrite', { fullPage: false })

    await step('mark a claim outdated with 现在的情况', async () => {
      const r = await reveal('在上海做过两年记者')
      await r.getByRole('button', { name: '已过时' }).click()
      await page.locator('#outdated-now').fill('现在在成都做编辑')
      await page.getByRole('button', { name: '标记为已过时' }).click()
      await row('现在在成都做编辑').waitFor({ timeout: 10_000 })
      await row('在上海做过两年记者').waitFor({ state: 'detached', timeout: 10_000 })
    })

    await step('delete a claim (inline confirm)', async () => {
      const r = await reveal('在宁波做外贸')
      await r.getByRole('button', { name: '删除' }).click()
      await shot('delete-inline-confirm', { fullPage: false })
      await r.getByRole('button', { name: '删除' }).click()
      await row('在宁波做外贸').waitFor({ state: 'detached', timeout: 10_000 })
    })

    await step('补充 a manual claim to a section with Enter', async () => {
      const add = page.locator('[data-add-claim=preference]')
      await add.scrollIntoViewIfNeeded()
      await add.click()
      const input = page.getByRole('textbox', { name: '补充一条偏好与习惯信息' })
      await input.fill('不吃香菜')
      await input.press('Enter')
      await row('不吃香菜').waitFor({ timeout: 10_000 })
    })
    await step('补充 into an empty category from 补充其他方面', async () => {
      await page.getByRole('button', { name: '家庭', exact: true }).click()
      const input = page.getByRole('textbox', { name: '补充一条家庭信息' })
      await input.fill('有一个上小学的女儿')
      await input.press('Enter')
      await row('有一个上小学的女儿').waitFor({ timeout: 10_000 })
    })
    await step('pin', async () => {
      await page.evaluate('window.scrollTo(0,0)')
      await page.getByRole('button', { name: '关注', exact: true }).click()
      await page.getByRole('button', { name: '已关注' }).waitFor({ timeout: 10_000 })
    })

    await step('reload: everything persisted', async () => {
      await page.waitForTimeout(500)
      await helpers.goto(`/p/${personId}`, { waitFor: '[data-person-id]' })
      const p = await profile()
      const live = allClaims(p)
      const by = (s: string) => live.find((c) => c.statement === s)
      check('confirmed claim is confirmed', by('喜欢周末去爬山')?.status === 'confirmed', by('喜欢周末去爬山'))
      check('rejected claim gone from sections and history', !by('住在苏州园区') && !p.history.some((c) => c.statement === '住在苏州园区'))
      check('rewritten text is live', by('在杭州一家设计公司做设计总监')?.status === 'confirmed')
      check('original text in history as edited', p.history.some((c) => c.statement === '在杭州一家设计公司做设计师' && c.statusReason === 'edited'))
      const outdated = p.history.find((c) => c.statement === '在上海做过两年记者')
      check('outdated claim in history as outdated', outdated?.statusReason === 'outdated', outdated)
      check('现在的情况 created a confirmed claim it points to', !!outdated && by('现在在成都做编辑')?.id === outdated.supersededByClaimId)
      check('deleted claim is nowhere', !by('在宁波做外贸') && !p.history.some((c) => c.statement === '在宁波做外贸'))
      check('补充 claims are manual + confirmed in their sections', by('不吃香菜')?.category === 'preference' && by('不吃香菜')?.sourceKind === 'manual' && by('有一个上小学的女儿')?.category === 'family')
      check('pinned persisted', p.person.pinned === true)
      // UI after reload
      check('UI: 确认 buttons gone', (await page.getByRole('button', { name: '确认', exact: true }).count()) === 0)
      check('UI: rewritten row visible', await row('在杭州一家设计公司做设计总监').isVisible())
      check('UI: 已关注', await page.getByRole('button', { name: '已关注' }).isVisible())
      await page.locator('[data-block=history]').getByRole('button', { name: '展开' }).click()
      const historyText = await page.locator('#history-list').innerText()
      check('UI: history lists edited + outdated, not deleted', historyText.includes('在杭州一家设计公司做设计师') && historyText.includes('在上海做过两年记者') && !historyText.includes('在宁波做外贸'), { historyText })
    })
    await page.addStyleTag({ content: 'header.sticky{position:static!important}' })
    await shot('after-reload')

    await step('delete the person from ⋯ (throwaway) → home, 404 afterwards', async () => {
      await page.evaluate('window.scrollTo(0,0)')
      await page.getByRole('button', { name: '页面工具' }).click()
      await page.getByRole('menuitem', { name: '删除此人' }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click()
      await page.waitForURL((u) => u.pathname === '/', { timeout: 15_000 })
      check('GET person → 404 after delete', (await api.get(`/api/people/${personId}`)).status === 404)
    })
  },
})
