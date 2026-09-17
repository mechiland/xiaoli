import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Route } from 'playwright'
import { parseExportZip } from '@/lib/wechat-export'
import { defineScenario } from '~/verify/lib'
import { detailUrl, fulfillJson, guardJobs, reviewUrl, type Detail, type Review } from './_support'

// F7 delete import from the UI, on a throwaway account (no seed data, no LLM):
//   A = a synthetic private chat (creates the person 一舟), B = a later import of only my own messages into the same chat.
// Delete A from its result page: dialog → (a failed DELETE keeps the dialog open with an inline error) → 删除 → '/'.
// Then: A is 404, B still exists, the chat keeps B's messages (reassigned, ARCHITECTURE §11 step 1), 一舟 is gone.
// Evidence-level F7 (items evidenced only by A's messages disappear) runs on real extracted items in live-flow.
const ZIP = path.resolve(process.cwd(), 'fixtures', 'synthetic', '聊天记录_20260405_223012.zip')
const SELF = '小满'
const OTHER = '一舟'

export default defineScenario({
  id: 'import-result/delete-import',
  description: '删除这次导入（新账号）：底部按钮 → 确认对话框 → 删除失败时对话框内报错 → 删除成功回到首页；被删导入的页面直接显示没有找到（无失败请求）；另一份导入的结果页说明消息在已删除的导入里读过；被删导入 404、只出现在它里面的人物消失、另一份导入与聊天保留',
  account: 'fresh',
  destructive: true,
  expectedFailures: [
    { urlPattern: /\/api\/imports\/\d+$/, status: 500, step: 'delete fails inside the dialog', consoleText: 'status of 500' },
    { urlPattern: /\/api\/imports\/\d+$/, status: 404, step: 'server state after delete' },
  ],
  async run(ctx) {
    const { page, step, shot, check, helpers, api, width } = ctx
    const parsed = await parseExportZip(new Uint8Array(readFileSync(ZIP)), { fileName: path.basename(ZIP) })
    let aId = 0
    let bId = 0
    let chatId = 0
    let otherPersonId = 0
    let bMessages = 0

    await step('setup: two imports through the API', async () => {
      await api.patch('/api/settings', { selfDisplayNames: [SELF], onboarded: true })
      const dup = await api.post<{ duplicate: boolean; importId?: number }>('/api/imports/check', { sha256: parsed.sha256 })
      if (dup.json?.duplicate && dup.json.importId) await api.delete(`/api/imports/${dup.json.importId}`)
      const a = await api.post<{ import: { id: number } }>('/api/imports', {
        fileName: parsed.fileName,
        sha256: parsed.sha256,
        exportedAt: parsed.exportedAt,
        parserVersion: parsed.parserVersion,
        messages: parsed.messages,
        media: parsed.media,
        selectedAttachments: [],
      })
      check('POST A 201', a.status === 201, { status: a.status })
      aId = a.json!.import.id
      const ma = await api.post<{ chat: { id: number } }>(`/api/imports/${aId}/mapping`, {
        chat: { new: { title: OTHER, kind: 'private' } },
        senders: parsed.senders.map((s) => ({ senderName: s.name, target: s.name === SELF ? { self: true } : { newPerson: { label: OTHER } } })),
      })
      check('mapping A 200', ma.status === 200, { status: ma.status, text: ma.text.slice(0, 200) })
      chatId = ma.json!.chat.id
      const detail = await api.get<Detail>(`/api/imports/${aId}`)
      otherPersonId = detail.json?.persons.find((p) => p.label === OTHER)?.id ?? 0
      check('A created 一舟', otherPersonId > 0, detail.json?.persons)

      const mine = parsed.messages.filter((m) => m.senderName === SELF).slice(0, 40)
      bMessages = mine.length
      const sha = createHash('sha256').update(`import-result/delete-import:${width}:${Date.now()}`).digest('hex')
      const b = await api.post<{ import: { id: number } }>('/api/imports', {
        fileName: `subset-${width}.zip`,
        sha256: sha,
        exportedAt: parsed.exportedAt,
        parserVersion: parsed.parserVersion,
        messages: mine.map((m, i) => ({ ...m, idx: i })),
        media: [],
        selectedAttachments: [],
      })
      check('POST B 201', b.status === 201, { status: b.status })
      bId = b.json!.import.id
      const mb = await api.post(`/api/imports/${bId}/mapping`, { chat: { existingChatId: chatId }, senders: [{ senderName: SELF, target: { self: true } }] })
      check('mapping B 200', mb.status === 200, { status: mb.status, text: mb.text.slice(0, 200) })
      const bd = (await api.get<Detail>(`/api/imports/${bId}`)).json
      check('B is a re-export: 0 new messages, no windows', bd?.import.newMessageCount === 0 && bd?.progress.total === 0, { imp: bd?.import, progress: bd?.progress })
    })

    await step('open A', async () => {
      // A has pending extraction jobs: never let the page reach the LLM from a UI test. Present it as reviewed.
      await guardJobs(page)
      const d = (await api.get<Detail>(`/api/imports/${aId}`)).json!
      const r = (await api.get<Review>(`/api/imports/${aId}/review`)).json!
      await page.route(detailUrl(aId), (route: Route) =>
        route.request().method() === 'GET' ? fulfillJson(route, { ...d, import: { ...d.import, status: 'reviewing' } }) : route.fallback(),
      )
      await page.route(reviewUrl(aId), (route: Route) => fulfillJson(route, { ...r, import: { ...r.import, status: 'reviewing' } }))
      await helpers.goto(`/imports/${aId}`, { waitFor: '[data-delete-import]' })
    })

    await step('dialog opens', async () => {
      await page.locator('[data-delete-import]').click()
      await page.locator('[data-delete-dialog]').waitFor()
    })
    await shot('dialog', { fullPage: false })

    await step('delete fails inside the dialog', async () => {
      const fail = (route: Route) =>
        route.request().method() === 'DELETE' ? fulfillJson(route, { error: { code: 'internal', message: '服务器出错了' } }, 500) : route.fallback()
      await page.route(detailUrl(aId), fail)
      await page.locator('[data-delete-confirm]').click()
      await page.locator('[data-delete-dialog] [role=alert]').waitFor({ timeout: 10_000 })
      check('dialog stays open', await page.locator('[data-delete-dialog]').isVisible())
      check('still on the page', new URL(page.url()).pathname === `/imports/${aId}`)
      await page.unroute(detailUrl(aId), fail)
    })
    await shot('dialog-error', { fullPage: false })

    await step('delete → home', async () => {
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === 'DELETE' && new RegExp(`/api/imports/${aId}$`).test(r.url())),
        page.locator('[data-delete-confirm]').click(),
      ])
      check('DELETE 200', res.status() === 200, { status: res.status() })
      await page.waitForURL((u) => u.pathname === '/', { timeout: 15_000 })
      await helpers.settle()
    })
    await shot('home-after-delete', { fullPage: false })

    // An old tab or bookmark: the server page finds no import and renders the missing state itself, so the browser
    // never asks GET /api/imports/:id and the console stays clean (overall critic r3 #3).
    await step('deleted import page: missing state, no failing fetch', async () => {
      await helpers.clearRoutes()
      await guardJobs(page)
      const hits: string[] = []
      const own = new RegExp(`/api/imports/${aId}(/|$)`)
      const onRequest = (req: { url(): string }) => {
        if (own.test(req.url())) hits.push(req.url())
      }
      page.on('request', onRequest)
      const status = await helpers.goto(`/imports/${aId}`, { waitFor: '[data-import-result-missing]' })
      await helpers.settle()
      page.off('request', onRequest)
      check('missing state copy', ((await page.locator('[data-import-result-missing]').textContent()) ?? '').includes('它可能已经被删除了'))
      check('no request for the deleted import', hits.length === 0, { hits })
      check('document answers 200', status === 200, { status })
    })
    await shot('deleted-import-page', { fullPage: false })

    // B's 40 messages were A's; deleting A hands them to B and recounts it (ARCHITECTURE §11 step 1). B still read
    // nothing, so its page must not say "新增 40 条消息" above "之前都导入过" (overall critic r3 #4).
    await step('re-export page after the earlier import is deleted', async () => {
      const d = (await api.get<Detail>(`/api/imports/${bId}`)).json
      check('B recounted, still no windows', d?.import.newMessageCount === bMessages && d?.progress.total === 0, { imp: d?.import, progress: d?.progress })
      await helpers.goto(`/imports/${bId}`, { waitFor: '[data-empty-result]' })
      const box = page.locator('[data-empty-result]')
      const text = (await box.textContent()) ?? ''
      check('kind read-before', (await box.getAttribute('data-empty-result')) === 'read-before')
      check('says the messages were read by the deleted import', text.includes('这份记录里的消息在之前那次导入时读过（那次导入已删除），这次没有再读取'), { text })
      check('no "之前都导入过" copy', !text.includes('之前都导入过'))
      const sub = ((await page.locator('[data-import-subtitle]').textContent()) ?? '').replace(/\s/g, '')
      check('subtitle: count without 新增', !sub.includes('新增') && sub.includes(`${bMessages}条消息`), { sub })
      const people = page.locator('[data-earlier-people] a[href^="/p/"]')
      check('links the people, not the chat', (await people.count()) > 0 && (await box.locator('a[href^="/chats/"]').count()) === 0)
      check('own person named 我', (await people.allTextContents()).includes('我'), { people: await people.allTextContents() })
    })
    await shot('reexport-after-delete', { fullPage: false })

    await step('server state after delete', async () => {
      await helpers.clearRoutes()
      check('A is 404', (await api.get(`/api/imports/${aId}`)).status === 404)
      const b = await api.get<Detail>(`/api/imports/${bId}`)
      check('B still exists', b.status === 200, { status: b.status })
      const chats = await api.get<{ chats: { id: number; messageCount: number }[] }>('/api/chats')
      const chat = chats.json?.chats.find((c) => c.id === chatId)
      check('chat keeps B’s messages', chat?.messageCount === bMessages, { chat, bMessages })
      const people = await api.get<{ people: { person: { id: number } }[] }>(`/api/search?q=${encodeURIComponent(OTHER)}&types=people`)
      check('一舟 (created only by A) is gone', !(people.json?.people ?? []).some((p) => p.person.id === otherPersonId), people.json)
      await api.delete(`/api/imports/${bId}`)
    })
  },
})
