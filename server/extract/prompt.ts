// Prompt rendering (SPEC §8.6 input format; ARCHITECTURE §6). Pure.
import type { Category, HandleKind } from '@/contracts'
import { minutesBetween } from '@/lib/time'
import type { LlmMessage } from '@/server/llm'
import { fillTemplate, type PromptFile } from './prompt-file'
import { DEDUP_PROMPT_VERSION, PROMPT_VERSION, promptFeatures } from './prompt-version'
import { PROMPTS } from './prompts.generated'
import type { WindowInput, WindowMessage } from './types'

const HANDLE_KIND_LABEL: Record<HandleKind, string> = {
  display_private: '私聊备注名',
  display_group: '群内显示名',
  mentioned: '被@名',
  real_name: '真名',
  address_term: '称呼',
}

const CATEGORY_LABEL: Record<Category, string> = {
  work: '工作',
  location: '所在地',
  education: '教育',
  family: '家庭',
  preference: '偏好与习惯',
  life_event: '经历',
  other: '其他',
}

export function getPrompt(version: string): PromptFile {
  const p = PROMPTS[version]
  if (!p) throw new Error(`unknown prompt version: ${version}`)
  return p
}

export function listPromptVersions(prefix = 'extract.'): string[] {
  return Object.keys(PROMPTS).filter((v) => v.startsWith(prefix))
}

function renderKnown(input: WindowInput): string {
  if (!input.known.length) return '（无）'
  const lines: string[] = []
  for (const p of input.known) {
    lines.push(`- person_id ${p.personId}：${p.label}${p.personId === input.selfPersonId ? '（用户本人）' : ''}`)
    if (p.handles.length) lines.push(`  别名：${p.handles.map((h) => `${HANDLE_KIND_LABEL[h.kind]}「${h.value}」`).join('、')}`)
    if (p.claims.length) {
      lines.push('  已确认信息：')
      for (const c of p.claims) lines.push(`  - [claim ${c.id}] ${c.statement}（${CATEGORY_LABEL[c.category]}）`)
    }
  }
  return lines.join('\n')
}

function renderBody(m: WindowMessage): string {
  // Image/video bodies only carry generated file names; the tag is all the model can use.
  const body = m.kind === 'image' ? '[图片]' : m.kind === 'video' ? '[视频]' : m.body
  if (!body.trim()) return '（空）'
  return body.replace(/\r\n?/g, '\n').replace(/\n/g, '\n  ')
}

export function renderMessageLine(m: WindowMessage): string {
  return `${m.context ? '【上下文】' : ''}#${m.localSeq} [${m.sentAt}] ${m.senderName}(${m.senderPersonId ?? '?'}): ${renderBody(m)}`
}

/** SPEC §8.5 session gap (> 3 h) shown between messages when windows are packed (extract.v4+). */
const SESSION_GAP_MIN = 180

export function formatGap(minutes: number): string {
  if (minutes < 48 * 60) return `约${Math.round(minutes / 60)}小时`
  return `约${Math.round(minutes / 1440)}天`
}

export function renderMessages(messages: WindowMessage[], gapMarkers: boolean): string {
  const lines: string[] = []
  messages.forEach((m, i) => {
    if (gapMarkers && i > 0) {
      const gap = minutesBetween(messages[i - 1].sentAt, m.sentAt)
      if (gap > SESSION_GAP_MIN) lines.push(`—— 间隔${formatGap(gap)}，以下是新的一段对话 ——`)
    }
    lines.push(renderMessageLine(m))
  })
  return lines.join('\n')
}

export function renderExtractPrompt(input: WindowInput, version: string = PROMPT_VERSION): LlmMessage[] {
  const p = getPrompt(version)
  const system = fillTemplate(p.system, { example_json: p.exampleJson })
  const user = fillTemplate(p.userTemplate, {
    chat_title: input.chat.title,
    chat_kind: input.chat.kind === 'group' ? '群聊' : '私聊',
    self_person_id: String(input.selfPersonId),
    known: renderKnown(input),
    messages: renderMessages(input.messages, promptFeatures(version).gapMarkers),
  })
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

export interface DedupGroupInput {
  personId: number
  label: string
  candidates: { id: number; statement: string }[]
  new: { index: number; statement: string }[]
}

export function renderDedupPrompt(groups: DedupGroupInput[], version: string = DEDUP_PROMPT_VERSION): LlmMessage[] {
  const p = getPrompt(version)
  return [
    { role: 'system', content: fillTemplate(p.system, { example_json: p.exampleJson }) },
    { role: 'user', content: fillTemplate(p.userTemplate, { input_json: JSON.stringify({ persons: groups }) }) },
  ]
}
