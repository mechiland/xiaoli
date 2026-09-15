import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Route } from 'playwright'
import { parseExportZip } from '@/lib/wechat-export'
import { defineScenario } from '@/verify/lib'
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
  description: '删除这次导入（新账号）：底部按钮 → 确认对话框 → 删除失败时对话框内报错 → 删除成功回到首页；被删导入 404、只出现在它里面的人物消失、另一份导入与聊天保留',
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
