import { defineScenario } from '@/verify/lib'
import { deleteImportOf, importViaApi, parseFixture, PRIVATE_1, PRIVATE_2, SELF_NAME, stubJobsNext } from './_support'

// Overall critic r1: deleting an import whose messages a later overlapping import also contained reassigns those
// messages to the later import (ARCHITECTURE §11 step 1); that import's new_message_count must be recounted
// (DECISIONS import I19), so the chat page's import record reads the messages it now first introduces.
export default defineScenario({
  id: 'import/delete-reassign',
  description: '删除较早的重叠导入后，接手消息的导入「新增 N 条」随之更新（聊天页导入记录）',
  account: 'fresh',
  expectedFailures: [{ urlPattern: '/api/imports/', status: 404, step: 'delete the first import from its result page' }],
  async run({ page, step, shot, check, helpers, api }) {
    type ChatDetail = { imports: { id: number; newMessageCount: number }[] }
    let first = 0
    let second = 0
    let chatId = 0
    let secondTotal = 0

    await step('setup: two overlapping imports into one chat', async () => {
      await api.patch('/api/settings', { selfDisplayNames: [SELF_NAME], onboarded: true })
      await stubJobsNext(page)
      await deleteImportOf(api, PRIVATE_2)
      await deleteImportOf(api, PRIVATE_1)
      ;({ importId: first, chatId } = await importViaApi(api, PRIVATE_1, { title: '一舟', kind: 'private' }))
      const p2 = await parseFixture(PRIVATE_2)
      secondTotal = p2.messages.length
      const created = await api.post<{ import: { id: number } }>('/api/imports', {
        fileName: p2.fileName,
        sha256: p2.sha256,
        exportedAt: p2.exportedAt,
        parserVersion: p2.parserVersion,
        messages: p2.messages,
        media: p2.media,
        selectedAttachments: [],
      })
      second = created.json!.import.id
      const people = await api.get<{ participants: { id: number; label: string }[] }>(`/api/chats/${chatId}`)
      const yizhou = people.json!.participants.find((p) => p.label === '一舟')!
      const mapped = await api.post<{ newMessageCount: number }>(`/api/imports/${second}/mapping`, {
        chat: { existingChatId: chatId },
        senders: [
          { senderName: SELF_NAME, target: { self: true } },
          { senderName: '一舟', target: { personId: yizhou.id } },
        ],
      })
      check('second import maps into the same chat', mapped.status === 200, { status: mapped.status })
      check('second import brings 32 fewer new messages (overlap)', mapped.json?.newMessageCount === secondTotal - 32, mapped.json)
      await helpers.goto(`/chats/${chatId}`)
      await page.locator('[data-chat-imports] li').nth(1).waitFor()
    })
    await shot('chat-before-delete', { selector: '[data-chat-header]' })

    await step('delete the first import from its result page', async () => {
      await helpers.goto(`/imports/${first}`)
      await page.getByRole('button', { name: '删除这次导入' }).click()
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith(`/api/imports/${first}`) && r.request().method() === 'DELETE'),
        page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click(),
      ])
      const body = (await res.json()) as { reassignedMessages: number }
      check('DELETE 200 with 32 reassigned messages', res.status() === 200 && body.reassignedMessages === 32, body)
      await page.waitForURL((u) => u.pathname === '/')
    })

    await step('chat page: the remaining import owns every message', async () => {
      const d = await api.get<ChatDetail>(`/api/chats/${chatId}`)
      check('GET /api/chats/:id imports = [second] with newMessageCount = all its messages', JSON.stringify(d.json?.imports.map((i) => [i.id, i.newMessageCount])) === JSON.stringify([[second, secondTotal]]), d.json?.imports)
      const detail = await api.get<{ import: { newMessageCount: number } }>(`/api/imports/${second}`)
      check('GET /api/imports/:id newMessageCount matches', detail.json?.import.newMessageCount === secondTotal, detail.json?.import)
      await helpers.goto(`/chats/${chatId}`)
      const line = page.locator('[data-chat-imports] li')
      await line.first().waitFor()
      const text = (await line.first().innerText()).replace(/\s+/g, '')
      check('import record reads 新增 N 条 with the recounted N', (await line.count()) === 1 && text.includes(`新增${secondTotal}条`), { text })
    })
    await shot('chat-after-delete', { selector: '[data-chat-header]' })

    await step('cleanup', async () => {
      await helpers.goto('/')
      if (second) await api.delete(`/api/imports/${second}`)
    })
  },
})
