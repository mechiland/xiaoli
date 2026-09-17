import type { MessageKind, MessageMeta } from '@/contracts'

/**
 * Body classification (SPEC §6 table + DECISIONS parser P-decisions for unseen formats).
 * Never throws; unrecognised input is `text` or `unknown` with the raw body preserved by the caller.
 */

/** WeChat built-in emoji codes (Chinese names as exported by iOS WeChat, plus a few English variants). */
export const STICKER_CODES: ReadonlySet<string> = new Set([
  '微笑', '撇嘴', '色', '发呆', '得意', '流泪', '害羞', '闭嘴', '睡', '大哭', '尴尬', '发怒', '调皮', '呲牙', '惊讶',
  '难过', '酷', '冷汗', '抓狂', '吐', '偷笑', '愉快', '可爱', '白眼', '傲慢', '饥饿', '困', '惊恐', '流汗', '憨笑',
  '悠闲', '大兵', '奋斗', '咒骂', '疑问', '嘘', '晕', '疯了', '衰', '骷髅', '敲打', '再见', '擦汗', '抠鼻', '鼓掌',
  '糗大了', '坏笑', '左哼哼', '右哼哼', '哈欠', '鄙视', '委屈', '快哭了', '阴险', '亲亲', '吓', '可怜', '菜刀', '西瓜',
  '啤酒', '篮球', '乒乓', '咖啡', '饭', '猪头', '玫瑰', '凋谢', '嘴唇', '爱心', '心碎', '蛋糕', '闪电', '炸弹', '刀',
  '足球', '瓢虫', '便便', '月亮', '太阳', '礼物', '拥抱', '强', '弱', '握手', '胜利', '抱拳', '勾引', '拳头', '差劲',
  '爱你', 'NO', 'OK', '爱情', '飞吻', '跳跳', '发抖', '怄火', '转圈', '磕头', '回头', '跳绳', '投降', '激动', '乱舞',
  '献吻', '左太极', '右太极', '笑脸', '生病', '破涕为笑', '吐舌', '脸红', '恐惧', '失望', '无语', '嘿哈', '捂脸', '奸笑',
  '机智', '皱眉', '耶', '吃瓜', '加油', '汗', '天啊', 'Emm', '社会社会', '旺柴', '好的', '打脸', '哇', '翻白眼', '666',
  '让我看看', '叹气', '苦涩', '裂开', '合十', '庆祝', '烟花', '爆竹', '红包', '發', '福', '鸡', '小狗', '蜡烛', '囧',
  'Smile', 'Grimace', 'Drool', 'Scowl', 'Chill', 'Sob', 'Shy', 'Silent', 'Sleep', 'Cry', 'Awkward', 'Angry', 'Tongue',
  'Grin', 'Surprise', 'Frown', 'Blush', 'Scream', 'Puke', 'Chuckle', 'Joyful', 'Slight', 'Smug', 'Drowsy', 'Panic',
  'Laugh', 'Commando', 'Scold', 'Shocked', 'Shhh', 'Dizzy', 'Toasted', 'Skull', 'Hammer', 'Wave', 'Speechless',
  'NosePick', 'Clap', 'Trick', 'Bah！L', 'Bah！R', 'Yawn', 'Shrunken', 'TearingUp', 'Sly', 'Kiss', 'Whimper', 'Cleaver',
  'Watermelon', 'Beer', 'Coffee', 'Pig', 'Rose', 'Wilt', 'Lips', 'Heart', 'BrokenHeart', 'Cake', 'Bomb', 'Poop', 'Moon',
  'Sun', 'Hug', 'ThumbsUp', 'ThumbsDown', 'Shake', 'Peace', 'Fight', 'Beckon', 'Fist', 'Facepalm', 'Smirk', 'Smart',
  'Concerned', 'Yeah!', 'Onlooker', 'GoForIt', 'Sweats', 'OMG', 'Respect', 'Doge', 'NoProb', 'MyBad', 'Wow', 'Boring',
  'Awesome', 'LetMeSee', 'Sigh', 'Hurt', 'Broken', 'Worship', 'Party', 'Gift', 'Packet', 'Fireworks', 'Firecracker',
])

/** `[tag] rest` type prefixes; value = kind. Order does not matter (exact tag match). */
const TYPE_TAGS: Record<string, MessageKind> = {
  // Observed in the Mac English export; keep the original body and file names intact.
  Photo: 'image',
  Video: 'video',
  'Mini Program': 'mini_program',
  Link: 'link',
  图片: 'image',
  视频: 'video',
  语音: 'voice',
  转账: 'transfer',
  微信转账: 'transfer',
  微信红包: 'red_packet',
  小程序: 'mini_program',
  视频号: 'channels',
  动画表情: 'animated_sticker',
  表情: 'animated_sticker',
  视频通话: 'video_call',
  语音通话: 'video_call',
  // Unseen in samples (SPEC §6 "未见样本"): plausible iOS/Android tags, see DECISIONS parser P4.
  文件: 'file',
  链接: 'link',
  位置: 'location',
  名片: 'contact_card',
  个人名片: 'contact_card',
  聊天记录: 'forward',
  引用: 'quote',
  撤回: 'recall',
  系统消息: 'system',
}

const TAG_RE = /^\[([^\[\]\n]{1,12})\](?:[ \t  　]+|$|(?=\n))/
const STICKER_TOKEN_RE = /\[([^\[\]\s]{1,12})\]/g
const URL_RE = /(https?:\/\/[^\s]+)\s*$/
const QUOTE_BLOCK_RE = /^「([^「」：:\n]{1,60})[：:]([\s\S]*)」$/
const SEPARATOR_RE = /^(?:-\s*){3,}$/

/** Splits `title https://...` into title + url; url only when the last token is http(s). */
function splitTitleUrl(rest: string): MessageMeta {
  const m = URL_RE.exec(rest)
  if (!m) return rest ? { title: rest } : {}
  const title = rest.slice(0, m.index).trim()
  return title ? { title, url: m[1] } : { url: m[1] }
}

function classifyTagged(tag: string, kind: MessageKind, rest: string): { kind: MessageKind; meta: MessageMeta } {
  switch (kind) {
    case 'image':
    case 'video':
    case 'file':
      return { kind, meta: rest ? { fileName: rest } : {} }
    case 'voice': {
      const d = /(\d+(?:\.\d+)?)\s*(?:"|''|″|”|秒|s)?/.exec(rest)
      return { kind, meta: d ? { durationSec: Math.round(Number(d[1])) } : {} }
    }
    case 'transfer':
      return { kind, meta: rest ? { transferState: rest } : {} }
    case 'red_packet':
      return { kind, meta: rest ? { greeting: rest } : {} }
    case 'mini_program':
    case 'forward':
      return { kind, meta: rest ? { title: rest } : {} }
    case 'channels':
    case 'link':
      return { kind, meta: splitTitleUrl(rest) }
    case 'animated_sticker':
    case 'location':
    case 'contact_card':
      return { kind, meta: rest ? { label: rest } : {} }
    case 'video_call':
      return { kind, meta: tag === '视频通话' ? (rest ? { label: rest } : {}) : { label: rest ? `${tag} ${rest}` : tag } }
    case 'quote': {
      const q = leadingQuoteBlock(rest)
      return { kind, meta: q ? { quoted: q } : rest ? { label: rest } : {} }
    }
    default:
      return { kind, meta: rest ? { label: rest } : {} }
  }
}

function parseQuoteBlock(s: string): { senderName: string; body: string } | null {
  const m = QUOTE_BLOCK_RE.exec(s.trim())
  if (!m) return null
  return { senderName: m[1].trim(), body: m[2].trim() }
}

/** A quote block occupying the first k lines of `s` (shortest k that parses). */
function leadingQuoteBlock(s: string): { senderName: string; body: string } | null {
  const lines = s.split('\n')
  for (let k = 1; k <= lines.length; k++) {
    if (!lines[k - 1].trimEnd().endsWith('」')) continue
    const q = parseQuoteBlock(lines.slice(0, k).join('\n'))
    if (q) return q
  }
  return null
}

/**
 * Quote reply, as WeChat renders copied quotes (unseen in samples):
 *   A) "reply\n「name：quoted」"            (quote block = trailing lines)
 *   B) "「name：quoted」\n- - - - -\nreply"  (quote block, separator line, reply)
 * The quote block must start its own line. Body text stays raw; meta.quoted is a hint only.
 */
function detectQuote(body: string): { senderName: string; body: string } | null {
  if (!body.includes('「')) return null
  const lines = body.split('\n')
  // B) separator variant
  const sep = lines.findIndex((l) => SEPARATOR_RE.test(l.trim()))
  if (sep > 0) {
    const q = parseQuoteBlock(lines.slice(0, sep).join('\n'))
    if (q) return q
  }
  // A) trailing block starting at a line beginning with 「
  if (lines.length >= 2) {
    for (let i = lines.length - 1; i >= 1; i--) {
      if (lines[i].startsWith('「')) {
        const q = parseQuoteBlock(lines.slice(i).join('\n'))
        if (q) return q
        break
      }
    }
  }
  return null
}

const RECALL_RE = /^(?:"[^"\n]{1,60}"|“[^”\n]{1,60}”|你|[^\s\n]{1,30}\s?)\s?撤回了一条消息(?:\s*重新编辑)?$/
const SYSTEM_RES: RegExp[] = [
  /^(?:"[^"\n]{1,60}"|“[^”\n]{1,60}”|你)\s?邀请.{1,200}加入了群聊/,
  /^(?:"[^"\n]{1,60}"|“[^”\n]{1,60}”)\s?通过扫描.{0,80}二维码加入群聊/,
  /^(?:"[^"\n]{1,60}"|“[^”\n]{1,60}”|你)\s?(?:修改群名为|将.{1,60}移出了群聊|已成为新群主)/,
  /^(?:"[^"\n]{1,60}"|“[^”\n]{1,60}”|你|我)\s?拍了拍\s?(?:"[^"\n]{1,60}"|“[^”\n]{1,60}”|你|我|自己)/,
  /^你已添加了.{1,60}，现在可以开始聊天了。?$/,
  /^以上是打招呼的内容$/,
]

export function classifyBody(body: string): { kind: MessageKind; meta: MessageMeta } {
  const s = body.trim()
  if (!s) return { kind: 'text', meta: {} }

  const tag = TAG_RE.exec(s)
  if (tag) {
    const name = tag[1]
    const knownKind = TYPE_TAGS[name]
    const firstLineEnd = s.indexOf('\n')
    const firstLine = firstLineEnd === -1 ? s : s.slice(0, firstLineEnd)
    const rest = firstLine.slice(tag[0].length).trim()
    if (knownKind) {
      const remainder = firstLineEnd === -1 ? '' : s.slice(firstLineEnd + 1).trim()
      if (knownKind === 'quote' && remainder) {
        return classifyTagged(name, knownKind, [rest, remainder].filter(Boolean).join('\n'))
      }
      return classifyTagged(name, knownKind, rest)
    }
  }

  // sticker_code: the whole body is only emoji codes (whitespace allowed between them)
  const stripped = s.replace(STICKER_TOKEN_RE, '').trim()
  if (stripped === '') {
    const tokens = [...s.matchAll(STICKER_TOKEN_RE)].map((m) => m[1])
    if (tokens.length >= 2 || STICKER_CODES.has(tokens[0])) return { kind: 'sticker_code', meta: {} }
    return { kind: 'unknown', meta: { label: tokens[0] } }
  }

  // other `[xxx] ...` prefix → unknown (SPEC §6), unless xxx is an emoji code (then it's text with a sticker)
  if (tag && !STICKER_CODES.has(tag[1])) {
    return { kind: 'unknown', meta: { label: tag[1] } }
  }

  if (!s.includes('\n')) {
    if (RECALL_RE.test(s)) return { kind: 'recall', meta: {} }
    for (const re of SYSTEM_RES) if (re.test(s)) return { kind: 'system', meta: {} }
  }

  const quoted = detectQuote(s)
  if (quoted) return { kind: 'quote', meta: { quoted } }

  return { kind: 'text', meta: {} }
}

const MENTION_TERM_MAX = 4
const TERM_SEPARATOR = /[\s 　，,。.！!？?：:；;、~～…]/

/**
 * "@显示名 称呼" candidates. WeChat terminates a mention with U+2005 (four-per-em space); plain spaces are accepted
 * as a fallback (Android / pasted text). addressTerm = the next token (≤ 4 chars) when it is followed by a separator
 * or ends the body. Emails (`a@b.com`) are skipped.
 */
export function extractMentions(body: string): { name: string; addressTerm?: string }[] {
  const out: { name: string; addressTerm?: string }[] = []
  let i = body.indexOf('@')
  while (i !== -1) {
    const prev = i > 0 ? body[i - 1] : ''
    if (prev && /[A-Za-z0-9._%+-]/.test(prev)) {
      i = body.indexOf('@', i + 1)
      continue
    }
    const after = body.slice(i + 1)
    let name: string | null = null
    let consumed = 0
    const special = after.indexOf(' ')
    const nl = after.indexOf('\n')
    if (special > 0 && special <= 40 && (nl === -1 || special < nl) && !after.slice(0, special).includes('@')) {
      name = after.slice(0, special)
      consumed = special + 1
    } else {
      const m = /^([^\s@ ]{1,20})(?:[ 　]|$)/.exec(after)
      if (m) {
        name = m[1]
        consumed = m[0].length
      }
    }
    if (name && name.trim()) {
      const entry: { name: string; addressTerm?: string } = { name: name.trim() }
      const tail = after.slice(consumed)
      const t = /^([^\s 　@，,。.！!？?：:；;、~～…]+)/.exec(tail)
      if (t && [...t[1]].length <= MENTION_TERM_MAX) {
        const next = tail.slice(t[1].length, t[1].length + 1)
        if (next === '' || TERM_SEPARATOR.test(next)) entry.addressTerm = t[1]
      }
      out.push(entry)
      i = body.indexOf('@', i + 1 + consumed)
    } else {
      i = body.indexOf('@', i + 1)
    }
  }
  return out
}
