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
