// Synthetic chat/claim vocabulary and templates for seed data. Invented, generic content only.
import type { Category, MessageKind, MessageMeta } from '@/contracts'
import type { Rng } from './rng'

export const CITIES = ['杭州', '成都', '苏州', '西安', '长沙', '厦门', '青岛', '南京', '武汉', '重庆', '昆明', '大连', '合肥', '郑州', '宁波', '佛山', '深圳', '北京', '上海', '广州', '汉中', '洛阳']
const DISTRICTS = ['城东', '城西', '高新区', '老城区', '江边', '大学城', '新区', '开发区']
/** workplace → roles that plausibly work there */
const WORKPLACES: [string, string[]][] = [
  ['一家设计公司', ['UI 设计师', '项目经理', '插画师']],
  ['一家做跨境电商的公司', ['运营', '数据分析师', '产品经理']],
  ['一所中学', ['语文老师', '数学老师', '英语老师']],
  ['市第一医院', ['护士', '麻醉医生', '药剂师']],
  ['一家游戏公司', ['前端工程师', '游戏策划', '产品经理']],
  ['一家银行', ['客户经理', '柜员', '风控专员']],
  ['一家咖啡连锁', ['店长', '咖啡师培训师']],
  ['一家律师事务所', ['律师助理', '律师']],
  ['一家新能源车企', ['结构工程师', '销售主管', '测试工程师']],
  ['一家出版社', ['编辑', '美术编辑']],
  ['一家做软件的创业公司', ['前端工程师', '产品经理', 'HR']],
  ['建筑设计院', ['结构工程师', '建筑师']],
  ['一家物流公司', ['调度主管', '财务']],
  ['一家幼儿园', ['幼师', '保育员']],
  ['一家会计师事务所', ['审计', '会计']],
  ['一家动画工作室', ['原画师', '剪辑师', '制片']],
]
const ROLES = [...new Set(WORKPLACES.flatMap(([, roles]) => roles))]
const PROJECTS = ['新门店开业', '年底审计', '一个 App 改版', '医院评级', '新教材编写', '海外客户对接', '展会筹备', '仓库搬迁']
const SHOPS = ['花店', '面馆', '宠物店', '摄影工作室', '烘焙店', '书店', '茶馆']
const CERTS = ['注册会计师', '教师资格证', '一级建造师', '法律职业资格', '心理咨询师']
const SCHOOLS = ['师范大学', '理工大学', '外国语学院', '医科大学', '财经大学', '艺术学院', '农业大学', '交通大学']
const MAJORS = ['中文', '计算机', '临床医学', '会计', '英语', '土木工程', '视觉传达', '法学', '心理学', '新闻', '机械', '生物']
const HOBBIES = ['爬山', '做饭', '拍照', '跑步', '钓鱼', '弹吉他', '看话剧', '打羽毛球', '养多肉', '露营', '下围棋', '烘焙', '游泳', '骑行', '写书法', '玩桌游', '做陶艺', '种花']
const FOODS = ['香菜', '辣', '海鲜', '羊肉', '葱', '甜食', '内脏', '芹菜', '牛肉']
const DRINKS = ['美式咖啡', '普洱', '茉莉花茶', '冰可乐', '豆浆', '柠檬水', '奶茶']
const PLACES = ['图书馆', '菜市场', '郊外露营', '健身房', '茶馆', '游泳馆', '老街']
const PETS: [string, string][] = [['猫', '橘子'], ['狗', '豆豆'], ['猫', '年糕'], ['柯基', '旺财'], ['兔子', '棉花'], ['鹦鹉', '阿布'], ['猫', '芝麻']]
const KIDS = ['儿子', '女儿']
const RELATIVES = ['爸妈', '奶奶', '哥哥', '姐姐', '弟弟', '妹妹', '外婆']
const GRADES = ['幼儿园大班', '小学三年级', '初二', '高一', '大一']
const BONDS = ['大学同学', '老同事', '邻居', '高中同学', '发小']
const TRIPS = ['日本', '云南', '新疆', '泰国', '冰岛', '西藏', '意大利', '川西', '海南']
const SKILLS = ['日语', '游泳', '开车', '咖啡拉花', '钢琴', '潜水', '剪辑视频', '尤克里里']
const ALLERGENS = ['花粉', '芒果', '猫毛', '尘螨']
const SPORTS = ['游泳', '跑步', '瑜伽', '打球', '健身']

export interface ClaimText {
  category: Category
  statement: string
  /** said by the person themself */
  first: string
  /** said by someone else; `{name}` is replaced with the person's display name */
  third: string
  validFrom?: string
  /** label of another person mentioned in the statement */
  mention?: string
}

type Slots = Record<string, string>
interface Template {
  category: Category
  statement: string
  first: string
  third: string
  /** can form a superseded → current chain */
  chainable?: boolean
  slots(r: Rng, ctx: TemplateCtx): Slots
  validFrom?(r: Rng, s: Slots): string | undefined
}
export interface TemplateCtx {
  otherLabels: readonly string[]
  yearBase: number
}

const fill = (s: string, slots: Slots) => s.replace(/\{(\w+)\}/g, (_, k: string) => slots[k] ?? `{${k}}`)
const maybeYear = (r: Rng, base: number) => (r.chance(0.3) ? String(r.int(base - 8, base)) + (r.chance(0.5) ? `-${String(r.int(1, 12)).padStart(2, '0')}` : '') : undefined)

const TEMPLATES: Template[] = [
  // work
  { category: 'work', chainable: true, statement: '在{city}的{company}做{role}', first: '我现在在{city}的{company}做{role}', third: '{name}现在在{city}的{company}做{role}', slots: (r) => { const [company, roles] = r.pick(WORKPLACES); return { city: r.pick(CITIES), company, role: r.pick(roles) } }, validFrom: (r, _s) => maybeYear(r, 2025) },
  { category: 'work', statement: '做{role}已经{n}年了', first: '我做{role}都{n}年了', third: '{name}做{role}都{n}年了', slots: (r) => ({ role: r.pick(ROLES), n: String(r.int(2, 15)) }) },
  { category: 'work', statement: '最近在负责{project}', first: '最近在忙{project}，天天加班', third: '{name}最近在负责{project}', slots: (r) => ({ project: r.pick(PROJECTS) }) },
  { category: 'work', statement: '自己开了一家{shop}', first: '我自己开了家{shop}，有空来坐坐', third: '{name}自己开了家{shop}', slots: (r) => ({ shop: r.pick(SHOPS) }) },
  { category: 'work', statement: '在准备{cert}考试', first: '我在准备{cert}考试，头大', third: '{name}在准备{cert}考试', slots: (r) => ({ cert: r.pick(CERTS) }) },
  // location
  { category: 'location', chainable: true, statement: '住在{city}{district}', first: '我现在住{city}{district}那边', third: '{name}现在住在{city}{district}', slots: (r) => ({ city: r.pick(CITIES), district: r.pick(DISTRICTS) }), validFrom: (r) => maybeYear(r, 2025) },
  { category: 'location', statement: '老家在{city}', first: '我老家是{city}的', third: '{name}老家是{city}的', slots: (r) => ({ city: r.pick(CITIES) }) },
  { category: 'location', statement: '打算明年搬去{city}', first: '明年打算搬去{city}', third: '{name}说明年打算搬去{city}', slots: (r) => ({ city: r.pick(CITIES) }) },
  { category: 'location', statement: '在{city}买了房', first: '我们在{city}买了房，还在装修', third: '{name}在{city}买了房', slots: (r) => ({ city: r.pick(CITIES) }) },
  { category: 'location', statement: '经常出差去{city}', first: '我这阵子老往{city}出差', third: '{name}经常出差去{city}', slots: (r) => ({ city: r.pick(CITIES) }) },
  // education
  { category: 'education', chainable: true, statement: '在{city}{school}读{major}', first: '我在{city}{school}读{major}', third: '{name}在{city}{school}读{major}', slots: (r) => ({ city: r.pick(CITIES), school: r.pick(SCHOOLS), major: r.pick(MAJORS) }) },
  { category: 'education', statement: '{school}{major}专业毕业', first: '我是{school}{major}专业毕业的', third: '{name}是{school}{major}专业毕业的', slots: (r) => ({ school: r.pick(SCHOOLS), major: r.pick(MAJORS) }) },
  { category: 'education', statement: '在{city}读的高中', first: '我高中是在{city}读的', third: '{name}高中是在{city}读的', slots: (r) => ({ city: r.pick(CITIES) }) },
  { category: 'education', statement: '在读{major}的在职研究生', first: '我在读{major}的在职研究生', third: '{name}在读{major}的在职研究生', slots: (r) => ({ major: r.pick(MAJORS) }) },
  // family
  { category: 'family', statement: '有一个{age}岁的{kid}', first: '我{kid}今年{age}岁了', third: '{name}的{kid}今年{age}岁了', slots: (r) => ({ kid: r.pick(KIDS), age: String(r.int(1, 16)) }) },
  { category: 'family', statement: '{relative}住在{city}', first: '我{relative}住在{city}', third: '{name}的{relative}住在{city}', slots: (r) => ({ relative: r.pick(RELATIVES), city: r.pick(CITIES) }) },
  { category: 'family', statement: '和{other}是{bond}', first: '我和{other}是{bond}', third: '{name}和{other}是{bond}', slots: (r, c) => ({ other: c.otherLabels.length ? r.pick(c.otherLabels) : '小王', bond: r.pick(BONDS) }) },
  { category: 'family', statement: '{kid}在读{grade}', first: '我{kid}在读{grade}', third: '{name}的{kid}在读{grade}', slots: (r) => ({ kid: r.pick(KIDS), grade: r.pick(GRADES) }) },
  // preference
  { category: 'preference', statement: '喜欢{hobby}', first: '我最近迷上了{hobby}', third: '{name}很喜欢{hobby}', slots: (r) => ({ hobby: r.pick(HOBBIES) }) },
  { category: 'preference', statement: '不吃{food}', first: '我不吃{food}的哈', third: '{name}不吃{food}', slots: (r) => ({ food: r.pick(FOODS) }) },
  { category: 'preference', statement: '每天都要喝{drink}', first: '我每天都要来一杯{drink}', third: '{name}每天都喝{drink}', slots: (r) => ({ drink: r.pick(DRINKS) }) },
  { category: 'preference', statement: '每周{n}次{sport}', first: '我现在每周{sport}{n}次', third: '{name}每周{sport}{n}次', slots: (r) => ({ sport: r.pick(SPORTS), n: String(r.int(1, 5)) }) },
  { category: 'preference', statement: '周末常去{place}', first: '我周末一般去{place}', third: '{name}周末常去{place}', slots: (r) => ({ place: r.pick(PLACES) }) },
  // life_event
  { category: 'life_event', statement: '{year}年去{trip}旅行', first: '{year}年我们去{trip}玩了一趟', third: '{name}{year}年去{trip}玩了一趟', slots: (r, c) => ({ year: String(r.int(c.yearBase - 6, c.yearBase)), trip: r.pick(TRIPS) }), validFrom: (_r, s) => s.year },
  { category: 'life_event', statement: '{year}年结婚', first: '我们是{year}年结的婚', third: '{name}是{year}年结的婚', slots: (r, c) => ({ year: String(r.int(c.yearBase - 20, c.yearBase)) }), validFrom: (_r, s) => s.year },
  { category: 'life_event', statement: '{year}年换了工作', first: '我{year}年换了份工作', third: '{name}{year}年换了工作', slots: (r, c) => ({ year: String(r.int(c.yearBase - 8, c.yearBase)) }), validFrom: (_r, s) => s.year },
  { category: 'life_event', statement: '{year}年跑完了第一个半程马拉松', first: '{year}年我跑完了人生第一个半马', third: '{name}{year}年跑完了第一个半马', slots: (r, c) => ({ year: String(r.int(c.yearBase - 5, c.yearBase)) }), validFrom: (_r, s) => s.year },
  { category: 'life_event', statement: '{year}年搬了家', first: '我们{year}年搬的家', third: '{name}家{year}年搬的家', slots: (r, c) => ({ year: String(r.int(c.yearBase - 10, c.yearBase)) }), validFrom: (_r, s) => s.year },
  // other
  { category: 'other', statement: '养了一只叫{petName}的{pet}', first: '我家{pet}叫{petName}，可闹了', third: '{name}家的{pet}叫{petName}', slots: (r) => { const [pet, petName] = r.pick(PETS); return { pet, petName } } },
  { category: 'other', statement: '最近在学{skill}', first: '最近在学{skill}', third: '{name}最近在学{skill}', slots: (r) => ({ skill: r.pick(SKILLS) }) },
  { category: 'other', statement: '对{allergen}过敏', first: '我对{allergen}过敏', third: '{name}对{allergen}过敏', slots: (r) => ({ allergen: r.pick(ALLERGENS) }) },
]

export const CATEGORIES: Category[] = ['work', 'location', 'education', 'family', 'preference', 'life_event', 'other']

/** A claim text from a random template of `category` (or any category), not in `taken` (statements). */
export function makeClaimText(r: Rng, ctx: TemplateCtx, taken: Set<string>, opts: { category?: Category; chainable?: boolean } = {}): ClaimText {
  const pool = TEMPLATES.filter((t) => (!opts.category || t.category === opts.category) && (!opts.chainable || t.chainable))
  for (let tries = 0; tries < 80; tries++) {
    const t = r.pick(pool)
    const slots = t.slots(r, ctx)
    const statement = fill(t.statement, slots)
    if (taken.has(statement)) continue
    taken.add(statement)
    return {
      category: t.category,
      statement,
      first: fill(t.first, slots),
      third: fill(t.third, slots),
      validFrom: t.validFrom?.(r, slots),
      mention: slots.other && ctx.otherLabels.includes(slots.other) ? slots.other : undefined,
    }
  }
  // exhausted: disambiguate with a counter so counts stay exact
  const base = makeClaimTextUnchecked(r, ctx, pool)
  let n = 2
  while (taken.has(`${base.statement}（${n}）`)) n++
  const statement = `${base.statement}（${n}）`
  taken.add(statement)
  return { ...base, statement }
}

function makeClaimTextUnchecked(r: Rng, ctx: TemplateCtx, pool: Template[]): ClaimText {
  const t = r.pick(pool)
  const slots = t.slots(r, ctx)
  return { category: t.category, statement: fill(t.statement, slots), first: fill(t.first, slots), third: fill(t.third, slots), validFrom: t.validFrom?.(r, slots) }
}

export const SENSITIVE_CLAIMS: ClaimText[] = [
  { category: 'other', statement: '提供过收货地址', first: '收货地址我单独发你了，放快递柜就行', third: '{name}的收货地址我记在备忘录里了' },
  { category: 'other', statement: '提供过联系方式', first: '电话我私信发你了，有事直接打', third: '{name}的电话我私信发你' },
]

export const QUESTIONS: Record<Category, string[]> = {
  work: ['最近工作忙吗？', '现在还在原来那家吗？'],
  location: ['你现在住哪边？', '搬家了没？'],
  education: ['你当年在哪读的书？', '还在上学吗？'],
  family: ['家里人都还好吧？', '孩子多大啦？'],
  preference: ['周末一般干嘛？', '平时喜欢吃点啥？'],
  life_event: ['最近有啥新鲜事？', '去年过得怎么样？'],
  other: ['最近在折腾啥？', '有啥新爱好没？'],
}

export const RELATION_KINDS: { type: string; label: string }[] = [
  { type: 'friend', label: '好朋友' },
  { type: 'friend', label: '老朋友' },
  { type: 'classmate', label: '大学同学' },
  { type: 'classmate', label: '高中同学' },
  { type: 'colleague', label: '同事' },
  { type: 'colleague', label: '前同事' },
  { type: 'relative', label: '表姐' },
  { type: 'relative', label: '堂弟' },
  { type: 'sibling', label: '姐姐' },
  { type: 'sibling', label: '弟弟' },
  { type: 'spouse', label: '老公' },
  { type: 'spouse', label: '老婆' },
  { type: 'parent', label: '妈妈' },
  { type: 'parent', label: '老爸' },
  { type: 'child', label: '女儿' },
  { type: 'service_provider', label: '装修师傅' },
  { type: 'service_provider', label: '理发师' },
  { type: 'client', label: '客户' },
  { type: 'other', label: '邻居' },
]

export const EVENT_KINDS: { place: string; act: string }[] = [
  { place: '千岛湖', act: '露营' },
  { place: '老城区', act: '吃火锅' },
  { place: '体育馆', act: '打羽毛球' },
  { place: '郊外', act: '爬山' },
  { place: '市图书馆', act: '听讲座' },
  { place: 'KTV', act: '唱歌' },
  { place: '海边', act: '看日出' },
  { place: '陶艺工作室', act: '做陶艺' },
  { place: '音乐节', act: '听演出' },
]

export const ADDRESS_SUFFIXES = ['姐', '哥', '老师', '总', '师傅']

const FILLER_TEXT = ['哈哈哈', '好的', '收到', '晚上几点？', '我到了', '你们先吃', '明天见', '辛苦了', '这个可以', '好久不见啊', '周末有空吗', '在路上了', '笑死', '可以可以', '我看看', '稍等一下', '行，就这么定了', '谢谢啦', '晚安', '到家说一声', '下次一起', '这家店不错', '今天好热', '刚开完会']
const STICKERS = ['[OK]', '[流泪]', '[偷笑]', '[抱拳]', '[强]', '[捂脸]']

export interface FillerMessage {
  kind: MessageKind
  body: string
  meta: MessageMeta | null
  attachment?: { kind: 'image' | 'video' | 'file'; fileName: string | null; byteSize: number; mime: string }
}

/** A filler message of any kind; `stamp` = 'YYYYMMDDHHMM' used in media file names. */
export function makeFiller(r: Rng, stamp: string, n: number, otherName: string): FillerMessage {
  const x = r.next()
  if (x < 0.5) return { kind: 'text', body: r.pick(FILLER_TEXT), meta: null }
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
    const quoted = r.pick(FILLER_TEXT)
    return { kind: 'quote', body: `「${otherName}：${quoted}」\n- - - - - - - - - - - - - - -\n${r.pick(FILLER_TEXT)}`, meta: { quoted: { senderName: otherName, body: quoted } } }
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
  return { kind: 'text', body: r.pick(FILLER_TEXT), meta: null }
}

/** Every MessageKind the filler generator can produce (tests assert coverage). */
export const FILLER_KINDS: MessageKind[] = ['text', 'sticker_code', 'image', 'video', 'voice', 'transfer', 'red_packet', 'mini_program', 'channels', 'animated_sticker', 'video_call', 'quote', 'recall', 'system', 'file', 'link', 'location', 'contact_card', 'forward', 'unknown']
