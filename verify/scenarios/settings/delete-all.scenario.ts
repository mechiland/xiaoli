import { SEED_ACCOUNTS } from '@/scripts/seed/accounts'
import { countOwnerRows } from '@/server/settings'
import { withPlatform } from '@/scripts/with-platform'
import { defineScenario } from '@/verify/lib'
import { PRIVATE_1, PRIVATE_2 } from '../import/_support'
import { apiAs, fillAccount, posterFromContext, posterFromScenario, tableCounts, THROWAWAY_PASSWORD, type Dump } from './_support'

// Destructive path of settings (ARCHITECTURE §11 "Delete all data"), on throwaway accounts only:
// account A (this run's fresh account) gets an import with an uploaded image (R2), people, a manual claim and settings;
// account B (a second throwaway) gets the same shape; seed2 is only read. A deletes everything from the UI dialog.
// Then: A's D1 rows are 0 in every §11 table and its R2 prefix is empty, A can still sign in and use the app,
// B and seed2 are unchanged (export counts, D1 counts, R2 objects). No seed data is touched, so no re-seed is needed.
// Side-channel read of the shared local D1/R2 (ARCHITECTURE §4.3). Other agents seed and write concurrently, so a read
// can hit a transient lock (SQLITE_BUSY): retry up to 5× with backoff, like the seed CLI, and surface the real cause.
async function ownerState(ownerId: string, log?: (msg: string, data?: unknown) => void) {
  let lastError: unknown
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await withPlatform(async ({ db, r2 }) => ({
        rows: await countOwnerRows(db, ownerId),
        r2: (await r2.list({ prefix: `u/${ownerId}/` })).objects.length,
      }))
    } catch (e) {
      lastError = e
      const cause = (e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message
      log?.('ownerState retry', { attempt, cause: cause.slice(0, 200) })
      await new Promise((r) => setTimeout(r, 250 * attempt))
    }
  }
  throw lastError
}

export default defineScenario({
  id: 'settings/delete-all',
  description: '删除全部数据（一次性账号）：界面输入确认文字后删除，账号数据清空（D1 + R2），其他账号不受影响',
  account: 'fresh',
  destructive: false,
  async run({ page, step, shot, check, helpers, api, baseUrl, width, log }) {
    const stamp = `${Date.now()}-${width}`
    const bEmail = `verify+settings-b-${stamp}@xiaoli.test`
    const b = await apiAs(baseUrl, { email: bEmail, password: THROWAWAY_PASSWORD, signUp: true })
    const seed2 = await apiAs(baseUrl, { email: SEED_ACCOUNTS.seed2.email, password: SEED_ACCOUNTS.seed2.password })
    try {
      let aId = ''
      let bId = ''
      let bBefore: Record<string, number> = {}
      let seed2Before: Record<string, number> = {}
      let bStateBefore: Awaited<ReturnType<typeof ownerState>> | null = null

      await step('setup: fill A and B (import + uploaded image + manual claim + settings)', async () => {
        aId = ((await api.get<{ user: { id: string } }>('/api/me')).json as { user: { id: string } }).user.id
        bId = ((await (await b.get('/api/me')).json()) as { user: { id: string } }).user.id
        // the fresh account is shared across widths: clear anything a previous width left behind
        await api.delete('/api/data', { confirm: '删除全部数据' })
        const a = await fillAccount(posterFromScenario(api), PRIVATE_1, `A${width}`)
        await api.patch('/api/settings', { selfDisplayNames: ['小满', '阿满'], extractModel: 'deepseek-v4-pro', onboarded: true })
        const bFill = await fillAccount(posterFromContext(b), PRIVATE_2, `B${width}`)
        await b.patch('/api/settings', { data: { selfDisplayNames: ['乙'], onboarded: true } })
        check('A image uploaded to R2', a.uploaded === 1, a)
        check('B image uploaded to R2', bFill.uploaded === 1, bFill)
      })

      await step('before: counts of A, B, seed2', async () => {
        const aDump = (await api.get<Dump>('/api/export')).json!
        const aCounts = tableCounts(aDump)
        check('A has messages, persons, handles, claims, attachments', ['messages', 'persons', 'handles', 'claims', 'attachments', 'importMessages', 'imports', 'chats'].every((t) => aCounts[t] > 0), aCounts)
        bBefore = tableCounts((await (await b.get('/api/export')).json()) as Dump)
        seed2Before = tableCounts((await (await seed2.get('/api/export')).json()) as Dump)
        check('seed2 has data to compare', seed2Before.persons > 0, seed2Before)
        const aState = await ownerState(aId, log)
        check('A has R2 objects', aState.r2 >= 1, aState)
        bStateBefore = await ownerState(bId, log)
      })

      await step('open settings with A filled', () => helpers.goto('/settings', { waitFor: '[data-self-names]' }))

      await step('dialog: type the confirmation text', async () => {
        await page.getByRole('button', { name: '删除全部数据…' }).click()
        await page.locator('[data-delete-all-dialog]').waitFor()
        await page.locator('#delete-all-confirm').fill('删除全部数据')
        check('confirm enabled', await page.locator('[data-delete-all-dialog]').getByRole('button', { name: '删除全部数据', exact: true }).isEnabled())
      })
      await shot('confirm-typed', { fullPage: false })

      await step('delete from the UI', async () => {
        const [res] = await Promise.all([
          page.waitForResponse((r) => r.url().endsWith('/api/data') && r.request().method() === 'DELETE'),
          page.locator('[data-delete-all-dialog]').getByRole('button', { name: '删除全部数据', exact: true }).click(),
        ])
        check('DELETE /api/data 200', res.status() === 200, { status: res.status() })
        const body = (await res.json()) as { deleted: Record<string, number>; r2Objects: number }
        check('response has 18 table keys', Object.keys(body.deleted).length === 18, Object.keys(body.deleted))
        check('response counts messages and r2 objects', body.deleted.messages > 0 && body.r2Objects >= 1, body)
        await page.locator('[data-delete-all-dialog]').waitFor({ state: 'detached' })
        await page.locator('[data-deleted-all]').waitFor()
        await page.locator('[data-self-names-empty]').waitFor({ timeout: 10_000 })
        check('settings block now empty (defaults)', true)
        check('model back to default', (await page.locator('#extract-model').innerText()).includes('默认（deepseek-flash）'))
        // full-page shot from the top, otherwise the sticky top bar is painted where the viewport was
        await page.evaluate(() => window.scrollTo(0, 0))
      })
      await shot('after-delete')

      await step('after: A is empty in D1 and R2, account kept', async () => {
        const aState = await ownerState(aId, log)
        const nonZero = Object.entries(aState.rows).filter(([, n]) => n !== 0)
        check('A: 0 rows in every §11 table', nonZero.length === 0, aState.rows)
        check('A: R2 prefix empty', aState.r2 === 0, aState)
        const dump = (await api.get<Dump>('/api/export')).json!
        check('A: export arrays all empty', Object.values(tableCounts(dump)).every((n) => n === 0), tableCounts(dump))
        check('A: settings defaults', dump.settings.selfDisplayNames.length === 0 && dump.settings.extractModel === null && dump.settings.highConfidenceThreshold === 0.8, dump.settings)
        check('A: still signed in', (await api.get('/api/me')).status === 200)
      })

      await step('after: B and seed2 untouched', async () => {
        const bAfter = tableCounts((await (await b.get('/api/export')).json()) as Dump)
        check('B export counts unchanged', JSON.stringify(bAfter) === JSON.stringify(bBefore), { bBefore, bAfter })
        const bStateAfter = await ownerState(bId, log)
        check('B D1 rows + R2 unchanged', JSON.stringify(bStateAfter) === JSON.stringify(bStateBefore), { bStateBefore, bStateAfter })
        const s2After = tableCounts((await (await seed2.get('/api/export')).json()) as Dump)
        check('seed2 export counts unchanged', JSON.stringify(s2After) === JSON.stringify(seed2Before), { seed2Before, s2After })
      })

      await step('A can use the app again: home loads, import again works', async () => {
        await helpers.goto('/')
        const again = await fillAccount(posterFromScenario(api), PRIVATE_1, `A${width}-again`)
        check('re-import after delete-all works', again.importId > 0, again)
        await api.delete('/api/data', { confirm: '删除全部数据' })
      })
    } finally {
      // B is a throwaway: leave it empty
      await b.delete('/api/data', { data: { confirm: '删除全部数据' } }).catch(() => undefined)
      await b.dispose()
      await seed2.dispose()
    }
  },
})
