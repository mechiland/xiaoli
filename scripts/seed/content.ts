// Synthetic chat vocabulary for seed data: filler messages, event kinds, sensitive and rejected claim texts. Invented, generic content only.
// Claim facts themselves come from personas (persona.ts).
import type { Category, MessageKind, MessageMeta } from '@/contracts'
import type { Rng } from './rng'

/** Claim text as said in chat. `third` uses `{name}` for the person. */
export interface ClaimText {
  category: Category
  statement: string
  /** said by the person themself */
  first: string
  /** said by someone else; `{name}` is replaced with how the speaker refers to the person */
  third: string
  validFrom?: string
}

export const SENSITIVE_CLAIMS: ClaimText[] = [
  { category: 'other', statement: '提供过收货地址', first: '收货地址我单独发你了，放快递柜就行', third: '{name}的收货地址我记在备忘录里了' },
  { category: 'other', statement: '提供过联系方式', first: '我的联系方式私信发你了，有事直接打电话', third: '{name}的联系方式我私信发你' },
]

/** Jokes, wishes and exaggerations an extractor could misread as facts; seeded as rejected claims. */
export const REJECTED_CLAIMS: ClaimText[] = [
  { category: 'work', statement: '打算辞职去大理开客栈', first: '再加班我就辞职去大理开客栈', third: '{name}说再加班就辞职去大理开客栈' },
  { category: 'location', statement: '要搬去三亚住', first: '冬天太冷了，我要搬去三亚住', third: '{name}嚷嚷着冬天要搬去三亚住' },
  { category: 'education', statement: '打算重新考大学', first: '要是能重来，我就重新考一次大学', third: '{name}说要是能重来就重新考大学' },
  { category: 'preference', statement: '喜欢睡到中午', first: '这周末我要睡到中午，谁也别叫我', third: '{name}说这周末要睡到中午' },
  { category: 'life_event', statement: '中了五百万彩票', first: '我昨晚梦见自己中了五百万', third: '{name}说梦见自己中了五百万' },
  { category: 'other', statement: '对加班过敏', first: '我怀疑我对加班过敏', third: '{name}说自己对加班过敏' },
  { category: 'other', statement: '想养一只羊驼', first: '好想养一只羊驼啊', third: '{name}说好想养一只羊驼' },
  { category: 'work', statement: '明天就不去上班了', first: '明天我就不去上班了！开玩笑的', third: '{name}说明天就不去上班了' },
  { category: 'preference', statement: '每天吃三顿火锅', first: '我可以一天吃三顿火锅', third: '{name}说可以一天吃三顿火锅' },
  { category: 'location', statement: '住在公司', first: '这周基本住在公司了', third: '{name}这周基本住在公司了' },
  { category: 'life_event', statement: '要去火星旅行', first: '等有钱了我要去火星旅行', third: '{name}说等有钱了要去火星旅行' },
  { category: 'family', statement: '要把猫送给别人', first: '这猫再挠沙发我就把它送人', third: '{name}说猫再挠沙发就送人' },
]

/** Event kinds by chat context. `phrase` follows "去"/"一起". */
export interface EventKind {
  place: string
  /** "去千岛湖露营" */
  phrase: string
}
export const EVENT_KINDS: Record<'college' | 'badminton' | 'owners' | 'private' | 'family', EventKind[]> = {
  college: [
    { place: '老城区', phrase: '去老城区吃火锅' },
    { place: 'KTV', phrase: '去KTV唱歌' },
    { place: '长沙', phrase: '回长沙看母校' },
    { place: '千岛湖', phrase: '去千岛湖露营' },
    { place: '音乐节', phrase: '去音乐节听演出' },
  ],
  badminton: [
    { place: '体育馆', phrase: '去体育馆打羽毛球' },
    { place: '体育馆', phrase: '去体育馆打双打比赛' },
    { place: '体育馆旁边的烧烤店', phrase: '打完球去体育馆旁边的烧烤店聚餐' },
  ],
  owners: [
    { place: '小区中心花园', phrase: '参加小区的跳蚤市场' },
    { place: '西溪湿地', phrase: '去西溪湿地散步' },
    { place: '物业会议室', phrase: '去物业开业主大会' },
  ],
  private: [
    { place: '美术馆', phrase: '去美术馆看展' },
    { place: '郊外', phrase: '去郊外爬山' },
    { place: '陶艺工作室', phrase: '去陶艺工作室做陶艺' },
    { place: '市图书馆', phrase: '去市图书馆听讲座' },
  ],
  family: [
    { place: '三亚', phrase: '去三亚海边看日出' },
    { place: '动物园', phrase: '去动物园' },
  ],
}

type TimedText = { text: string; ok?: (hour: number, month: number) => boolean }
const FILLER_TEXT: TimedText[] = [
  { text: '哈哈哈' },
  { text: '好的' },
  { text: '收到' },
  { text: '晚上几点？', ok: (h) => h < 18 },
  { text: '我到了' },
  { text: '你们先吃', ok: (h) => (h >= 11 && h < 13) || (h >= 17 && h < 20) },
  { text: '明天见', ok: (h) => h >= 17 },
  { text: '辛苦了' },
  { text: '这个可以' },
  { text: '好久不见啊' },
  { text: '周末有空吗' },
  { text: '在路上了' },
  { text: '笑死' },
  { text: '可以可以' },
  { text: '我看看' },
  { text: '稍等一下' },
  { text: '行，就这么定了' },
  { text: '谢谢啦' },
  { text: '晚安', ok: (h) => h >= 21 },
  { text: '到家说一声', ok: (h) => h >= 19 },
  { text: '下次一起' },
  { text: '这家店不错' },
  { text: '今天好热', ok: (h, m) => m >= 6 && m <= 9 && h >= 10 },
  { text: '降温了，多穿点', ok: (_h, m) => m >= 11 || m <= 2 },
  { text: '刚开完会', ok: (h) => h >= 10 && h < 19 },
]
const STICKERS = ['[OK]', '[流泪]', '[偷笑]', '[抱拳]', '[强]', '[捂脸]']

export interface FillerMessage {
  kind: MessageKind
  body: string
  meta: MessageMeta | null
  attachment?: { kind: 'image' | 'video' | 'file'; fileName: string | null; byteSize: number; mime: string }
}

function fillerText(r: Rng, stamp: string): string {
  const hour = Number(stamp.slice(8, 10))
  const month = Number(stamp.slice(4, 6))
  const pool = FILLER_TEXT.filter((t) => !t.ok || t.ok(hour, month))
  return r.pick(pool).text
}

/** A filler message of any kind; `stamp` = 'YYYYMMDDHHMM' (local wall time) used in media file names and to keep text plausible for the hour. */
export function makeFiller(r: Rng, stamp: string, n: number, otherName: string): FillerMessage {
  const x = r.next()
  if (x < 0.5) return { kind: 'text', body: fillerText(r, stamp), meta: null }
  if (x < 0.57) return { kind: 'sticker_code', body: r.pick(STICKERS), meta: null }
  if (x < 0.63) {
    if (r.chance(0.06)) return { kind: 'image', body: '[图片] ', meta: null, attachment: { kind: 'image', fileName: null, byteSize: 0, mime: 'image/jpeg' } }
    const fileName = `微信图片_${stamp}_${n}.jpg`
    return { kind: 'image', body: `[图片] ${fileName}`, meta: { fileName }, attachment: { kind: 'image', fileName, byteSize: r.int(80_000, 900_000), mime: 'image/jpeg' } }
  }
  if (x < 0.65) {
    const fileName = `微信视频_${stamp}_${n}.mp4`
    return { kind: 'video', body: `[视频] ${fileName}`, meta: { fileName }, attachment: { kind: 'video', fileName, byteSize: r.int(2_000_000, 30_000_000), mime: 'video/mp4' } }
  }
  if (x < 0.71) {
    const d = r.int(2, 58)
    return { kind: 'voice', body: `[语音] ${d}"`, meta: { durationSec: d } }
  }
  if (x < 0.73) return r.chance(0.5) ? { kind: 'transfer', body: '[转账]', meta: null } : { kind: 'transfer', body: '[转账] 朋友已确认收款', meta: { transferState: '朋友已确认收款' } }
  if (x < 0.75) return { kind: 'red_packet', body: '[微信红包] 恭喜发财，大吉大利', meta: { greeting: '恭喜发财，大吉大利' } }
  if (x < 0.765) return { kind: 'mini_program', body: '[小程序] 周末去哪儿', meta: { title: '周末去哪儿' } }
  if (x < 0.78) return { kind: 'channels', body: '[视频号] 露营装备怎么选 https://example.com/channels/camp', meta: { title: '露营装备怎么选', url: 'https://example.com/channels/camp' } }
  if (x < 0.8) return r.chance(0.5) ? { kind: 'animated_sticker', body: '[动画表情]', meta: null } : { kind: 'animated_sticker', body: '[动画表情] 狗头', meta: { label: '狗头' } }
  if (x < 0.815) return { kind: 'video_call', body: '[视频通话]', meta: null }
  if (x < 0.835) {
    const quoted = fillerText(r, stamp)
    return { kind: 'quote', body: `「${otherName}：${quoted}」\n- - - - - - - - - - - - - - -\n${fillerText(r, stamp)}`, meta: { quoted: { senderName: otherName, body: quoted } } }
  }
  if (x < 0.85) return { kind: 'recall', body: '撤回了一条消息', meta: null }
  if (x < 0.86) return { kind: 'system', body: `"${otherName}"加入了群聊`, meta: null }
  if (x < 0.875) {
    const fileName = r.pick(['活动安排.pdf', '报价单.xlsx', '照片合集.zip', '会议纪要.docx'])
    return { kind: 'file', body: `[文件] ${fileName}`, meta: { fileName }, attachment: { kind: 'file', fileName, byteSize: r.int(20_000, 3_000_000), mime: 'application/octet-stream' } }
  }
  if (x < 0.89) return { kind: 'link', body: '[链接] 周末去哪儿玩 https://example.com/post/weekend', meta: { title: '周末去哪儿玩', url: 'https://example.com/post/weekend' } }
  if (x < 0.9) return { kind: 'location', body: '[位置] 人民公园东门', meta: { title: '人民公园东门' } }
  if (x < 0.91) return { kind: 'contact_card', body: '[名片] 修水管的王师傅', meta: { title: '修水管的王师傅' } }
  if (x < 0.925) return { kind: 'forward', body: '[聊天记录] 群聊的聊天记录', meta: { title: '群聊的聊天记录' } }
  if (x < 0.935) return { kind: 'unknown', body: `[拍一拍] 拍了拍"${otherName}"`, meta: null }
  return { kind: 'text', body: fillerText(r, stamp), meta: null }
}

/** Every MessageKind the filler generator can produce (tests assert coverage). */
export const FILLER_KINDS: MessageKind[] = ['text', 'sticker_code', 'image', 'video', 'voice', 'transfer', 'red_packet', 'mini_program', 'channels', 'animated_sticker', 'video_call', 'quote', 'recall', 'system', 'file', 'link', 'location', 'contact_card', 'forward', 'unknown']
