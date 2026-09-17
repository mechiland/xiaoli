// Synthetic fixtures for /dev/interaction/showcase (fictional people, no real data). Owner: interaction.
// Dates are relative to today so every screenshot reads the way the page really reads.
import type { ConversationDTO, InteractionResponse, LoopDTO, RhythmDTO, SegmentDTO } from '@/contracts'
import { todayInTz } from '@/lib/time'

export const TODAY = todayInTz()

/** 'YYYY-MM-DD' `n` days before today. */
export function day(n: number): string {
  const [y, m, d] = TODAY.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10)
}
export function at(n: number, hhmm: string): string {
  return `${day(n)} ${hhmm}`
}

const ISO = '2026-01-01T00:00:00.000Z'
const LIN = { id: 8701, label: '林知夏' }
const ME = { id: 8700, label: '我' }
const XU = { id: 8702, label: '许嘉禾' }

let segId = 5000
function segment(
  chatId: number,
  chatTitle: string,
  startedAt: string,
  endedAt: string,
  summary: string,
  topics: string[] = [],
  over: Partial<SegmentDTO> = {},
): SegmentDTO {
  const id = ++segId
  return {
    id,
    chatId,
    chatTitle,
    startSeq: id * 1024,
    endSeq: id * 1024 + 512,
    startedAt,
    endedAt,
    messageCount: 14,
    summary,
    topics,
    hidden: false,
    firstMessageId: 900000 + id,
    participants: [ME, LIN],
    importId: 31,
    sourceKind: 'ai',
    createdAt: ISO,
    ...over,
  }
}

function conversation(segments: SegmentDTO[], over: Partial<ConversationDTO> = {}): ConversationDTO {
  const first = segments[0]
  return {
    chatId: first.chatId,
    chatTitle: first.chatTitle,
    chatKind: 'private',
    startedAt: first.startedAt,
    endedAt: segments[segments.length - 1].endedAt,
    messageCount: segments.reduce((n, s) => n + s.messageCount, 0),
    segments,
    topics: [...new Set(segments.flatMap((s) => s.topics))],
    firstMessageId: first.firstMessageId,
    ...over,
  }
}

let loopId = 700
function loop(text: string, over: Partial<LoopDTO> = {}): LoopDTO {
  return {
    id: ++loopId,
    personId: LIN.id,
    direction: 'mine',
    kind: 'promise',
    text,
    dueAt: null,
    openedAt: at(15, '21:10'),
    openedMessageId: 900001,
    closedAt: null,
    closedMessageId: null,
    closedReason: null,
    state: 'open',
    expired: false,
    daysOpen: 15,
    status: 'confirmed',
    importId: 31,
    sourceKind: 'ai',
    evidenceCount: 2,
    createdAt: ISO,
    ...over,
  }
}

const rhythm = (over: Partial<RhythmDTO> = {}): RhythmDTO => ({
  conversationCount: 41,
  conversationCountThisYear: 34,
  lastAt: at(3, '21:40'),
  daysSinceLast: 3,
  medianGapDays: 11,
  initiatedByMe: 22,
  initiatedByThem: 12,
  privateOnly: true,
  ...over,
})

const EMPTY_RHYTHM: RhythmDTO = {
  conversationCount: 0,
  conversationCountThisYear: 0,
  lastAt: null,
  daysSinceLast: null,
  medianGapDays: null,
  initiatedByMe: null,
  initiatedByThem: null,
  privateOnly: false,
}

const CHAT = 4101
const GROUP = 4102

export const NEWEST_CONVERSATION = conversation([
  segment(CHAT, '林知夏', at(3, '19:02'), at(3, '20:10'), '她说房子下周一交钥匙，问了搬家公司怎么找；顺带聊了女儿转学的面谈时间。', ['搬家', '孩子择校']),
  segment(CHAT, '林知夏', at(3, '21:05'), at(3, '21:40'), '又聊回装修排期，她担心工期撞上开学。', ['装修']),
])

const CONVERSATIONS: ConversationDTO[] = [
  NEWEST_CONVERSATION,
  conversation([segment(CHAT, '林知夏', at(9, '12:30'), at(9, '13:15'), '中午聊了她新接的纪录片项目，十月要去一趟敦煌。', ['工作', '出差'])]),
  conversation(
    [segment(GROUP, '摄影小组', at(13, '20:00'), at(13, '21:20'), '群里约了周末去看陶瓷展，最后定在周六下午三点半。', ['看展'], { participants: [ME, LIN, XU], messageCount: 31 })],
    { chatKind: 'group', chatTitle: '摄影小组' },
  ),
  conversation([segment(CHAT, '林知夏', at(21, '09:40'), at(21, '10:05'), '她问我国庆的安排，说想带孩子来住两天。', ['国庆'])]),
  conversation([segment(CHAT, '林知夏', at(34, '22:10'), at(34, '23:02'), '聊了她父亲复查的结果，情况比上次好。', ['家人'])]),
]

// `loops.text` is a bare, subject-less fragment (prompt v9); `loopSentence` composes the subject and verb at render
// time. `direction` says WHOSE MOVE IS NEXT: `mine` = the user owes it, `theirs` = the other person does. So a
// question she asked and the user never answered is `question` + `mine` (SPEC §7 交互层).
const LOOPS: LoopDTO[] = [
  loop('帮她看简历', { openedAt: at(15, '21:10'), daysOpen: 15 }),
  loop('国庆有没有空', { direction: 'mine', kind: 'question', openedAt: at(21, '09:52'), daysOpen: 21 }),
  loop('下次见面把那本画册还给你', { direction: 'theirs', kind: 'promise', openedAt: at(18, '10:30'), daysOpen: 18 }),
  loop('体育馆的年卡在哪儿办', { direction: 'theirs', kind: 'question', openedAt: at(11, '15:20'), daysOpen: 11 }),
  loop('一起去看陶瓷展', { direction: 'mutual', kind: 'plan', dueAt: day(-9), openedAt: at(13, '20:40'), daysOpen: 13 }),
]

const EXPIRED_LOOP = loop('把老照片扫描一份给她', { openedAt: at(128, '10:20'), daysOpen: 128, expired: true })
const EXPIRED_PLAN = loop('一起回一趟汉中', { direction: 'mutual', kind: 'plan', dueAt: day(26), openedAt: at(70, '19:00'), daysOpen: 70, expired: true })
const PROPOSED_LOOP = loop('把那本画册寄给她', { status: 'proposed', openedAt: at(4, '22:15'), daysOpen: 4, evidenceCount: 1 })
const PROPOSED_EXPIRED = loop('租房中介有没有推荐的', {
  direction: 'mine',
  kind: 'question',
  status: 'proposed',
  openedAt: at(104, '08:30'),
  daysOpen: 104,
  expired: true,
})

export const FULL: InteractionResponse = {
  rhythm: rhythm(),
  loops: [EXPIRED_LOOP, ...LOOPS, PROPOSED_LOOP],
  closed: [],
  conversations: CONVERSATIONS,
  hasMore: true,
}

export const RHYTHM_ONLY: InteractionResponse = {
  rhythm: rhythm({ conversationCount: 12, conversationCountThisYear: 12, medianGapDays: 24, initiatedByMe: 5, initiatedByThem: 7 }),
  loops: [],
  closed: [],
  conversations: [],
  hasMore: false,
}

export const LOOPS_ONLY: InteractionResponse = {
  rhythm: EMPTY_RHYTHM,
  loops: LOOPS.slice(0, 4),
  closed: [],
  conversations: [],
  hasMore: false,
}

export const EXPIRED: InteractionResponse = {
  rhythm: rhythm({ conversationCount: 6, conversationCountThisYear: 6, medianGapDays: 33, initiatedByMe: 4, initiatedByThem: 2, lastAt: at(40, '10:00'), daysSinceLast: 40 }),
  loops: [EXPIRED_LOOP, EXPIRED_PLAN, LOOPS[0]],
  closed: [],
  conversations: CONVERSATIONS.slice(3),
  hasMore: false,
}

export const UNCONFIRMED: InteractionResponse = {
  rhythm: rhythm({ conversationCount: 4, conversationCountThisYear: 4, medianGapDays: null, initiatedByMe: null, initiatedByThem: null }),
  loops: [PROPOSED_EXPIRED, PROPOSED_LOOP, LOOPS[0]],
  closed: [],
  conversations: CONVERSATIONS.slice(0, 2),
  hasMore: false,
}

export const EMPTY: InteractionResponse = {
  rhythm: EMPTY_RHYTHM,
  loops: [],
  closed: [],
  conversations: [],
  hasMore: false,
}

const TOPIC_POOL = [
  ['搬家', '孩子择校'],
  ['装修', '预算'],
  ['工作'],
  ['看展'],
  ['家人'],
  ['旅行', '机票'],
  [],
]
export const LONG: InteractionResponse = {
  rhythm: rhythm({ conversationCount: 128, conversationCountThisYear: 96, medianGapDays: 4.5, initiatedByMe: 40, initiatedByThem: 56 }),
  loops: [LOOPS[0]],
  closed: [],
  conversations: Array.from({ length: 24 }, (_, i) =>
    conversation([
      segment(
        i % 5 === 4 ? GROUP : CHAT,
        i % 5 === 4 ? '摄影小组' : '林知夏',
        at(3 + i * 4, '19:30'),
        at(3 + i * 4, '20:40'),
        `第 ${i + 1} 次来往：聊了${TOPIC_POOL[i % TOPIC_POOL.length].join('和') || '些琐事'}，没有特别的结论。`,
        TOPIC_POOL[i % TOPIC_POOL.length],
        { messageCount: 8 + ((i * 7) % 40) },
      ),
    ], i % 5 === 4 ? { chatKind: 'group', chatTitle: '摄影小组' } : {}),
  ),
  hasMore: false,
}

/** 这次聊了什么 (SPEC §9.9): one hidden segment so the undo affordance is visible. */
export const IMPORT_CONVERSATIONS: ConversationDTO[] = [
  conversation([
    segment(CHAT, '林知夏', at(3, '19:02'), at(3, '20:10'), '她说房子下周一交钥匙，问了搬家公司怎么找；顺带聊了女儿转学的面谈时间。', ['搬家', '孩子择校']),
    segment(CHAT, '林知夏', at(3, '21:05'), at(3, '21:40'), '又聊回装修排期，她担心工期撞上开学。', ['装修']),
    segment(CHAT, '林知夏', at(3, '21:50'), at(3, '21:58'), '互道晚安。', [], { hidden: true, messageCount: 4 }),
  ]),
  conversation([segment(CHAT, '林知夏', at(9, '12:30'), at(9, '13:15'), '中午聊了她新接的纪录片项目，十月要去一趟敦煌。', ['工作', '出差'])]),
]

export const PLANS = [
  { person: LIN, loopId: 811, label: '一起去看陶瓷展', solar: day(-2), days: 2 },
  { person: XU, loopId: 812, label: '把老家的房产证复印件带给他', solar: day(-11), days: 11 },
]

export const LAST_CONTACT_AT = at(3, '21:40')
