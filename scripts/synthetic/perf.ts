// perf-5000.zip: 5,000 messages for the browser parse budget (ARCHITECTURE §10 P1). Not annotated, not evaluated.
import { FAMILY_POOL, PARENTS_POOL, PRIVATE_POOL } from './filler'
import { buildZip, fromMin, laidMessage, MediaCounter, Rng, selfCheck, toMin, type LaidMessage } from './lib'

export const PERF_FILE = 'perf-5000.zip'
export const PERF_COUNT = 5000

const SENDERS = ['阿杰', '小雨', '老周', '米粒', '大白', '橙子', '阿宁', '小鹿', '豆包', 'Kevin', '🍉西瓜', '7号']

// Edge-case bodies sprinkled through the perf chat so the parser is timed on realistic variety.
const EDGE_BODIES = [
  '周末安排：\n·周六 爬山\n·周日 看电影\n\n有空的报名',
  '[语音] 14"',
  '[转账]',
  '[转账] 朋友已确认收款',
  '[微信红包] 恭喜发财，大吉大利',
  '[视频通话]',
  '[图片]',
  '{{img:missing}}',
  '[音乐] 晴天',
  '[OK]',
  '哈哈哈[捂脸]行吧',
  '[引用] 老周：明天几点集合\n八点',
  '"小雨"撤回了一条消息',
  '[名片] 米粒',
  '[位置] 云杉体育中心',
  '[文件] 活动报名表.xlsx',
  '[链接] 活动须知 https://example.com/perf/notice',
  '[聊天记录] 群聊的聊天记录',
]

export function buildPerfMessages(): LaidMessage[] {
  const rng = new Rng(5000)
  const counter = new MediaCounter()
  const pools = [...PRIVATE_POOL, ...PARENTS_POOL, ...FAMILY_POOL]
  const out: LaidMessage[] = []
  let t = toMin('2024-03-01 08:00')
  let imagesIncluded = 0
  while (out.length < PERF_COUNT) {
    // a new "session" after a gap of 1..30 hours
    t += rng.int(60, 30 * 60)
    const dialogues = rng.int(1, 6)
    for (let d = 0; d < dialogues && out.length < PERF_COUNT; d++) {
      const dlg = rng.pick(pools)
      const roles = rng.shuffle(SENDERS)
      for (const [role, raw] of dlg.lines) {
        if (out.length >= PERF_COUNT) break
        t += rng.int(0, 2)
        let body = raw
        // keep ZIP small: only the first 60 images get real files
        if (body === '{{img}}' && imagesIncluded >= 60) body = '{{img:missing}}'
        if (body === '{{vid}}') body = '{{img:missing}}'
        if (body === '{{img}}') imagesIncluded++
        out.push(laidMessage(roles[role === 'A' ? 0 : role === 'B' ? 1 : 2], fromMin(t), body, counter, 'perf'))
      }
      if (rng.next() < 0.25 && out.length < PERF_COUNT) {
        t += rng.int(0, 3)
        out.push(laidMessage(rng.pick(SENDERS), fromMin(t), rng.pick(EDGE_BODIES), counter, 'perf'))
      }
    }
  }
  selfCheck(out, PERF_FILE)
  return out
}

export function buildPerfZip(): { bytes: Uint8Array; messages: LaidMessage[] } {
  const messages = buildPerfMessages()
  return { bytes: buildZip(messages, PERF_FILE), messages }
}
