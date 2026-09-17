// Synthetic fixtures for /dev/chat/showcase (fictional people, no real data). Owner: chat.
import type { AttachmentDTO, ChatDetailResponse, MessageDTO, MessageKind, MessageMeta } from '@/contracts'

const svg = (fill: string, accent: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720"><rect width="960" height="720" fill="${fill}"/><circle cx="700" cy="210" r="90" fill="#f8f5ee" opacity="0.8"/><path d="M0 560 L260 330 L430 480 L610 300 L960 600 L960 720 L0 720 Z" fill="${accent}"/><path d="M0 640 L320 470 L560 620 L960 520 L960 720 L0 720 Z" fill="#5f5a4f" opacity="0.55"/></svg>`,
  )}`

export const FIXTURE_IMAGE = svg('#d9cfb8', '#8f897b')

/** a HEIF header ('ftypheic') with no image data: Chrome cannot decode it, like a WeChat HEIC photo named .jpg (C14) */
const heif = () => {
  const b = [0, 0, 0, 24, ...'ftypheic'].map((c) => (typeof c === 'string' ? c.charCodeAt(0) : c))
  const bytes = [...b, 0, 0, 0, 0, ...[...'mif1heic'].map((c) => c.charCodeAt(0)), ...new Array(40).fill(0)]
  return `data:image/heic;base64,${btoa(String.fromCharCode(...bytes))}`
}
export const FIXTURE_HEIC = heif()

let nextId = 880000
let seq = 1024
const PEOPLE = { lin: { id: 870001, label: '林知夏' }, me: { id: 870000, label: '我' }, xu: { id: 870002, label: '许嘉禾' } }

function msg(
  sentAt: string,
  sender: { person?: { id: number; label: string }; name: string },
  body: string,
  opts: { kind?: MessageKind; meta?: MessageMeta; attachments?: Omit<AttachmentDTO, 'id' | 'messageId'>[] } = {},
): MessageDTO {
  const id = nextId++
  seq += 1024
  return {
    id,
    chatId: 860001,
    seq,
    sentAt,
    kind: opts.kind ?? 'text',
    body,
    meta: opts.meta ?? null,
    senderHandleId: sender.person ? id + 100000 : null,
    senderName: sender.name,
    senderPersonId: sender.person?.id ?? null,
    senderLabel: sender.person?.label ?? null,
    attachments: (opts.attachments ?? []).map((a, i) => ({ ...a, id: id * 10 + i, messageId: id })),
  }
}

const lin = { person: PEOPLE.lin, name: '夏夏' }
const me = { person: PEOPLE.me, name: '我是小丽' }
const xu = { person: PEOPLE.xu, name: '嘉禾' }
const stranger = { name: '装修王师傅（未关联）' }

export const HIGHLIGHT_ID = 880006

export const GROUP_MESSAGES: MessageDTO[] = [
  msg('2026-09-12 19:02', lin, '周六下午谁有空？想约大家去看新开的陶瓷展'),
  msg('2026-09-12 19:02', lin, '在美术馆三楼'),
  msg('2026-09-12 19:03', lin, '[OK]', { kind: 'sticker_code' }),
  msg('2026-09-12 19:10', me, '我可以，三点以后'),
  msg('2026-09-12 19:11', xu, '[语音] 14"', { kind: 'voice', meta: { durationSec: 14 } }),
  msg('2026-09-12 19:12', xu, '「我是小丽：我可以，三点以后」\n- - - - - - - - - - - - - - -\n那就三点半门口见', { kind: 'quote', meta: { quoted: { senderName: '我是小丽', body: '我可以，三点以后' } } }),
  msg(
    '2026-09-12 19:15',
    lin,
    '顺便说一下，我下个月要搬去杭州了，新工作在一家做动画的工作室，职位是制片。\n房子已经找好了，在西湖边上，离公司骑车十五分钟。\n\n走之前想请大家吃顿饭，时间地点我再发。这条消息比较长，用来检查多行正文的换行、行距和在窄屏上的折行是否自然，不会挤到时间那一栏。',
  ),
  msg('2026-09-12 19:16', stranger, '请问哪位是 3 栋的业主？橱柜明天上午送到'),
  msg('2026-09-12 19:18', me, '[转账] 朋友已确认收款', { kind: 'transfer', meta: { transferState: '朋友已确认收款' } }),
  msg('2026-09-12 19:18', me, '[微信红包] 周末快乐', { kind: 'red_packet', meta: { greeting: '周末快乐' } }),
  msg('2026-09-12 19:20', xu, '[图片] 微信图片_20260912_1.jpg', {
    kind: 'image',
    meta: { fileName: '微信图片_20260912_1.jpg' },
    attachments: [{ kind: 'image', fileName: '微信图片_20260912_1.jpg', selected: true, uploaded: true, byteSize: 182_000, mime: 'image/jpeg', url: FIXTURE_IMAGE }],
  }),
  msg('2026-09-12 19:20', xu, '[图片] 微信图片_20260912_3.jpg', {
    kind: 'image',
    meta: { fileName: '微信图片_20260912_3.jpg' },
    attachments: [{ kind: 'image', fileName: '微信图片_20260912_3.jpg', selected: true, uploaded: true, byteSize: 64, mime: 'image/jpeg', url: FIXTURE_HEIC }],
  }),
  msg('2026-09-12 19:20', xu, '[图片] 微信图片_20260912_2.jpg', {
    kind: 'image',
    meta: { fileName: '微信图片_20260912_2.jpg' },
    attachments: [{ kind: 'image', fileName: '微信图片_20260912_2.jpg', selected: false, uploaded: false, byteSize: null, mime: null, url: null }],
  }),
  msg('2026-09-12 19:21', xu, '[视频] 微信视频_20260912.mp4', { kind: 'video', meta: { fileName: '微信视频_20260912.mp4' } }),
  msg('2026-09-12 19:25', lin, '[动画表情] 狗头', { kind: 'animated_sticker', meta: { label: '狗头' } }),
  msg('2026-09-12 19:26', lin, '[链接] 陶瓷展开放时间 https://example.com/expo', { kind: 'link', meta: { title: '陶瓷展开放时间', url: 'https://example.com/expo' } }),
  msg('2026-09-12 19:26', lin, '[位置] 市美术馆东门', { kind: 'location', meta: { title: '市美术馆东门' } }),
  msg('2026-09-12 19:30', xu, '[小程序] 美术馆预约', { kind: 'mini_program', meta: { title: '美术馆预约' } }),
  msg('2026-09-12 19:31', xu, '[视频号] 展览开幕回顾', { kind: 'channels', meta: { title: '展览开幕回顾' } }),
  msg('2026-09-12 19:32', xu, '[名片] 美术馆讲解员小周', { kind: 'contact_card', meta: { title: '美术馆讲解员小周' } }),
  msg('2026-09-12 19:33', xu, '[聊天记录] 群聊的聊天记录', { kind: 'forward', meta: { title: '群聊的聊天记录' } }),
  msg('2026-09-12 19:34', xu, '[文件] 展览导览.pdf', { kind: 'file', meta: { fileName: '展览导览.pdf' } }),
  msg('2026-09-12 19:40', me, '[视频通话] 通话时长 03:12', { kind: 'video_call', meta: { label: '通话时长 03:12' } }),
  msg('2026-09-12 19:41', lin, '撤回了一条消息', { kind: 'recall' }),
  msg('2026-09-12 19:42', stranger, '"装修王师傅（未关联）"加入了群聊', { kind: 'system' }),
  msg('2026-09-12 20:30', lin, '[拍一拍] 拍了拍"嘉禾"', { kind: 'unknown' }),
  msg('2026-09-13 08:05', me, '早，出发前记得带学生证，有半价'),
  msg('2026-09-13 08:06', me, '好的'),
]

const people = (n: number) =>
  ['林知夏', '许嘉禾', '曾予安', '孟春和', '邓一帆', '闫小满', '唐可可', '贺知遥', 'Nora Chen', '艾梦洁', '孔春生', '毛佳怡', '宋雨桐', '白一鸣', '程亦舒', '丁若水']
    .slice(0, n)
    .map((label, i) => ({ id: 870001 + i, label, messageCount: 400 - i * 17 }))

export const GROUP_DETAIL: ChatDetailResponse = {
  chat: { id: 860001, title: '大学同学群', kind: 'group', note: null, messageCount: 2774, lastMessageAt: '2026-09-13 08:06', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-13T00:00:00.000Z' },
  participants: people(16),
  imports: [
    { id: 850001, dateFrom: '2025-07-22 15:18', dateTo: '2026-02-27 21:16', createdAt: '2026-03-01T00:00:00.000Z', newMessageCount: 1320 },
    { id: 850002, dateFrom: '2026-02-22 13:12', dateTo: '2026-07-07 22:41', createdAt: '2026-07-08T00:00:00.000Z', newMessageCount: 1012 },
    { id: 850003, dateFrom: '2026-09-03 08:03', dateTo: '2026-09-13 08:06', createdAt: '2026-09-14T00:00:00.000Z', newMessageCount: 442 },
  ],
}

export const PRIVATE_DETAIL: ChatDetailResponse = {
  chat: { id: 860002, title: '林知夏', kind: 'private', note: null, messageCount: 763, lastMessageAt: '2026-08-21 23:28', createdAt: '2026-04-19T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z' },
  participants: people(1),
  imports: [{ id: 850004, dateFrom: '2025-05-03 16:00', dateTo: '2026-04-18 21:57', createdAt: '2026-04-19T00:00:00.000Z', newMessageCount: 763 }],
}
