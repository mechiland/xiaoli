import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertJsonRequest } from '@/server/llm'
import { getPrompt, renderDedupPrompt, renderExtractPrompt } from './prompt'
import { fillTemplate, parsePromptFile } from './prompt-file'
import { DEDUP_PROMPT_VERSION, PROMPT_VERSION, promptFeatures } from './prompt-version'
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
    expect(() => getPrompt('extract.v999')).toThrow()
  })

  it('extract prompt covers every SPEC §8.7 point and the relation reading', () => {
    const md = readFileSync(path.join(__dirname, '../../prompts', `${PROMPT_VERSION}.md`), 'utf8')
    for (const needle of ['一个月后仍然有用', '即时协调', '事务只保留在人身上的投影', '不推断原文没有说的东西', '称呼语是关系的直接证据', '`@显示名 称呼` 是别名的强证据', 'supersedesClaimId', '提供过收货地址', 'sensitive: true', '语音只有时长、转账和红包没有金额', '每条输出都必须有 evidence', 'from 是 to 的 type']) {
      expect(md).toContain(needle)
    }
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
    expect(promptFeatures('extract.v3')).toEqual({ packMaxMessages: null, gapMarkers: false })
    expect(promptFeatures('extract.v4')).toEqual({ packMaxMessages: 40, gapMarkers: true })
    const gapped: WindowInput = { ...input, messages: [...input.messages, { localSeq: 4, sentAt: '2026-05-03 09:00', senderName: '阿明', senderPersonId: 2, kind: 'text', body: '到家了' }] }
    const v4 = renderExtractPrompt(gapped, 'extract.v4')[1].content
    expect(v4).toContain('#3 [2026-05-01 10:02] 山野(1): [语音] 14"\n—— 间隔约47小时，以下是新的一段对话 ——\n#4 [2026-05-03 09:00] 阿明(2): 到家了')
    expect(renderExtractPrompt(gapped, 'extract.v3')[1].content).not.toContain('—— 间隔')
    // within 3 hours: no separator
    expect(v4.match(/—— 间隔/g)).toHaveLength(1)
  })

  it('dedup prompt embeds the candidate groups as JSON', () => {
    const [s, u] = renderDedupPrompt([{ personId: 2, label: '周明', candidates: [{ id: 50, statement: '住在成都' }], new: [{ index: 0, statement: '在成都住' }] }])
    expect(s.content).toContain('json')
    expect(JSON.parse(u.content.split('\n')[0])).toEqual({ persons: [{ personId: 2, label: '周明', candidates: [{ id: 50, statement: '住在成都' }], new: [{ index: 0, statement: '在成都住' }] }] })
  })
})
