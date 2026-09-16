import { defineScenario } from '@/verify/lib'

// 来往 (SPEC §9.5), twice over:
//  - on REAL seed rows (41 segments / 12 loops): the derivations that matter — a conversation that regroups across a
//    window boundary, the rhythm at and under MIN_RHYTHM_CONVERSATIONS, group-only contact, an expired and a closed
//    loop, a hidden segment, cross-account isolation, and the section as the person page actually renders it;
//  - on fixtures at /dev/interaction/showcase: the states seed cannot hold all at once — rhythm only, loops only,
//    the empty case (the whole section absent), a long timeline, loading and error, the infobox line, the 约定 row
//    and the import page's 这次聊了什么 — plus the SPEC §9.3 ban list (no counts, badges, red dots, nagging, 补充).

interface ApiRhythm {
  conversationCount: number
  conversationCountThisYear: number
  lastAt: string | null
  daysSinceLast: number | null
  medianGapDays: number | null
  initiatedByMe: number | null
  initiatedByThem: number | null
  privateOnly: boolean
}
interface ApiSegment { id: number; hidden: boolean; startSeq: number; firstMessageId: number | null; summary: string }
interface ApiConversation { chatId: number; chatKind: string; startedAt: string; messageCount: number; segments: ApiSegment[] }
interface ApiLoop { id: number; text: string; state: string; expired: boolean; status: string; kind: string; direction: string; openedAt: string }
interface ApiInteraction { rhythm: ApiRhythm; loops: ApiLoop[]; closed: ApiLoop[]; conversations: ApiConversation[]; hasMore: boolean }
interface ApiImportInteraction { conversations: ApiConversation[] }
interface ApiSearch { interaction: { kind: string; id: number; text: string; href: string; highlights: [number, number][] }[] }

/** Low-saturation guard: the Loam palette has no warning colour here (SPEC §9.5: 不加任何警示色). */
const SATURATION_PROBE = `(() => {
  const root = document.querySelector('#expired [data-block=interaction]')
  if (!root) return { worst: null }
  let worst = null
  for (const el of root.querySelectorAll('*')) {
    const s = getComputedStyle(el)
    for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderLeftColor']) {
      const v = s[prop]
      const m = /rgba?\\((\\d+), ?(\\d+), ?(\\d+)(?:, ?([\\d.]+))?\\)/.exec(v)
      if (!m) continue
      const a = m[4] === undefined ? 1 : Number(m[4])
      if (a < 0.05) continue
      const c = [Number(m[1]), Number(m[2]), Number(m[3])]
      const spread = Math.max(...c) - Math.min(...c)
      if (!worst || spread > worst.spread) worst = { spread, v, prop, tag: el.tagName, text: (el.textContent || '').slice(0, 20) }
    }
  }
  return { worst }
})()`

const COLOR_OF = (selector: string) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  return el ? getComputedStyle(el).color : null
})()`

function luminance(rgb: string | null): number | null {
  const m = rgb ? /rgba?\((\d+), ?(\d+), ?(\d+)/.exec(rgb) : null
  return m ? (Number(m[1]) * 299 + Number(m[2]) * 587 + Number(m[3]) * 114) / 1000 : null
}

export default defineScenario({
  id: 'interaction/showcase',
  description: '来往：三块齐全、只有节奏、只有未结事项、过期、未确认、整节不显示、很长的时间线、最后一次聊天、约定行、这次聊了什么、窄屏',
  account: 'seed',
  requiredTags: [
    'person:long-profile',
    'person:rhythm-small',
    'person:group-only',
    'person:private-alice',
    'import:private-long-2',
    'import:review-empty',
    'segment:hidden',
    'segment:split-a',
    'segment:split-b',
    'loop:expired',
    'loop:closed-done',
    'loop:proposed',
    'loop:question-mine-open',
    'loop:question-theirs-open',
  ],
  // two live steps ask for rows this account must not see, on purpose
  // one live step asks for a person that does not exist, on purpose (true two-account isolation is asserted in
  // server/interaction/__tests__/interaction.test.ts, which can hold two seeded accounts at once)
  expectedFailures: [{ urlPattern: '/api/people/99999999/interaction', status: 404, step: 'real rows: rhythm, loops and the timeline' }],
  async run({ page, step, shot, check, helpers, width, api, seed }) {
    const narrow = width < 1024
    const topbarStatic = () => page.addStyleTag({ content: 'header.sticky{position:static!important}' })
    const elementShot = async (name: string, selector: string, opts: { settleMs?: number } = {}) => {
      await page.locator(selector).first().scrollIntoViewIfNeeded()
      return shot(name, { selector, fullPage: false, ...opts })
    }

    // the only request this page can make is an evidence block; serve it so a mark can be opened for real
    await helpers.stubJson(/\/api\/evidence\/loop\/\d+/, {
      target: { type: 'loop', id: 701 },
      sourceKind: 'ai',
      manualAddedAt: null,
      items: [
        {
          messageId: 900001,
          chatId: 4101,
          chatTitle: '林知夏',
          messages: [
            { id: 900000, chatId: 4101, seq: 1024, sentAt: '2026-09-01 21:09', kind: 'text', body: '我简历改了三版了，还是不满意', meta: null, senderHandleId: null, senderName: '夏夏', senderPersonId: 8701, senderLabel: '林知夏', attachments: [], isEvidence: false },
            { id: 900001, chatId: 4101, seq: 2048, sentAt: '2026-09-01 21:10', kind: 'text', body: '发我吧，这两天我帮你看看', meta: null, senderHandleId: null, senderName: '我是小丽', senderPersonId: 8700, senderLabel: '我', attachments: [], isEvidence: true },
            { id: 900002, chatId: 4101, seq: 3072, sentAt: '2026-09-01 21:11', kind: 'text', body: '太好了，谢谢你', meta: null, senderHandleId: null, senderName: '夏夏', senderPersonId: 8701, senderLabel: '林知夏', attachments: [], isEvidence: false },
          ],
        },
      ],
    })

    // ── real seed rows ───────────────────────────────────────────────────────────────────────────────────────────
    const long = await seed.person('long-profile')

    await step('real rows: rhythm, loops and the timeline', async () => {
      const r = await api.get<ApiInteraction>(`/api/people/${long.id}/interaction?timeline=5`)
      check('GET /api/people/:id/interaction 200', r.status === 200, { status: r.status })
      const d = r.json!
      check('19 conversations, 14 of them this year', d.rhythm.conversationCount === 19 && d.rhythm.conversationCountThisYear === 14, d.rhythm)
      check('a median gap and both initiator counts are derived', d.rhythm.medianGapDays === 19 && d.rhythm.initiatedByMe === 6 && d.rhythm.initiatedByThem === 7, d.rhythm)
      check('timeline=5 returns 5 whole conversations and says there are more', d.conversations.length === 5 && d.hasMore === true, { n: d.conversations.length, hasMore: d.hasMore })
      check('newest first', d.conversations.every((c, i) => i === 0 || c.startedAt <= d.conversations[i - 1].startedAt), d.conversations.map((c) => c.startedAt))
      check('every rendered segment resolved its first message', d.conversations.every((c) => c.segments.every((s2) => s2.firstMessageId !== null)))
      check('5 open loops and 1 closed one', d.loops.length === 5 && d.closed.length === 1, { open: d.loops.map((l) => l.text), closed: d.closed.map((l) => l.text) })
      check('open means no close event', d.loops.every((l) => l.state === 'open') && d.closed.every((l) => l.state !== 'open'))
      check('loops are oldest first; an expired one keeps its place', d.loops.every((l, i) => i === 0 || l.openedAt >= d.loops[i - 1].openedAt), d.loops.map((l) => [l.openedAt, l.expired]))

      const expired = await seed.loop('expired')
      check('the expired loop is still open, just expired', d.loops.some((l) => l.id === expired.id && l.expired && l.state === 'open'), { expired: expired.id })
      const closedDone = await seed.loop('closed-done')
      check('a closed loop is in 历史, not in 未结事项', d.closed.some((l) => l.id === closedDone.id) && !d.loops.some((l) => l.id === closedDone.id))
      const proposed = await seed.loop('proposed')
      check('an unconfirmed loop still shows in 未结事项', d.loops.some((l) => l.id === proposed.id && l.status === 'proposed'))

      // SPEC §7: `direction` is whose move is next — a question she asked is `mine`, one the user asked is `theirs`
      const qMine = await seed.loop('question-mine-open')
      const qTheirs = await seed.loop('question-theirs-open')
      const qm = d.loops.find((l) => l.id === qMine.id)
      check('a question the user owes an answer to is direction=mine', qm?.kind === 'question' && qm?.direction === 'mine', qm)
      check('the question the user asked belongs to another person', !d.loops.some((l) => l.id === qTheirs.id))

      const all = await api.get<ApiInteraction>(`/api/people/${long.id}/interaction?timeline=all`)
      check('timeline=all stops asking for more', all.json?.hasMore === false)
      const hidden = await seed.segment('hidden')
      check('a hidden segment is left out of the person timeline', !all.json!.conversations.some((c) => c.segments.some((s2) => s2.id === hidden.id)), { hidden: hidden.id })
      // hiding a summary does not rewrite what happened: the conversation still counts in the rhythm, but a
      // conversation with nothing left to show is not listed (DECISIONS interaction X2)
      check('the timeline is every counted conversation minus the fully hidden one', all.json?.conversations.length === d.rhythm.conversationCount - 1, {
        listed: all.json?.conversations.length,
        counted: d.rhythm.conversationCount,
      })

      check('unknown person → 404', (await api.get(`/api/people/99999999/interaction`)).status === 404)
    })

    await step('real rows: the sample rule at, under and beside MIN_RHYTHM_CONVERSATIONS', async () => {
      const small = await seed.person('rhythm-small')
      const rs = (await api.get<ApiInteraction>(`/api/people/${small.id}/interaction`)).json!.rhythm
      check('3 conversations: no average gap is claimed', rs.conversationCount === 3 && rs.medianGapDays === null, rs)
      check('the last contact is still reported', rs.lastAt !== null && rs.daysSinceLast !== null, rs)

      const alice = await seed.person('private-alice')
      const ra = (await api.get<ApiInteraction>(`/api/people/${alice.id}/interaction`)).json!.rhythm
      check('exactly 5 conversations is enough for an average', ra.conversationCount === 5 && ra.medianGapDays !== null, ra)

      const grp = await seed.person('group-only')
      const rg = (await api.get<ApiInteraction>(`/api/people/${grp.id}/interaction`)).json!.rhythm
      check('group-only contact: who spoke first is not claimed', rg.conversationCount > 0 && rg.initiatedByMe === null && rg.initiatedByThem === null && rg.privateOnly === false, rg)
    })

    await step('real rows: a conversation regrouping across a window boundary', async () => {
      const imp = await seed.import('private-long-2')
      const r = await api.get<ApiImportInteraction>(`/api/imports/${imp.id}/interaction`)
      check('GET /api/imports/:id/interaction 200', r.status === 200, { status: r.status })
      const convs = r.json!.conversations
      const segs = convs.flatMap((c) => c.segments)
      check('7 conversations over 8 segments', convs.length === 7 && segs.length === 8, { convs: convs.length, segs: segs.length })
      const a = await seed.segment('split-a')
      const b = await seed.segment('split-b')
      const holder = convs.find((c) => c.segments.some((s2) => s2.id === a.id))
      check('the split pair is ONE conversation, not two', Boolean(holder && holder.segments.some((s2) => s2.id === b.id)), {
        a: a.id,
        b: b.id,
        holder: holder?.segments.map((s2) => s2.id),
      })
      check('its message count is the sum of both segments', (holder?.segments.length ?? 0) === 2 && (holder?.messageCount ?? 0) > 0, { messageCount: holder?.messageCount })
      check('conversations are newest first', convs.every((c, i) => i === 0 || c.startedAt <= convs[i - 1].startedAt))

      const empty = await seed.import('review-empty')
      const re = await api.get<ApiImportInteraction>(`/api/imports/${empty.id}/interaction`)
      check('an import that produced no summaries answers with none', re.status === 200 && re.json?.conversations.length === 0, { status: re.status, n: re.json?.conversations.length })
    })

    await step('real rows: the 来往 group of the search overlay', async () => {
      const r = await api.get<ApiSearch>('/api/search?q=简历&types=interaction')
      check('GET /api/search?types=interaction 200', r.status === 200, { status: r.status })
      const hits = r.json?.interaction ?? []
      check('the unfinished item is found by its text', hits.some((h) => h.kind === 'loop' && h.text.includes('简历')), hits.slice(0, 3))
      check('a loop hit links to the person page anchored on it', hits.filter((h) => h.kind === 'loop').every((h) => /^\/p\/\d+#loop-\d+$/.test(h.href)), hits.filter((h) => h.kind === 'loop').map((h) => h.href))
      // a segment can match on a topic word that is not in its summary, and then there is nothing to highlight
      check('a hit whose text contains the query is highlighted', hits.filter((h) => h.text.includes('简历')).every((h) => h.highlights.length > 0), hits.map((h) => [h.text.slice(0, 12), h.highlights.length]))
      check('highlight ranges stay inside the text', hits.every((h) => h.highlights.every(([a, b]) => a >= 0 && b <= h.text.length && a < b)))
      const seg = await api.get<ApiSearch>('/api/search?q=预算&types=interaction')
      const segHits = (seg.json?.interaction ?? []).filter((h) => h.kind === 'segment')
      check('a segment summary is found and links into the transcript', segHits.length > 0 && segHits.every((h) => /^\/chats\/\d+\?at=\d+$/.test(h.href)), segHits.slice(0, 3).map((h) => h.href))
    })

    await step('real rows: the section as the person page renders it', async () => {
      await helpers.goto(`/p/${long.id}`, { waitFor: '[data-block=interaction]' })
      await topbarStatic()
      const section = page.locator('[data-block=interaction]')
      check('来往 is on the page', (await section.locator('h2').innerText()).trim() === '来往')
      const rhythm = (await section.locator('[data-rhythm]').innerText()).trim()
      check('the rhythm is one sentence about this person', rhythm.endsWith('。') && /聊过 \d+ 次/.test(rhythm), { rhythm })
      const loops = await section.locator('[data-loops] li').allInnerTexts()
      check('5 unfinished items', loops.length === 5, { loops })
      // loops.text is a bare fragment; the row must read as a sentence with a subject (核心 request import-result#4)
      check('every item reads as a sentence, not a bare fragment', loops.every((t) => /^(你|我|约好|Nora|[\u4e00-\u9fa5]{2,12}(答应|问))/.test(t.trim())), { loops })
      check('no raw enum leaks into the copy', !loops.some((t) => /mine|theirs|mutual|promise|question|plan/.test(t)), { loops })
      check('the timeline shows five conversations', (await section.locator('[data-timeline] li').count()) === 5)
      const infobox = page.locator('[data-last-contact]')
      check('the infobox line is the day, the distance and a summary', (await infobox.count()) === 1 && /(今天|昨天|\d+ 天前)/.test(await infobox.innerText()))
    })
    await elementShot('live-person-section', '[data-block=interaction]')
    await step('real rows: 更早 on the real page', async () => {
      const section = page.locator('[data-block=interaction]')
      await section.getByRole('button', { name: '更早' }).click()
      await page.waitForFunction(`document.querySelectorAll('[data-block=interaction] [data-timeline] li').length > 5`, undefined, { timeout: 15_000 })
      check('更早 loads the rest in place', (await section.locator('[data-timeline] li').count()) === 18, { n: await section.locator('[data-timeline] li').count() })
      check('更早 is gone at the end', (await section.getByRole('button', { name: '更早' }).count()) === 0)
    })
    await elementShot('live-person-timeline', '[data-block=interaction]')

    // ── fixture states ───────────────────────────────────────────────────────────────────────────────────────────
    await step('open the showcase', async () => {
      await helpers.goto('/dev/interaction/showcase', { waitFor: '#full [data-block=interaction]' })
      await topbarStatic()
      check('every frame rendered', (await page.locator('[data-frame]').count()) === 12, { frames: await page.locator('[data-frame]').count() })
    })
    await shot('overview')

    await step('三块齐全: rhythm sentence, unfinished items, timeline', async () => {
      const section = page.locator('#full [data-block=interaction]')
      check('section title is 来往', (await section.locator('h2').innerText()).trim() === '来往')
      const rhythm = section.locator('[data-rhythm]')
      check('节奏 is one prose sentence', await rhythm.isVisible())
      const text = (await rhythm.innerText()).trim()
      check('one sentence ending in 。', text.endsWith('。') && text.split('。').filter(Boolean).length === 1, { text })
      check('节奏 is a paragraph, not a chart or a stat card', (await rhythm.evaluate((el) => el.tagName)) === 'P')
      check('no canvas / svg chart anywhere in the section', (await section.locator('canvas, svg').count()) === 0)
      check('未结事项 heading is exactly that', (await section.locator('[data-loops] h3').innerText()).trim() === '未结事项')
      check('来往时间线 heading is exactly that', (await section.locator('[data-conversations] h3').innerText()).trim() === '来往时间线')
      check('five conversations by default', (await section.locator('[data-timeline] li').count()) === 5)
      check('每条未结事项带证据标记', (await section.locator('[data-loops] [data-evidence-mark]').count()) === 7)
      check('已完成 / 不用管 on confirmed rows', (await section.getByRole('button', { name: '已完成' }).count()) === 6)
    })
    await elementShot('full-section', '#full')

    await step('SPEC §9.3 ban list', async () => {
      const section = page.locator('#full [data-block=interaction]')
      const text = await section.innerText()
      for (const banned of ['好久没联系', '待确认', '待办', '连续', '未读']) {
        check(`no “${banned}”`, !text.includes(banned), { text: text.slice(0, 200) })
      }
      check('no 补充 affordance in 来往', (await section.getByRole('button', { name: /补充/ }).count()) === 0)
      check('no badge/pill element', (await section.locator('[class*=badge], [class*=Badge], [class*=rounded-full]').count()) === 0)
      // a count next to a heading is the shape SPEC bans; the headings carry no digits
      const headings = await section.locator('h2, h3').allInnerTexts()
      check('no digits in any heading', headings.every((h) => !/\d/.test(h)), { headings })
    })

    await step('只有节奏 / 只有未结事项: a block with nothing in it does not show', async () => {
      const rhythmOnly = page.locator('#rhythm-only [data-block=interaction]')
      check('rhythm-only has the sentence', await rhythmOnly.locator('[data-rhythm]').isVisible())
      check('rhythm-only has no 未结事项 block', (await rhythmOnly.locator('[data-loops]').count()) === 0)
      check('rhythm-only has no timeline', (await rhythmOnly.locator('[data-conversations]').count()) === 0)
      const loopsOnly = page.locator('#loops-only [data-block=interaction]')
      check('loops-only has no rhythm sentence', (await loopsOnly.locator('[data-rhythm]').count()) === 0)
      check('loops-only has its items', (await loopsOnly.locator('[data-loops] li').count()) === 4)
    })
    await elementShot('rhythm-only', '#rhythm-only')
    await elementShot('loops-only', '#loops-only')

    await step('过期: dimmer, says how long, not moved, no warning colour', async () => {
      const section = page.locator('#expired [data-block=interaction]')
      const rows = section.locator('[data-loops] li')
      check('expired row keeps its place (oldest first)', (await rows.first().locator('[data-loop-expired]').count()) === 1)
      check('已过去 N 天 shown', /已过去 \d+ 天/.test(await rows.first().innerText()))
      const expiredColor = luminance(await page.evaluate(COLOR_OF('#expired [data-loops] [data-loop-expired]')))
      const normalColor = luminance(await page.evaluate(COLOR_OF('#expired [data-loops] [data-loop-status]:not([data-loop-expired])')))
      check('expired text is one shade lighter than a normal row', expiredColor !== null && normalColor !== null && expiredColor > normalColor, { expiredColor, normalColor })
      const probe = (await page.evaluate(SATURATION_PROBE)) as { worst: { spread: number; v: string; text: string } | null }
      check('no saturated (warning) colour in the block', (probe.worst?.spread ?? 0) < 40, probe.worst)
    })
    await elementShot('expired', '#expired')

    await step('未确认: dimmer, a thin left rule, 确认 / 不对', async () => {
      const section = page.locator('#unconfirmed [data-block=interaction]')
      const proposed = section.locator('li:has([data-loop-status=proposed])').first()
      check('unconfirmed rows carry 确认 / 不对', (await proposed.getByRole('button', { name: '确认' }).count()) === 1 && (await proposed.getByRole('button', { name: '不对' }).count()) === 1)
      check('unconfirmed rows do not offer 已完成', (await proposed.getByRole('button', { name: '已完成' }).count()) === 0)
      const rule = await proposed.evaluate((el) => {
        const s = getComputedStyle(el)
        return { w: s.borderLeftWidth, c: s.borderLeftColor }
      })
      check('thin left rule', parseFloat(rule.w) > 0 && parseFloat(rule.w) <= 2, rule)
      const proposedColor = luminance(await page.evaluate(COLOR_OF('#unconfirmed [data-loop-status=proposed]')))
      const confirmedColor = luminance(await page.evaluate(COLOR_OF('#unconfirmed [data-loop-status=confirmed]')))
      check('unconfirmed text is lighter than a confirmed one', proposedColor !== null && confirmedColor !== null && proposedColor > confirmedColor, { proposedColor, confirmedColor })
    })
    await elementShot('unconfirmed', '#unconfirmed')

    await step('三块都空: the section is absent entirely', async () => {
      check('no 来往 section rendered', (await page.locator('#empty [data-block=interaction]').count()) === 0)
      check('nothing but the note in that frame', (await page.locator('#empty [data-empty-probe]').innerText()).trim() === '这一格里没有「来往」这一节。')
    })

    await step('展开一次会话: segment summaries with 在聊天中查看', async () => {
      const row = page.locator('#full [data-timeline] li').first()
      await row.locator('button[aria-expanded]').click()
      await row.locator('a', { hasText: '在聊天中查看' }).first().waitFor()
      check('expanded row shows every segment summary', (await row.locator('a', { hasText: '在聊天中查看' }).count()) === 2)
      const href = await row.locator('a', { hasText: '在聊天中查看' }).first().getAttribute('href')
      check('link goes to the chat page at that message', /^\/chats\/\d+\?at=\d+$/.test(href ?? ''), { href })
    })
    await elementShot('conversation-expanded', '#full')

    await step('证据标记 opens its block in place', async () => {
      const mark = page.locator('#full [data-loops] [data-evidence-mark]').first()
      await mark.click()
      await page.locator('#full [data-loops] [role=region] [data-evidence-message]').first().waitFor({ timeout: 10_000 })
      const shown = await page.locator('#full [data-loops] [data-evidence-message]').count()
      const around = await page.locator('#full [data-loops] [role=region] ol li').count()
      check('evidence block opened under the row: the message plus its context', shown === 1 && around === 3, { shown, around })
      check('no page navigation', new URL(page.url()).pathname === '/dev/interaction/showcase')
    })
    await elementShot('evidence-open', '#full')
    await step('close the evidence block', async () => {
      await page.locator('#full [data-loops] [data-evidence-mark]').first().click()
      check('closed', (await page.locator('#full [data-loops] [data-evidence-message]').count()) === 0)
      await page.locator('#full [data-timeline] li').first().locator('button[aria-expanded]').click()
    })

    await step('很长的时间线: 更早 expands in place', async () => {
      const section = page.locator('#long [data-block=interaction]')
      check('starts at five', (await section.locator('[data-timeline] li').count()) === 5)
      await section.getByRole('button', { name: '更早' }).click()
      await page.waitForFunction(`document.querySelectorAll('#long [data-timeline] li').length === 15`, undefined, { timeout: 5000 })
      check('更早 shows more without leaving the page', (await section.locator('[data-timeline] li').count()) === 15)
      await section.getByRole('button', { name: '更早' }).click()
      await page.waitForFunction(`document.querySelectorAll('#long [data-timeline] li').length === 24`, undefined, { timeout: 5000 })
      check('更早 disappears at the end', (await section.getByRole('button', { name: '更早' }).count()) === 0)
    })
    await elementShot('long-timeline', '#long')

    await step('最后一次聊天: the day, how long ago, and what it was about', async () => {
      const line = page.locator('#last-contact [data-last-contact]').first()
      const text = (await line.innerText()).replace(/\s+/g, ' ')
      check('day and distance', /月\d+日/.test(text) && /(今天|昨天|\d+ 天前)/.test(text), { text })
      check('summary underneath', text.includes('交钥匙'), { text })
      const bare = page.locator('#last-contact [data-last-contact]').nth(1)
      check('with no summary only the time is shown', (await bare.locator('button').count()) === 0)
      const h = await line.locator('button').evaluate((el) => el.getBoundingClientRect().height)
      check('the summary is one line', h <= 26, { h })
      await elementShot('last-contact-collapsed', '#last-contact')
      await line.locator('button').click()
      await line.locator('a', { hasText: '在聊天中查看' }).first().waitFor()
      check('clicking the summary expands the whole conversation', (await line.locator('a', { hasText: '在聊天中查看' }).count()) === 2)
    })
    await elementShot('last-contact', '#last-contact')

    await step('首页的约定行', async () => {
      const rows = page.locator('#plans [data-plan-row]')
      check('two plan rows', (await rows.count()) === 2)
      const text = (await rows.first().innerText()).replace(/\s+/g, ' ')
      check('人名 · 事项 · 日期 · 还有几天 · 约定', /林知夏/.test(text) && /陶瓷展/.test(text) && /月\d+日/.test(text) && /(今天|明天|后天|还有 \d+ 天)/.test(text) && /约定/.test(text), { text })
      const href = await rows.first().getByRole('link', { name: '约定' }).getAttribute('href')
      check('约定 links to the person page anchored on the item', /^\/p\/\d+#loop-\d+$/.test(href ?? ''), { href })
    })
    await elementShot('plan-rows', '#plans')

    await step('这次聊了什么: no confirm buttons, only 改写 and 隐藏', async () => {
      const block = page.locator('#import-conversations [data-block=import-conversations]')
      check('title', (await block.locator('h2').innerText()).trim() === '这次聊了什么')
      check('no 确认 button', (await block.getByRole('button', { name: '确认' }).count()) === 0)
      check('no 不对 button', (await block.getByRole('button', { name: '不对' }).count()) === 0)
      check('改写 / 隐藏 present', (await block.getByRole('button', { name: '改写' }).count()) >= 1 && (await block.getByRole('button', { name: '隐藏' }).count()) >= 1)
      check('a hidden segment can be un-hidden', (await block.getByRole('button', { name: '取消隐藏' }).count()) === 1)
    })
    await elementShot('import-conversations', '#import-conversations')

    await step('改写 opens an input in place (cancelled)', async () => {
      const block = page.locator('#import-conversations [data-block=import-conversations]')
      await block.getByRole('button', { name: '改写' }).first().click()
      await block.getByRole('textbox', { name: '改写这段摘要' }).waitFor()
      await elementShot('import-editing', '#import-conversations')
      await block.getByRole('textbox', { name: '改写这段摘要' }).press('Escape')
      check('cancelled', (await block.getByRole('textbox', { name: '改写这段摘要' }).count()) === 0)
    })

    await step('loading and error states', async () => {
      check('skeleton is in the block shape', (await page.locator('#loading [data-interaction-skeleton] [aria-hidden]').count()) >= 3)
      check('error offers 重试', (await page.locator('#error [role=alert]').getByRole('button', { name: '重试' }).count()) === 1)
    })
    await elementShot('loading-and-error', '#loading')

    if (narrow) {
      await step('390: nothing overflows', async () => {
        const sw = Number(await page.evaluate('document.documentElement.scrollWidth'))
        check('no horizontal scroll at 390', sw <= width, { sw })
        const wide = await page.evaluate(`[...document.querySelectorAll('[data-block=interaction] *, [data-block=import-conversations] *')].filter((e) => e.getBoundingClientRect().right > ${width} + 1).length`)
        check('no element sticks out to the right', wide === 0, { wide })
      })
      await elementShot('narrow-full', '#full')
      await elementShot('narrow-expired', '#expired')
      await elementShot('narrow-import', '#import-conversations')
    }
  },
})
