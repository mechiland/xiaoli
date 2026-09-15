import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page, Route } from 'playwright'
import { defineScenario } from '@/verify/lib'

// Chat page (SPEC §9.10) on seed data + fixtures:
// contract & isolation → at= highlight mid-history → older page keeps the position → header participants → image
// thumbnail + enlarged view → "图片未导入" → private chat from the start, merged runs, reaching the end → 跳到最新 →
// 导入新的记录 → loading → per-block errors → not found → a 5,000-message chat (route-generated) stays windowed →
// fixture page with every message kind, unlinked sender, long multi-line message.

interface Msg {
  id: number
  seq: number
  sentAt: string
  kind: string
  senderPersonId: number | null
  attachments: { id: number; kind: string; uploaded: boolean; selected: boolean }[]
}
interface Page_ {
  messages: Msg[]
  hasOlder: boolean
  hasNewer: boolean
  anchorId: number | null
}

const LONG_CHAT = 99999998
const MISSING_CHAT = 99999997
const EMPTY_CHAT = 99999996
const LONG_TITLE_CHAT = 99999995
const FAKE_IMPORT = 99999990
const LONG_N = 5000
const SMALLEST_ZIP = path.resolve('fixtures/synthetic/聊天记录_20260405_223012.zip')
const ISO = '2026-09-15T00:00:00.000Z'

/** stub both chat routes for a synthetic chat: detail + a fixed message list */
async function routeStubChat(page: Page, chat: { id: number; title: string; kind: 'group' | 'private'; messages: ReturnType<typeof longChatMessage>[] }, extra: { participants?: unknown[]; imports?: unknown[] } = {}) {
  await page.route(new RegExp(`/api/chats/${chat.id}(/messages)?(\\?|$)`), async (route: Route) => {
    const url = new URL(route.request().url())
    const body = url.pathname.endsWith('/messages')
      ? { messages: chat.messages, hasOlder: false, hasNewer: false, anchorId: null }
      : {
          chat: { id: chat.id, title: chat.title, kind: chat.kind, note: null, messageCount: chat.messages.length, lastMessageAt: chat.messages.at(-1)?.sentAt ?? null, createdAt: ISO, updatedAt: ISO },
          participants: extra.participants ?? [],
          imports: extra.imports ?? [],
        }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

function longChatMessage(i: number) {
  const day = 1 + Math.floor(i / 160)
  const minute = 8 * 60 + (i % 160) * 5
  const sentAt = `2026-0${1 + Math.floor((day - 1) / 28)}-${String(((day - 1) % 28) + 1).padStart(2, '0')} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
  const who = i % 7 < 3 ? 0 : i % 7 < 5 ? 1 : 2
  return {
    id: 7_000_001 + i,
    chatId: LONG_CHAT,
    seq: (i + 1) * 1024,
    sentAt,
    kind: 'text',
    body: i % 23 === 0 ? `第 ${i + 1} 条：这是一条稍长的消息，用来让行高有变化，检查窗口加载时的位置保持。` : `第 ${i + 1} 条`,
    meta: null,
    senderHandleId: null,
    senderName: ['阿青', '小北', '老周'][who],
    senderPersonId: null,
    senderLabel: null,
    attachments: [],
  }
}

async function routeLongChat(page: Page) {
  await page.route(new RegExp(`/api/chats/${LONG_CHAT}(/messages)?(\\?|$)`), async (route: Route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.endsWith('/messages')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          chat: { id: LONG_CHAT, title: '五千条消息的群', kind: 'group', note: null, messageCount: LONG_N, lastMessageAt: longChatMessage(LONG_N - 1).sentAt, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
          participants: [],
          imports: [],
        }),
      })
    }
    const p = url.searchParams
    const idxOfSeq = (seq: number) => seq / 1024 - 1
    let from = 0
    let to = 0
    let anchorId: number | null = null
    if (p.get('around')) {
      const i = Number(p.get('around')) - 7_000_001
      from = Math.max(0, i - Number(p.get('before') ?? 50))
      to = Math.min(LONG_N, i + Number(p.get('after') ?? 50) + 1)
      anchorId = Number(p.get('around'))
    } else if (p.get('cursor')) {
      const c = idxOfSeq(Number(p.get('cursor')))
      const limit = Number(p.get('limit') ?? 100)
      if (p.get('dir') === 'newer') {
        from = c + 1
        to = Math.min(LONG_N, from + limit)
      } else {
        to = c
        from = Math.max(0, to - limit)
      }
    } else {
      from = 0
      to = Math.min(LONG_N, Number(p.get('limit') ?? 100))
    }
    const messages = Array.from({ length: to - from }, (_, k) => longChatMessage(from + k))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages, hasOlder: from > 0, hasNewer: to < LONG_N, anchorId }) })
  })
}

export default defineScenario({
  id: 'chat/showcase',
  description: '聊天原文页：定位加底色、双向分页、合并发送者、图片与放大、图片未导入、导入新的记录、加载、分块出错、没有找到、五千条消息、各种消息类型',
  account: 'seed',
  requiredTags: ['chat:group-big', 'chat:private-long', 'chat:group-badminton'],
  expectedFailures: [
    { urlPattern: '/api/attachments/', status: 404, step: 'api: contract and isolation' },
    { urlPattern: '/api/chats/', status: 404, step: 'api: contract and isolation' },
    { urlPattern: `/api/chats/${MISSING_CHAT}`, status: 404, step: 'not found', consoleText: 'status of 404' },
    { urlPattern: '/messages', status: 500, step: 'error: messages block', consoleText: 'status of 500' },
    { urlPattern: '/api/chats/', status: 500, step: 'error: header block', consoleText: 'status of 500' },
  ],
  async run({ page, step, shot, check, helpers, seed, api, width, outDir }) {
    const group = await seed.chat('group-big')
    const priv = await seed.chat('private-long')
    const badminton = await seed.chat('group-badminton')

    const elementShot = async (name: string, selector: string) => {
      const set = (on: boolean) =>
        page.evaluate((flag) => {
          const bar = document.querySelector<HTMLElement>('header.sticky')
          if (bar) bar.style.position = flag ? 'static' : ''
        }, on)
      await set(true)
      await page.locator(selector).first().scrollIntoViewIfNeeded()
      let file: string
      try {
        file = await shot(name, { selector, fullPage: false })
      } finally {
        await set(false)
      }
      // a screenshot of the wrong spot is a flat field of page colour: fail it (round 2 passed a blank image)
      const probe = await page.context().newPage()
      try {
        const spread = (await probe.evaluate(`(async () => {
          const img = new Image(); img.src = 'data:image/png;base64,${readFileSync(path.join(outDir, file), 'base64')}'; await img.decode()
          const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
          const x = c.getContext('2d'); x.drawImage(img, 0, 0)
          const d = x.getImageData(0, 0, c.width, c.height).data
          let min = 255, max = 0
          for (let i = 0; i < d.length; i += 4 * 7) { const l = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10; if (l < min) min = l; if (l > max) max = l }
          return max - min
        })()`)) as number
        check(`screenshot ${name} is not blank`, spread > 40, { spread })
      } finally {
        await probe.close()
      }
      return file
    }
    const rowCount = () => page.locator('[data-message-id]').count()
    const waitRows = async () => {
      await page.locator('[data-message-id]').first().waitFor({ timeout: 20_000 })
      await helpers.settle({ quietMs: 300 })
    }

    // ---- API ---------------------------------------------------------------------------------------------------
    let midId = 0
    let imageMsgId = 0
    let pendingMsgId = 0
    await step('api: contract and isolation', async () => {
      const d = await api.get<{ participants: unknown[]; imports: unknown[]; chat: { messageCount: number } }>(`/api/chats/${group.id}`)
      check('GET /api/chats/:id 200', d.status === 200, { status: d.status })
      check('group has > 12 participants and ≥ 2 imports', (d.json?.participants.length ?? 0) > 12 && (d.json?.imports.length ?? 0) >= 2)

      const all: Msg[] = []
      let cursor: number | null = null
      for (let i = 0; i < 12; i++) {
        const r: { json: Page_ | null } = await api.get<Page_>(`/api/chats/${group.id}/messages?${cursor == null ? 'dir=newer' : `cursor=${cursor}&dir=newer`}&limit=500`)
        const pg = r.json!
        all.push(...pg.messages)
        if (!pg.hasNewer) break
        cursor = pg.messages[pg.messages.length - 1].seq
      }
      check('paging newer walks the whole chat once, in seq order', all.length === d.json?.chat.messageCount && all.every((m, i) => i === 0 || m.seq > all[i - 1].seq), {
        walked: all.length,
        count: d.json?.chat.messageCount,
      })
      midId = all[Math.floor(all.length / 2)].id
      imageMsgId = all.find((m) => m.attachments.some((a) => a.kind === 'image' && a.uploaded))?.id ?? 0
      check('group has an uploaded image', imageMsgId > 0)
      const around = await api.get<Page_>(`/api/chats/${group.id}/messages?around=${midId}&before=50&after=50`)
      check('around: 101 messages, anchor in the middle', around.json?.messages.length === 101 && around.json?.messages[50].id === midId && around.json?.anchorId === midId)

      const up = all.flatMap((m) => m.attachments).find((a) => a.uploaded)!
      const img = await api.get(`/api/attachments/${up.id}`)
      check('attachment streams as image/png', img.status === 200 && img.headers['content-type'] === 'image/png' && img.headers['x-content-type-options'] === 'nosniff', { status: img.status, type: img.headers['content-type'] })

      const b = await api.get<Page_>(`/api/chats/${badminton.id}/messages?dir=newer&limit=500`)
      let bAll = b.json!.messages
      if (b.json!.hasNewer) bAll = bAll.concat((await api.get<Page_>(`/api/chats/${badminton.id}/messages?cursor=${bAll[bAll.length - 1].seq}&dir=newer&limit=500`)).json!.messages)
      const pending = bAll.find((m) => m.attachments.some((a) => a.selected && !a.uploaded))!
      pendingMsgId = pending.id
      const miss = await api.get<{ error: { code: string } }>(`/api/attachments/${pending.attachments[0].id}`)
      check('not uploaded attachment → 404 attachment_missing', miss.status === 404 && miss.json?.error.code === 'attachment_missing')

      const manifest = JSON.parse(readFileSync(path.resolve('.dev/seed-manifest.json'), 'utf8'))
      const otherChat = manifest.accounts.seed2?.chats?.group?.id
      if (otherChat) {
        const iso = await api.get(`/api/chats/${otherChat}`)
        const isoMsgs = await api.get(`/api/chats/${otherChat}/messages`)
        check("another account's chat → 404", iso.status === 404 && isoMsgs.status === 404, { detail: iso.status, messages: isoMsgs.status })
      }
    })

    // ---- at= mid-history -----------------------------------------------------------------------------------------
    await step('open at= mid-history', async () => {
      await helpers.goto(`/chats/${group.id}?at=${midId}`, { waitFor: '[data-highlight-message]' })
      await page.locator('[data-chat-header]').waitFor({ timeout: 15_000 })
      await helpers.settle({ quietMs: 400 })
      const box = await page.locator('[data-highlight-message]').boundingBox()
      const vh = page.viewportSize()!.height
      check('target row is tinted and near the viewport centre', !!box && Math.abs(box.y + box.height / 2 - vh / 2) < vh * 0.2, { box, vh })
      check('only a window of the chat is rendered', (await rowCount()) <= 400, { rows: await rowCount() })
    })
    await shot('at-highlight', { fullPage: false })

    await step('scrolling up loads older messages and holds the position', async () => {
      const before = await rowCount()
      // bring the "older" edge into range and remember the first row under the top bar
      const probe = await page.evaluate(`(() => {
        const edge = document.querySelector('[data-chat-load-older]')
        if (edge) window.scrollTo(0, window.scrollY + edge.getBoundingClientRect().bottom - 200)
        const rows = [...document.querySelectorAll('[data-message-id]')]
        const row = rows.find((r) => r.getBoundingClientRect().top > 80)
        return row ? { id: row.dataset.messageId, top: row.getBoundingClientRect().top } : null
      })()`)
      await page.waitForFunction(`document.querySelectorAll('[data-message-id]').length > ${before}`, undefined, { timeout: 15_000 })
      await helpers.settle({ quietMs: 300 })
      const p = probe as { id: string; top: number } | null
      const after = p ? await page.locator(`[data-message-id="${p.id}"]`).boundingBox() : null
      check('older page prepended', (await rowCount()) > before, { before, after: await rowCount() })
      check('the row under the reader did not move (< 4 px)', !!p && !!after && Math.abs(after.y - p.top) < 4, { probe: p, after })
    })
    await shot('older-loaded', { fullPage: false })

    await step('header: participants collapse and expand', async () => {
      await page.evaluate('window.scrollTo(0, 0)')
      const dd = page.locator('[data-chat-participants]')
      check('collapsed shows 等 N 人', /等 \d+ 人/.test(await dd.innerText()))
      check('import records link to /imports/:id', /^\/imports\/\d+$/.test((await page.locator('[data-chat-imports] a').first().getAttribute('href')) ?? ''))
    })
    await elementShot('header-group', '[data-chat-header]')
    await step('expand participants', async () => {
      // on a chat opened from the start: no older pages to load at scroll 0, so any movement comes from the expand itself
      await helpers.goto(`/chats/${group.id}`, { waitFor: '[data-message-id]' })
      await page.locator('[data-chat-header] [data-chat-participants]').waitFor({ timeout: 15_000 })
      await page.evaluate('window.scrollTo(0, 0)')
      await helpers.settle({ quietMs: 500 })
      const where =() => page.evaluate(`({ y: window.scrollY, top: document.querySelector('[data-chat-header]').getBoundingClientRect().top, h: document.querySelector('[data-chat-header]').getBoundingClientRect().height })`) as Promise<{ y: number; top: number; h: number }>
      const before = await where()
      await page.getByRole('button', { name: '全部显示' }).click()
      await page.waitForTimeout(800)
      const after = await where()
      check('收起 appears', (await page.getByRole('button', { name: '收起' }).count()) === 1)
      check('header grew in place: scrollY and header top unchanged', after.h > before.h && Math.abs(after.y - before.y) < 1 && Math.abs(after.top - before.top) < 1, { before, after })
    })
    await elementShot('header-group-expanded', '[data-chat-header]')

    // ---- images --------------------------------------------------------------------------------------------------
    await step('image thumbnail', async () => {
      await helpers.goto(`/chats/${group.id}?at=${imageMsgId}`, { waitFor: '[data-highlight-message] [data-chat-image]' })
      await page.waitForFunction(`(() => { const i = document.querySelector('[data-highlight-message] [data-chat-image] img'); return !!i && i.complete && i.naturalWidth > 0 })()`, undefined, { timeout: 15_000 })
    })
    await shot('image-thumbnail', { fullPage: false })
    const checkEnlarged = async (thumbWidth: number) => {
      await page.waitForFunction(`(() => { const i = document.querySelector('[data-chat-image-viewer] img'); return !!i && i.complete && i.naturalWidth > 0 })()`)
      await page.waitForTimeout(300) // dialog zoom-in animation
      const shown = await page.evaluate(`(() => {
        const i = document.querySelector('[data-chat-image-viewer] img'); const r = i.getBoundingClientRect()
        const scale = Math.min(r.width / i.naturalWidth, r.height / i.naturalHeight)
        return { box: r.width, rendered: Math.round(i.naturalWidth * scale) }
      })()`) as { box: number; rendered: number }
      check('enlarged image is at least 2× the thumbnail width', shown.rendered >= thumbWidth * 2 - 1, { thumbWidth, ...shown })
      const vw = page.viewportSize()!.width
      check('viewer fits the viewport', ((await page.locator('[data-chat-image-viewer]').boundingBox())?.width ?? 0) <= vw)
    }
    await step('image enlarged', async () => {
      const thumb = await page.locator('[data-highlight-message] [data-chat-image]').boundingBox()
      await page.locator('[data-highlight-message] [data-chat-image]').click()
      await page.locator('[data-chat-image-viewer] img').waitFor()
      await checkEnlarged(thumb?.width ?? 0)
    })
    await shot('image-enlarged', { fullPage: false })
    await step('close enlarged view', async () => {
      await page.keyboard.press('Escape')
      await page.locator('[data-chat-image-viewer]').waitFor({ state: 'detached' })
    })

    await step('image not imported placeholder', async () => {
      await helpers.goto(`/chats/${badminton.id}?at=${pendingMsgId}`, { waitFor: '[data-highlight-message]' })
      check('placeholder "图片未导入" on the target', (await page.locator('[data-highlight-message] [data-chat-image-missing]').innerText()).includes('图片未导入'))
      await helpers.settle({ quietMs: 300 })
    })
    await shot('image-missing', { fullPage: false })

    // ---- private chat from the start ---------------------------------------------------------------------------
    await step('private chat from the start', async () => {
      await helpers.goto(`/chats/${priv.id}`)
      await waitRows()
      const rows = await rowCount()
      const runs = await page.locator('[data-run-start]').count()
      check('first page is 100 messages', rows === 100, { rows })
      check('consecutive messages merge (fewer runs than rows)', runs < rows, { runs, rows })
      check('senders link to person pages', /^\/p\/\d+$/.test((await page.locator('[data-sender-link]').first().getAttribute('href')) ?? ''))
      check('private header has one participant', (await page.locator('[data-chat-participants] a').count()) === 1)
    })
    await shot('private-start', { fullPage: true })

    await step('private chat: scrolling reaches the end, DOM stays windowed', async () => {
      let maxRows = 0
      for (let i = 0; i < 40 && (await page.locator('[data-chat-end]').count()) === 0; i++) {
        await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
        await page.waitForTimeout(250)
        await helpers.settle({ quietMs: 150, timeoutMs: 3000 })
        maxRows = Math.max(maxRows, await rowCount())
      }
      check('end marker reached', (await page.locator('[data-chat-end]').count()) === 1)
      check('never more than 10 pages in the DOM', maxRows <= 1000, { maxRows })
    })
    await shot('private-end', { fullPage: false })

    await step('跳到最新 from the start of the group', async () => {
      await helpers.goto(`/chats/${group.id}?at=${midId}`, { waitFor: '[data-highlight-message]' })
      await page.getByRole('button', { name: '跳到最新' }).click()
      await page.locator('[data-chat-end]').waitFor({ timeout: 15_000 })
      await helpers.settle({ quietMs: 300 })
      check('address no longer carries ?at=', !page.url().includes('at='), { url: page.url() })
      const end = await page.locator('[data-chat-end]').boundingBox()
      check('scrolled to the newest message', !!end && end.y < page.viewportSize()!.height, { end })
    })
    await shot('jumped-to-latest', { fullPage: false })

    await step('导入新的记录 opens the import overlay', async () => {
      await page.evaluate('window.scrollTo(0, 0)')
      await page.getByRole('button', { name: '导入新的记录' }).click()
      await page.locator('[data-import-overlay]').waitFor({ timeout: 5000 })
      await helpers.settle({ quietMs: 300 })
    })
    await shot('import-overlay', { fullPage: false })
    await step('导入新的记录 preselects this chat in step 2', async () => {
      // step 1 parses the smallest synthetic ZIP in the browser; the server side is intercepted so the seed account
      // gets no import row (check → not duplicate, create → a fake mapping import, abandon → DELETE of that fake id)
      const title = (await api.get<{ chat: { title: string } }>(`/api/chats/${group.id}`)).json!.chat.title
      await helpers.stubJson('**/api/imports/check', { duplicate: false })
      await page.route('**/api/imports', async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        const req = route.request().postDataJSON() as { fileName: string; sha256: string; messages: { senderName: string; sentAt: string }[] }
        const counts = new Map<string, number>()
        for (const m of req.messages) counts.set(m.senderName, (counts.get(m.senderName) ?? 0) + 1)
        const body = {
          import: { id: FAKE_IMPORT, chatId: null, fileName: req.fileName, fileSha256: req.sha256, exportedAt: null, status: 'mapping', messageCount: req.messages.length, newMessageCount: 0, dateFrom: req.messages[0]?.sentAt ?? null, dateTo: req.messages.at(-1)?.sentAt ?? null, stats: { byKind: {}, bySender: {}, images: { count: 0, bytes: 0 }, videos: { count: 0, bytes: 0 } }, error: null, createdAt: ISO, updatedAt: ISO },
          suggestions: { chats: [], senders: [...counts].map(([senderName, count]) => ({ senderName, count, suggested: null, candidates: [] })), preselectKind: null },
        }
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(body) })
      })
      await page.route(`**/api/imports/${FAKE_IMPORT}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
      await helpers.setInputFiles('input[data-import-file]', [{ path: SMALLEST_ZIP }])
      await page.getByRole('button', { name: '下一步' }).click({ timeout: 20_000 })
      await page.locator('[data-import-overlay][data-step="mapping"]').waitFor({ timeout: 15_000 })
      await helpers.settle({ quietMs: 400 })
      const checked = page.locator('[data-import-overlay] [role=radiogroup][aria-label="聊天"] [role=radio][aria-checked=true]')
      check('step 2 has exactly one chat selected', (await checked.count()) === 1)
      const text = await checked.first().innerText()
      check('the selected chat is this chat', text.includes(title), { selected: text, title })
    })
    await shot('import-overlay-preselected', { fullPage: false })
    await step('close overlay', async () => {
      await page.keyboard.press('Escape')
      await page.locator('[data-import-overlay]').waitFor({ state: 'detached', timeout: 5000 })
      await helpers.clearRoutes()
    })

    // ---- states ------------------------------------------------------------------------------------------------
    await step('loading', async () => {
      await helpers.simulateLoading(new RegExp(`/api/chats/${priv.id}(/messages)?(\\?|$)`), 3000)
      await page.goto(`/chats/${priv.id}`)
      await page.locator('[data-chat-header-loading]').waitFor({ timeout: 5000 })
      await page.locator('[data-chat-transcript-loading]').waitFor({ timeout: 5000 })
    })
    await shot('loading', { fullPage: false, settleMs: 100 })
    await step('loading resolves', async () => {
      await waitRows()
      await helpers.clearRoutes()
    })

    await step('error: messages block', async () => {
      await helpers.simulateError(new RegExp(`/api/chats/${priv.id}/messages`), { status: 500 })
      await helpers.goto(`/chats/${priv.id}`)
      await page.locator('[data-chat-messages-error] [role=alert]').waitFor({ timeout: 15_000 })
      check('header still renders next to the failed transcript', await page.locator('[data-chat-header]').isVisible())
      check('no message rows', (await rowCount()) === 0)
    })
    await shot('error-messages', { fullPage: false })
    await step('retry recovers the transcript', async () => {
      await helpers.clearRoutes()
      await page.getByRole('button', { name: '重试' }).click()
      await waitRows()
      check('rows after retry', (await rowCount()) > 0)
    })

    await step('error: header block', async () => {
      await helpers.simulateError(new RegExp(`/api/chats/${priv.id}(\\?|$)`), { status: 500 })
      await helpers.goto(`/chats/${priv.id}`)
      await page.locator('[data-chat-header-error]').waitFor({ timeout: 15_000 })
      await waitRows()
      check('transcript still renders under the failed header', (await rowCount()) > 0)
      check('导入新的记录 still available', await page.getByRole('button', { name: '导入新的记录' }).isVisible())
    })
    await shot('error-header', { fullPage: false })
    await step('clear error routes', () => helpers.clearRoutes())

    await step('not found', async () => {
      await helpers.goto(`/chats/${MISSING_CHAT}`, { waitFor: '[data-chat-not-found]' })
      check('not found title', (await page.locator('[data-chat-not-found]').innerText()).includes('没有找到这个聊天'))
    })
    await shot('not-found', { fullPage: false })

    await step('empty chat', async () => {
      await routeStubChat(page, { id: EMPTY_CHAT, title: '刚建好的群', kind: 'group', messages: [] })
      await helpers.goto(`/chats/${EMPTY_CHAT}`, { waitFor: '[data-chat-messages]' })
      const txt = await page.locator('main').innerText()
      check('empty copy: participants, imports, messages', txt.includes('还没有关联到人物') && txt.includes('没有导入记录') && txt.includes('这个聊天里还没有消息'))
      check('no rows, no end marker, no jump buttons', (await rowCount()) === 0 && (await page.locator('[data-chat-end]').count()) === 0 && (await page.getByRole('button', { name: '跳到最新' }).count()) === 0)
      await helpers.clearRoutes()
    })
    await shot('empty', { fullPage: false })

    await step('long title', async () => {
      const msgs = [0, 1, 2].map((i) => ({ ...longChatMessage(i), chatId: LONG_TITLE_CHAT }))
      await routeStubChat(page, { id: LONG_TITLE_CHAT, title: '二〇二六年春季小区三号楼业主装修协调与邻里互助交流群', kind: 'group', messages: msgs }, {
        imports: [{ id: 850009, dateFrom: msgs[0].sentAt, dateTo: msgs[2].sentAt, createdAt: ISO, newMessageCount: 3 }],
      })
      await helpers.goto(`/chats/${LONG_TITLE_CHAT}`, { waitFor: '[data-message-id]' })
      const header = (await page.locator('[data-chat-header-top]').boundingBox())!
      const title = (await page.locator('[data-chat-title-block]').boundingBox())!
      const action = (await page.locator('[data-chat-header-action]').boundingBox())!
      if (width < 640) {
        check('390: title takes the full row', title.width >= header.width * 0.95, { title: title.width, header: header.width })
        check('390: button sits below the title block', action.y >= title.y + title.height, { action, title })
      } else {
        check('1440: button stays beside the title', action.y < title.y + title.height && action.x > title.x + title.width - 1, { action, title })
      }
      await helpers.clearRoutes()
    })
    await shot('long-title', { fullPage: false })

    // ---- 5,000 messages ----------------------------------------------------------------------------------------
    if (width === 1440) {
      await step('5,000-message chat: at= mid, windowed both ways', async () => {
        await routeLongChat(page)
        await helpers.goto(`/chats/${LONG_CHAT}?at=${7_000_001 + 2500}`, { waitFor: '[data-highlight-message]' })
        check('initial window ≤ 100 rows (+ pages loaded near the edges)', (await rowCount()) <= 300, { rows: await rowCount() })
        let maxRows = 0
        const t0 = Date.now()
        for (let i = 0; i < 80 && (await page.locator('[data-chat-end]').count()) === 0; i++) {
          await page.mouse.wheel(0, 4000)
          await page.waitForTimeout(60)
          maxRows = Math.max(maxRows, await rowCount())
        }
        const ms = Date.now() - t0
        check('reached message 5,000', (await page.locator('[data-chat-end]').count()) === 1 && (await page.locator(`[data-message-id="${7_000_001 + LONG_N - 1}"]`).count()) === 1)
        check('DOM never held more than 1,000 rows', maxRows <= 1000, { maxRows, ms })
        const longTasks = await page.evaluate(`(() => performance.getEntriesByType('longtask').length)()`)
        check('scrolled 2,500 messages', true, { ms, longTasks })
      })
      await shot('long-5000-end', { fullPage: false })
      await step('5,000-message chat: back up to the first message', async () => {
        let maxRows = 0
        for (let i = 0; i < 80 && (await page.locator(`[data-message-id="${7_000_001}"]`).count()) === 0; i++) {
          await page.mouse.wheel(0, -4000)
          await page.waitForTimeout(60)
          maxRows = Math.max(maxRows, await rowCount())
        }
        check('reached message 1 again', (await page.locator(`[data-message-id="${7_000_001}"]`).count()) === 1)
        check('DOM still windowed', maxRows <= 1000, { maxRows })
        await helpers.clearRoutes()
      })
      await shot('long-5000-start', { fullPage: false })
    }

    // ---- fixtures ----------------------------------------------------------------------------------------------
    await step('fixture page: every kind, unlinked sender, long message', async () => {
      await helpers.goto('/dev/chat/showcase', { waitFor: '#group [data-message-id]' })
      const g = page.locator('#group')
      for (const t of ['语音 14 秒', '转账', '红包', '视频通话', '动画表情', '链接', '位置', '小程序', '视频号', '名片', '聊天记录', '文件', '视频', '图片未导入']) {
        check(`chip/placeholder ${t}`, (await g.getByText(t, { exact: true }).count()) > 0)
      }
      check('unlinked sender shows the raw name without a link', (await g.locator('[data-sender-unlinked]').first().innerText()).includes('装修王师傅'))
      check('linked senders are links', (await g.locator('[data-sender-link]').count()) > 0)
      check('highlighted row', (await g.locator('[data-highlight-message]').count()) === 1)
      check('quoted line shows the person label for a linked name', (await g.innerText()).includes('我：我可以，三点以后'))
      const sys = g.locator('[data-message-id]', { hasText: '加入了群聊' })
      check('system line has no sender prefix', (await sys.count()) === 1 && (await sys.locator('[data-sender-unlinked], [data-sender-link]').count()) === 0)
      const align = await page.evaluate(`(() => {
        const out = []
        for (const ol of document.querySelectorAll('#group ol')) {
          const rows = [...ol.querySelectorAll('[data-message-id]')]
          if (rows.length < 2) continue
          const lefts = rows.map((r) => Math.round(r.lastElementChild.getBoundingClientRect().left))
          out.push({ lefts, sender: Math.round(rows[0].children[1].getBoundingClientRect().left) })
        }
        return out
      })()`) as { lefts: number[]; sender: number }[]
      check('continuation messages hang at the first message body edge', align.length >= 3 && align.every((a) => a.lefts.every((l) => Math.abs(l - a.lefts[0]) <= 1) && a.lefts[0] > a.sender), { align })
      const edges = await page.evaluate(`(() => [...new Set([...document.querySelectorAll('#group [data-message-id]')].filter((r) => r.children.length === 3).map((r) => Math.round(r.lastElementChild.getBoundingClientRect().left)))])()`) as number[]
      check('every run shares one body edge (no zig-zag between senders)', edges.length === 1, { edges })
      const long = await page.evaluate(`(() => {
        const row = [...document.querySelectorAll('#group [data-message-id]')].find((r) => r.textContent.includes('顺便说一下'))
        const body = row.lastElementChild
        const range = document.createRange(); range.selectNodeContents(body)
        const lefts = [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.left))
        return { body: Math.round(body.getBoundingClientRect().left), min: Math.min(...lefts), lines: lefts.length }
      })()`) as { body: number; min: number; lines: number }
      check('wrapped lines of a long message never start left of the body edge', long.min >= long.body - 1 && long.lines > 1, long)
    })
    await elementShot('fixtures-group', '#group')
    await step('fixture image enlarged', async () => {
      const thumb = await page.locator('#group [data-chat-image]').first().boundingBox()
      await page.locator('#group [data-chat-image]').first().click()
      await page.locator('[data-chat-image-viewer] img').waitFor()
      await checkEnlarged(thumb?.width ?? 0)
    })
    await shot('fixtures-image-enlarged', { fullPage: false })
    await step('close fixture viewer', async () => {
      await page.keyboard.press('Escape')
      await page.locator('[data-chat-image-viewer]').waitFor({ state: 'detached' })
    })
    await step('tap a continuation row reveals its time', async () => {
      const row = page.locator('#group [data-message-id]:not([data-run-start]):not([data-highlight-message])').first()
      const time = row.locator('time')
      check('continuation time hidden at rest', (await time.evaluate((t) => getComputedStyle(t).opacity)) === '0')
      if (width < 640) await row.tap({ position: { x: 200, y: 10 } })
      else await row.click({ position: { x: 300, y: 10 } })
      await page.waitForTimeout(350)
      check('continuation time visible after tap/click', (await time.evaluate((t) => getComputedStyle(t).opacity)) === '1')
    })
    await shot('fixtures-continuation-time', { fullPage: false })
    await step('sender name: one line at rest, full name on tap', async () => {
      const row = page.locator('#group [data-message-id]', { has: page.locator('[data-sender-unlinked]') }).first()
      const cell = row.locator('[data-sender-cell]')
      // count the name's own line boxes: the grid cell itself stretches to the row, whose body may wrap
      const measure = () =>
        cell.evaluate((c) => {
          const r = document.createRange()
          r.selectNodeContents(c)
          const lines = new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size
          return { lines, clipped: c.scrollWidth > c.clientWidth + 1, ws: getComputedStyle(c).whiteSpace }
        })
      const rest = await measure()
      check('unlinked name is one truncated line at rest', rest.lines === 1 && rest.clipped && rest.ws === 'nowrap', rest)
      check('full name is in the title', ((await row.locator('[data-sender-unlinked]').getAttribute('title')) ?? '').startsWith('装修王师傅（未关联）'))
      if (width < 640) await row.tap({ position: { x: 240, y: 10 } })
      else await row.click({ position: { x: 400, y: 10 } })
      await page.waitForTimeout(200)
      const open = await measure()
      check('tapping the row shows the whole name', open.ws !== 'nowrap' && !open.clipped, open)
      await row.scrollIntoViewIfNeeded()
    })
    await shot('fixtures-sender-revealed', { fullPage: false })
    await elementShot('fixtures-private-header', '#private')
    await elementShot('fixtures-loading', '#loading')
    await elementShot('fixtures-error', '#error')
  },
})
