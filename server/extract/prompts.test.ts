import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertJsonRequest } from '@/server/llm'
import { getPrompt, listPromptVersions, renderDedupPrompt, renderExtractPrompt, renderInteractionPrompt } from './prompt'
import { fillTemplate, parsePromptFile } from './prompt-file'
import { DEDUP_PROMPT_VERSION, INTERACTION_PROMPT_VERSION, PROMPT_VERSION, promptFeatures } from './prompt-version'
import { GENERATED_PATH, loadPromptFiles, renderGenerated } from './scripts/gen-prompts'
import type { WindowInput } from './types'

const input: WindowInput = {
  chat: { title: '周末徒步', kind: 'group' },
  selfPersonId: 1,
  known: [
    { personId: 1, label: '我', handles: [{ kind: 'display_group', value: '山野' }], claims: [] },
    { personId: 2, label: '周明', handles: [{ kind: 'display_group', value: '阿明' }], claims: [{ id: 50, statement: '住在成都', category: 'location' }] },
  ],
  messages: [
    { localSeq: 1, sentAt: '2026-05-01 10:00', senderName: '阿明', senderPersonId: 2, kind: 'text', body: '第一行\n第二行', context: true },
    { localSeq: 2, sentAt: '2026-05-01 10:01', senderName: '路人', senderPersonId: null, kind: 'image', body: '[图片] 微信图片_202605011001_1.jpg' },
    { localSeq: 3, sentAt: '2026-05-01 10:02', senderName: '山野', senderPersonId: 1, kind: 'voice', body: '[语音] 14"' },
  ],
}

describe('prompt files', () => {
  it('generated module is in sync with prompts/*.md (run server/extract/scripts/gen-prompts.ts)', () => {
    expect(readFileSync(GENERATED_PATH, 'utf8')).toBe(renderGenerated(loadPromptFiles()))
  })

  it('current versions exist and file names match front-matter', () => {
    expect(getPrompt(PROMPT_VERSION).version).toBe(PROMPT_VERSION)
    expect(getPrompt(DEDUP_PROMPT_VERSION).version).toBe(DEDUP_PROMPT_VERSION)
    expect(getPrompt(INTERACTION_PROMPT_VERSION).version).toBe(INTERACTION_PROMPT_VERSION)
    expect(() => getPrompt('extract.v999')).toThrow()
  })

  it('PROMPT_VERSION is extract.v8 and extract.v9 is retired but still registered (DECISIONS I15/I17, X40)', () => {
    // extract.v8 is the version that was recorded live on 2026-09-16 and passed every synthetic gate; extract.v9 is
    // the one that cost the extraction 0.90 → 0.76 claims precision. Keep the file so `--prompt extract.v9` still
    // renders for comparison, but never make it the production prompt again without new numbers.
    expect(PROMPT_VERSION).toBe('extract.v8')
    expect(INTERACTION_PROMPT_VERSION).toBe('interaction.v2')
    expect(getPrompt('extract.v9').version).toBe('extract.v9')
    expect(listPromptVersions('extract.')).toContain('extract.v9')
    // interaction.v1 stays registered so `--prompt interaction.v1` still renders for comparison (X41)
    expect(listPromptVersions('interaction.')).toEqual(['interaction.v1', 'interaction.v2'])
  })

  it('extract prompt covers every SPEC §8.7 point and the relation reading', () => {
    const md = readFileSync(path.join(__dirname, '../../prompts', `${PROMPT_VERSION}.md`), 'utf8')
    for (const needle of ['一个月后仍然有用', '即时协调', '事务只保留在人身上的投影', '不推断原文没有说的东西', '称呼语是关系的直接证据', '`@显示名 称呼` 是别名的强证据', 'supersedesClaimId', '提供过收货地址', 'sensitive: true', '语音只有时长、转账和红包没有金额', '每条输出都必须有 evidence', 'from 是 to 的 type']) {
      expect(md).toContain(needle)
    }
  })

  it('extract.v7 asks for completed milestones as events next to the lasting claim, and keeps plans out (X30)', () => {
    const md = readFileSync(path.join(__dirname, '../../prompts', 'extract.v7.md'), 'utf8')
    for (const needle of ['**已经发生的**', 'event 和 claim 各记各的', '还没发生的安排、计划和一时的状态不记', '已经离职这件事记成 event']) expect(md).toContain(needle)
    expect(md).not.toContain('开店、搬家记成 claim，不记 event')
    const example = JSON.parse(getPrompt('extract.v7').exampleJson) as { events: unknown[] }
    expect(example.events.length).toBeGreaterThanOrEqual(3)
  })

  it('extract.v8 = extract.v7 + the known-sender rule and partner words as spouse (overall critic r3 #2, X31)', () => {
    const v7 = readFileSync(path.join(__dirname, '../../prompts', 'extract.v7.md'), 'utf8')
    const md = readFileSync(path.join(__dirname, '../../prompts', 'extract.v8.md'), 'utf8')
    for (const needle of ['event 和 claim 各记各的', '已经离职这件事记成 event', '被叫到的发送者就是这个发送者', '不要为这个称呼新建人物', '这些关系一律用 spouse，不用 other']) expect(md).toContain(needle)
    expect(getPrompt('extract.v8').exampleJson).toBe(getPrompt('extract.v7').exampleJson)
    expect(getPrompt('extract.v8').userTemplate).toBe(getPrompt('extract.v7').userTemplate)
    // only additions to v7's system text: every v7 line except the four edited ones is still there
    const v8Lines = new Set(md.split('\n'))
    expect(v7.split('\n').filter((l) => !v8Lines.has(l))).toHaveLength(3)
    expect(promptFeatures('extract.v8')).toEqual({ packMaxMessages: 40, gapMarkers: true, milestoneRules: true })
  })

  it('extract.v9 = extract.v8 + the interaction layer (SPEC §8.8): routing rule, three output sections, nine keys', () => {
    const v8 = readFileSync(path.join(__dirname, '../../prompts', 'extract.v8.md'), 'utf8')
    const md = readFileSync(path.join(__dirname, '../../prompts', 'extract.v9.md'), 'utf8')
    for (const needle of [
      '被叫到的发送者就是这个发送者', // v8's rules are all still there
      '**分流：每句话先想它属于哪一层。**',
      '说出口了、还悬着的事 → `loop`',
      '未结事项',
      '上次来往',
      '不是对某个人的断言',
      '整段只有寒暄',
      '`plan` 一般是 `mutual`',
      '只能用输入里出现过的 loop id',
      '这些消息必须在这条事项开启之后',
      '九个键都要出现',
    ]) {
      expect(md).toContain(needle)
    }
    // the delete rule became a routing rule
    expect(v8).toContain('即时协调（"我到门口了""你们先吃""几点出发""收到"）不记。')
    expect(md).not.toContain('即时协调（"我到门口了""你们先吃""几点出发""收到"）不记。')
    expect(md).toContain('即时协调不进 claim，但它可能是 loop')
    const example = JSON.parse(getPrompt('extract.v9').exampleJson) as { segment: { topics: string[] } | null; loops: unknown[]; closes: unknown[] }
    expect(example.segment?.topics.length).toBeGreaterThan(0)
    expect(example.loops).toHaveLength(3)
    expect(example.closes).toHaveLength(1)
    expect(getPrompt('extract.v9').userTemplate).toBe(getPrompt('extract.v8').userTemplate)
  })

  it('interaction.v1 is the three §8.8 sections as a prompt of their own, with no archive job in it (X40)', () => {
    const md = readFileSync(path.join(__dirname, '../../prompts', 'interaction.v1.md'), 'utf8')
    for (const needle of [
      '你不记录关于某个人的长期事实',
      '不是对某个人的断言',
      '整段只有寒暄',
      '`plan` 一般是 `mutual`',
      '只能用输入里出现过的 loop id',
      '这些消息必须在这条事项开启之后',
      '三个键都要出现',
      '未结事项',
      '上次来往',
    ]) {
      expect(md).toContain(needle)
    }
    // none of the extraction call's job leaks in: no claim/relation/date/event sections, no new-person rules
    for (const absent of ['newPersons', 'supersedesClaimId', 'category', 'real_name', 'service_provider']) expect(md).not.toContain(absent)
    const example = JSON.parse(getPrompt('interaction.v1').exampleJson) as { segment: { topics: string[] } | null; loops: unknown[]; closes: unknown[] }
    expect(Object.keys(example).sort()).toEqual(['closes', 'loops', 'segment'])
    expect(example.segment?.topics.length).toBeGreaterThan(0)
    expect(example.loops).toHaveLength(3)
    expect(example.closes).toHaveLength(1)
  })

  it('interaction.v2 = v1 + the third threshold, the record/do-not-record contrast and the calendar bound on plan (X41)', () => {
    const v1 = readFileSync(path.join(__dirname, '../../prompts', 'interaction.v1.md'), 'utf8')
    const md = readFileSync(path.join(__dirname, '../../prompts', 'interaction.v2.md'), 'utf8')
    // v1's job is untouched: the three sections, the archive boundary, the close rules
    for (const needle of ['你不记录关于某个人的长期事实', '不是对某个人的断言', '整段只有寒暄', '`plan` 一般是 `mutual`', '只能用输入里出现过的 loop id', '这些消息必须在这条事项开启之后', '三个键都要出现', '未结事项', '上次来往']) {
      expect(md).toContain(needle)
    }
    for (const absent of ['newPersons', 'supersedesClaimId', 'category', 'real_name', 'service_provider']) expect(md).not.toContain(absent)

    // the third threshold, stated as weight-a-month-later and explicitly not as tense (SPEC §8.8)
    expect(md).toContain('**要过三道门槛，三条都过才记**')
    expect(md).toContain('下次见到这个人时，还值得你想起来欠着这件事')
    expect(md).toContain('判据**不是时态**，也**不是确定性**')
    expect(md).toContain('没做到会不会真的影响这段关系')
    expect(v1).not.toContain('三道门槛')

    // the contrast list, drawn verbatim from the measured false positives, and the calendar bound on `plan`
    for (const keep of ['帮表妹看简历', '下个月一起去看动画展', '帮忙打听杭州的幼儿园', '把那本书寄给她']) expect(md).toContain(keep)
    for (const drop of ['给留半个西瓜', '晚上过去拿水果', '发个表情包', '找本子', '顺路接孩子', '回头细说']) expect(md).toContain(drop)
    expect(md).toContain('**`plan` 指会写进日历的场合**')
    expect(md).toContain('当天之内的家务安排')

    // the example must not itself license a coordination loop: v1's "问了周六几点出发还没回" is exactly 即时协调
    const example = JSON.parse(getPrompt('interaction.v2').exampleJson) as { segment: { topics: string[] } | null; loops: { text: string }[]; closes: unknown[] }
    expect(Object.keys(example).sort()).toEqual(['closes', 'loops', 'segment'])
    expect(example.segment?.topics.length).toBeGreaterThan(0)
    expect(example.loops).toHaveLength(3)
    expect(example.closes).toHaveLength(1)
    expect(example.loops.some((l) => l.text.includes('几点出发'))).toBe(false)
    expect(getPrompt('interaction.v2').userTemplate).toBe(getPrompt('interaction.v1').userTemplate)
  })

  it('parser rejects files without sections or with bad example JSON; templates reject unknown placeholders', () => {
    expect(() => parsePromptFile('no front matter')).toThrow()
    expect(() => parsePromptFile('---\nversion: x\n---\n## system\na\n## user_template\nb\n## example_json\n{bad')).toThrow()
    expect(() => fillTemplate('{{nope}}', {})).toThrow()
  })
})

describe('renderExtractPrompt', () => {
  const [system, user] = renderExtractPrompt(input)

  it('passes the llm JSON-mode request assertion', () => {
    expect(() => assertJsonRequest({ purpose: 'extract', promptVersion: PROMPT_VERSION, model: 'deepseek-flash', messages: [system, user], maxTokens: 8192 }, { NEXTJS_ENV: 'test' })).not.toThrow()
    expect(system.content).not.toContain('{{')
    expect(user.content).not.toContain('{{')
  })

  it('renders messages as `#seq [time] sender(person_id): body`, marks context, hides image file names', () => {
    expect(user.content).toContain('【上下文】#1 [2026-05-01 10:00] 阿明(2): 第一行\n  第二行')
    expect(user.content).toContain('#2 [2026-05-01 10:01] 路人(?): [图片]')
    expect(user.content).not.toContain('微信图片_')
    expect(user.content).toContain('#3 [2026-05-01 10:02] 山野(1): [语音] 14"')
  })

  it('renders chat, self id and known persons with handles and confirmed claim ids', () => {
    expect(user.content).toContain('聊天：周末徒步（群聊）')
    expect(user.content).toContain('我（用户本人）的 person_id：1')
    expect(user.content).toContain('- person_id 1：我（用户本人）')
    expect(user.content).toContain('- person_id 2：周明')
    expect(user.content).toContain('群内显示名「阿明」')
    expect(user.content).toContain('[claim 50] 住在成都（所在地）')
  })

  it('packs windows and marks session gaps only from extract.v4, so older versions render byte-identically', () => {
    expect(promptFeatures('extract.v3')).toEqual({ packMaxMessages: null, gapMarkers: false, milestoneRules: false })
    expect(promptFeatures('extract.v4')).toEqual({ packMaxMessages: 40, gapMarkers: true, milestoneRules: false })
    expect(promptFeatures('extract.v7')).toEqual({ packMaxMessages: 40, gapMarkers: true, milestoneRules: true })
    // extract.v9 is retired but still registered (`--prompt extract.v9`); it keeps v7/v8's features and there is no
    // interaction flag any more — the interaction layer is its own prompt and its own call (X40).
    expect(promptFeatures('extract.v9')).toEqual({ packMaxMessages: 40, gapMarkers: true, milestoneRules: true })
    const gapped: WindowInput = { ...input, messages: [...input.messages, { localSeq: 4, sentAt: '2026-05-03 09:00', senderName: '阿明', senderPersonId: 2, kind: 'text', body: '到家了' }] }
    const v4 = renderExtractPrompt(gapped, 'extract.v4')[1].content
    expect(v4).toContain('#3 [2026-05-01 10:02] 山野(1): [语音] 14"\n—— 间隔约47小时，以下是新的一段对话 ——\n#4 [2026-05-03 09:00] 阿明(2): 到家了')
    expect(renderExtractPrompt(gapped, 'extract.v3')[1].content).not.toContain('—— 间隔')
    // within 3 hours: no separator
    expect(v4.match(/—— 间隔/g)).toHaveLength(1)
  })

  it('the extraction prompt never renders 上次来往 / 未结事项, at any version (X40)', () => {
    const withInteraction: WindowInput = {
      ...input,
      known: input.known.map((p) =>
        p.personId === 2
          ? {
              ...p,
              lastContact: { at: '2026-04-20 21:30', summary: '聊了搬家的进度' },
              openLoops: [{ id: 77, kind: 'plan' as const, direction: 'mutual' as const, text: '约了周六中午一起吃饭', openedAt: '2026-04-20 21:35' }],
            }
          : p,
      ),
    }
    // every extraction version renders exactly what it rendered without the two interaction fields, so every recorded
    // extract cassette replays byte-identically whatever the store fills in
    for (const v of ['extract.v1', 'extract.v5', 'extract.v8', 'extract.v9']) {
      expect(renderExtractPrompt(withInteraction, v)[1].content, v).toBe(renderExtractPrompt(input, v)[1].content)
      expect(renderExtractPrompt(withInteraction, v)[1].content, v).not.toContain('未结事项')
    }
  })

  it('renderInteractionPrompt: person labels, 上次来往 and 未结事项 — and no confirmed claims (SPEC §8.8 input side)', () => {
    const withInteraction: WindowInput = {
      ...input,
      known: input.known.map((p) =>
        p.personId === 2
          ? {
              ...p,
              lastContact: { at: '2026-04-20 21:30', summary: '聊了搬家的进度' },
              openLoops: [{ id: 77, kind: 'plan' as const, direction: 'mutual' as const, text: '约了周六中午一起吃饭', openedAt: '2026-04-20 21:35' }],
            }
          : p,
      ),
    }
    const [sys, usr] = renderInteractionPrompt(withInteraction)
    expect(sys.content).toContain('你不记录关于某个人的长期事实')
    expect(usr.content).toContain('- person_id 2：周明')
    expect(usr.content).toContain('  上次来往：2026-04-20 聊了搬家的进度')
    expect(usr.content).toContain('  未结事项：\n  - [loop 77] 约定·双方：约了周六中午一起吃饭（2026-04-20 起）')
    // the archive is deliberately absent: it is the bulk of the extraction prompt's tokens and this call cannot use it
    expect(usr.content).not.toContain('[claim 50]')
    expect(usr.content).not.toContain('已确认信息')
    expect(usr.content).not.toContain('别名：')
    // the messages themselves are rendered exactly as the extraction prompt renders them
    expect(usr.content).toContain('【上下文】#1 [2026-05-01 10:00] 阿明(2): 第一行')
    // a window with no history renders neither line
    expect(renderInteractionPrompt(input)[1].content).not.toContain('未结事项')
    expect(renderInteractionPrompt(input)[1].content).not.toContain('上次来往')
  })

  it('dedup prompt embeds the candidate groups as JSON', () => {
    const [s, u] = renderDedupPrompt([{ personId: 2, label: '周明', candidates: [{ id: 50, statement: '住在成都' }], new: [{ index: 0, statement: '在成都住' }] }])
    expect(s.content).toContain('json')
    expect(JSON.parse(u.content.split('\n')[0])).toEqual({ persons: [{ personId: 2, label: '周明', candidates: [{ id: 50, statement: '住在成都' }], new: [{ index: 0, statement: '在成都住' }] }] })
  })
})
