// Hand-written synthetic chats for extract tests. Every name, place and number is invented.
import type { ChatKind } from '@/contracts'
import { parseExportText } from '@/lib/wechat-export'
import type { OfflineMapping } from '../memory-store'

export interface Line {
  sender: string
  at: string // 'YYYY-MM-DD HH:MM'
  body: string
}

export function exportText(lines: Line[]): string {
  return lines
    .map((l) => {
      const [d, t] = l.at.split(' ')
      const [y, mo, da] = d.split('-')
      return `·${l.sender}\n${y}年${mo}月${da}日 ${t}\n${l.body}\n`
    })
    .join('\n')
}

export function parsedChat(lines: Line[], fileName = '聊天记录_20260601_120000.zip') {
  return parseExportText(exportText(lines), { fileName })
}

export function mappingFor(title: string, kind: ChatKind, senders: Record<string, string>, self: string): OfflineMapping {
  return { chat: { title, kind }, senders: Object.entries(senders).map(([senderName, person]) => ({ senderName, person })), self }
}

/** Two sessions (5 h apart) → two windows. Idx 0–3 in window 0, idx 4–7 in window 1. */
export const TWO_SESSIONS: Line[] = [
  { sender: '山野', at: '2026-05-01 09:00', body: '周末去爬山吗' },
  { sender: '阿明', at: '2026-05-01 09:02', body: '去！我带小林一起，她是我同事' },
  { sender: '阿明', at: '2026-05-01 09:03', body: '小林在读研究生，周末有空' },
  { sender: '山野', at: '2026-05-01 09:05', body: '好的' },
  { sender: '阿明', at: '2026-05-01 14:10', body: '小林说她读研二了，下个月答辩' },
  { sender: '山野', at: '2026-05-01 14:12', body: '@阿明 周老师 记得带水' },
  { sender: '阿明', at: '2026-05-01 14:13', body: '我手机号13800001111，到了打我电话' },
  { sender: '山野', at: '2026-05-01 14:15', body: '收到' },
]
export const TWO_SESSIONS_MAPPING = mappingFor('周末徒步', 'group', { 山野: 'me', 阿明: 'ming' }, 'me')

/** One short window used by the failure cassettes (title differs per scenario so request keys differ). */
export const ONE_WINDOW: Line[] = [
  { sender: '山野', at: '2026-06-02 20:00', body: '你搬到重庆了？' },
  { sender: '阿明', at: '2026-06-02 20:01', body: '对，上个月搬的，在一家设计公司上班' },
]

/**
 * Private chat: the other sender posts their own shipping block for an order self places for them (overall critic r1 #1).
 * Idx 0–3, one window. Senders: 王小明 = person "xiaoming", 山野 = self.
 */
export const SHIPPING_BLOCK: Line[] = [
  { sender: '山野', at: '2026-06-10 19:00', body: '你把收货地址发我，我给你下单' },
  { sender: '小明同学', at: '2026-06-10 19:02', body: '收货人：王小明\n手机号：13900000000\n所在地区：浙江杭州市西湖区\n详细地址：某某小区1号楼101' },
  { sender: '山野', at: '2026-06-10 19:05', body: '我在京东为你下了一笔订单' },
  { sender: '小明同学', at: '2026-06-10 19:06', body: '谢谢！' },
]
export const SHIPPING_BLOCK_MAPPING = mappingFor('小明同学', 'private', { 山野: 'me', 小明同学: 'xiaoming' }, 'me')

/** Private chat: the child shares a school ceremony post, the parent later asks about going back to school (critic r1 #3). */
export const CEREMONY: Line[] = [
  { sender: '小羽毛', at: '2026-06-12 18:00', body: '[视频号] 云杉市第一中学第十五届成人典礼 https://channels.weixin.qq.com/web/pages/feed?eid=synthetic-0201' },
  { sender: '山野', at: '2026-06-12 18:05', body: '拍得真好' },
  { sender: '山野', at: '2026-06-14 20:00', body: '儿子，啥时候返校' },
  { sender: '小羽毛', at: '2026-06-14 20:03', body: '周日下午' },
]
export const CEREMONY_MAPPING = mappingFor('小羽毛', 'private', { 山野: 'me', 小羽毛: 'son' }, 'me')

/** Private chat used by the interaction cassettes: one promise said out loud, nothing closed yet. */
export const QUOTE_PROMISE: Line[] = [
  { sender: '山野', at: '2026-06-05 20:00', body: '柜子的报价出来了吗' },
  { sender: '阿明', at: '2026-06-05 20:02', body: '还在算，周五前发给你' },
  { sender: '山野', at: '2026-06-05 20:03', body: '好，那我等你消息' },
]
