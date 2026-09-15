// Everyday filler dialogues. They carry no lasting facts about people: they only make the chats realistic and dilute
// planted facts. Roles A/B/C are mapped to speakers by the layout (lib.ts), which enforces:
//   - each dialogue is used at most `maxUses` times per chat (default 2), repeats far apart and started by someone else;
//   - `at`: start-time window of the day (default 09:00–21:00), so 晚安 is late and 早 is early;
//   - `when`: calendar constraint (weekday, month/season, school term, holiday);
//   - `roles`: speaker tags per role (e.g. only the grandparents cook at home, only working adults drive).
// Every non-ack text body is unique within a pool, so no text body repeats more than twice in a chat.
// Tokens: {{img}}, {{img:missing}}, {{vid}}.
import type { FillerDialogue, Slot } from './lib'

// ---------------------------------------------------------------- calendar helpers
const HOLIDAY_RANGES: [string, string][] = [
  ['2025-10-01', '2025-10-08'],
  ['2026-01-01', '2026-01-03'],
  ['2026-02-14', '2026-02-24'],
  ['2026-04-04', '2026-04-06'],
  ['2026-05-01', '2026-05-05'],
  ['2026-06-19', '2026-06-21'],
  ['2026-09-25', '2026-09-27'],
]
const holiday = (s: Slot) => HOLIDAY_RANGES.some(([a, b]) => s.date >= a && s.date <= b)
const workday = (s: Slot) => s.weekday >= 1 && s.weekday <= 5 && !holiday(s)
const weekend = (s: Slot) => s.weekday === 0 || s.weekday === 6
const days = (...ws: number[]) => (s: Slot) => ws.includes(s.weekday)
const months = (...ms: number[]) => (s: Slot) => ms.includes(s.month)
const onDates = (...ds: string[]) => (s: Slot) => ds.includes(s.date)
const all =
  (...fs: ((s: Slot) => boolean)[]) =>
  (s: Slot) =>
    fs.every((f) => f(s))

// Speaker tags used by the parents' script: parent, grandma.
// Parents' group: summer holiday until 2026-08-31, school from Tuesday 2026-09-01.
const SCHOOL_START = '2026-09-01'
const summerHoliday = (s: Slot) => s.date < '2026-08-31'
const schoolDay = (s: Slot) => s.date >= SCHOOL_START && workday(s)
/** evening before a school day (Sun–Thu from 08-31) */
const eveOfSchool = (s: Slot) => s.date >= '2026-08-31' && s.weekday <= 4

// ---------------------------------------------------------------- private chat (two old university friends, different cities)
export const PRIVATE_POOL: FillerDialogue[] = [
  { at: ['20:30', '22:00'], when: workday, lines: [['A', '在干嘛'], ['B', '刚下班'], ['A', '这么晚'], ['B', '习惯了[流泪]']] },
  { lines: [['A', '{{img}}'], ['A', '楼下这只猫又来了'], ['B', '好胖哈哈哈'], ['B', '[动画表情]']] },
  { at: ['19:00', '22:00'], lines: [['A', '你看那个综艺了没'], ['B', '还没，好看吗'], ['A', '一般般，下饭可以']] },
  { at: ['12:00', '21:00'], when: days(4, 5), lines: [['A', '周末天气怎么样'], ['B', '说是下雨'], ['A', '那就宅着吧'], ['B', '[OK]']] },
  { lines: [['A', '[动画表情] 捂脸'], ['B', '哈哈哈哈哈'], ['B', '太真实了']] },
  { at: ['22:30', '23:20'], lines: [['A', '困了，晚安'], ['B', '晚安[月亮]']] },
  { lines: [['A', '刚刷到个段子笑死'], ['A', '[聊天记录] 群聊的聊天记录'], ['B', '笑出眼泪了'], ['B', '这群人太逗了']] },
  { at: ['07:30', '08:50'], when: months(11, 12, 1, 2, 3), lines: [['A', '早'], ['B', '早，今天又降温了'], ['A', '多穿点']] },
  { at: ['09:30', '15:00'], when: workday, lines: [['A', '今天好困'], ['B', '我也是，咖啡续命'], ['A', '[咖啡]']] },
  { at: ['19:00', '22:00'], lines: [['A', '最近在追一部剧'], ['B', '啥剧'], ['A', '回头发你，名字忘了'], ['B', '好']] },
  { at: ['22:45', '23:20'], lines: [['A', '我先睡了'], ['B', '去吧'], ['B', '晚安']] },
  { at: ['18:00', '19:30'], lines: [['A', '刚点了外卖'], ['A', '[小程序] 美团外卖'], ['B', '又点外卖'], ['A', '懒得做饭嘛']] },
  { lines: [['A', '{{vid}}'], ['A', '你看这个'], ['B', '笑出声'], ['B', '[捂脸]']] },
  { at: ['18:00', '19:30'], when: all(days(5), workday), lines: [['A', '路上好堵'], ['B', '周五都这样'], ['A', '[叹气]']] },
  { lines: [['A', '这个表情包哪来的'], ['B', '[动画表情]'], ['A', '发我发我'], ['B', '[动画表情] 狗头']] },
  { at: ['10:00', '20:00'], lines: [['A', '你那边下雨了吗'], ['B', '下了，还挺大'], ['A', '我这边刚开始']] },
  { at: ['10:00', '16:30'], when: workday, lines: [['A', '在忙吗'], ['B', '开会中'], ['A', '好，不急'], ['B', '嗯']] },
  { lines: [['A', '[呲牙][呲牙]'], ['B', '？'], ['A', '没事，手滑']] },
  { at: ['10:00', '21:00'], lines: [['A', '刚才电话没接到'], ['B', '没事，已经解决了'], ['A', '好']] },
  { lines: [['A', '看到那个新闻没'], ['B', '哪个'], ['A', '算了，不重要[捂脸]']] },
  { at: ['18:00', '20:30'], lines: [['A', '{{img}}'], ['A', '晚饭'], ['B', '馋了'], ['B', '[流泪]']] },
  { at: ['20:00', '22:00'], when: all(days(3, 4), workday), lines: [['A', '这周好忙'], ['B', '我也是'], ['A', '熬过这阵就好了']] },
  { lines: [['A', '哈哈哈哈'], ['B', '笑什么'], ['A', '想起上次的事'], ['B', '[白眼]']] },
  { at: ['10:00', '21:00'], lines: [['A', '你手机是不是没电了'], ['B', '刚充上'], ['A', '难怪']] },
  { at: ['17:30', '21:00'], when: all(days(5), workday), lines: [['A', '周末愉快'], ['B', '周末愉快[太阳]']] },
  { lines: [['A', '😂😂😂'], ['B', '？？'], ['A', '发错人了']] },
  { at: ['12:00', '17:00'], when: months(7, 8), lines: [['A', '热死了'], ['B', '我这边三十八度'], ['A', '空调续命']] },
  { at: ['07:30', '08:50'], when: months(12, 1, 2), lines: [['A', '冷得不想起床'], ['B', '同感'], ['A', '被子封印了']] },
  { once: true, lines: [['A', '你那个耳机好用吗'], ['B', '还行，降噪一般'], ['A', '那我再看看']] },
  { at: ['10:00', '21:00'], lines: [['A', '[链接] 帮我点一下 https://example.com/share/bargain'], ['B', '点了'], ['A', '谢啦']] },
  { at: ['09:00', '12:00'], when: weekend, lines: [['A', '楼上又在装修'], ['B', '周末也装？'], ['A', '从八点开始的，崩溃']] },
  { at: ['14:00', '20:00'], lines: [['A', '刚发现一家好喝的奶茶'], ['A', '[小程序] 奶茶点单'], ['B', '隔着屏幕馋我'], ['A', '下次见面请你']] },
  { at: ['10:00', '17:00'], lines: [['A', '天气好好'], ['A', '{{img}}'], ['B', '蓝天白云，羡慕']] },
  { at: ['19:00', '23:00'], lines: [['A', '你记不记得那首歌叫啥'], ['A', '就是副歌啦啦啦的那个'], ['B', '这谁猜得出来[捂脸]']] },
  { at: ['10:00', '20:00'], lines: [['A', '我快递好像丢了'], ['B', '联系快递员没'], ['A', '在找了']] },
  { at: ['23:00', '23:20'], lines: [['A', '你还醒着？'], ['B', '失眠了'], ['A', '快睡吧']] },
  { at: ['09:00', '12:00'], when: onDates('2026-01-01'), lines: [['A', '新年快乐'], ['B', '新年快乐！今年也要好好的']] },
  { at: ['19:00', '22:00'], when: onDates('2026-03-03'), lines: [['A', '元宵节快乐[庆祝]'], ['B', '元宵快乐，汤圆吃了没'], ['A', '吃了一大碗']] },
  { at: ['20:00', '22:30'], lines: [['A', '推荐个电影呗'], ['B', '最近没啥好看的'], ['A', '那我重温老片吧']] },
  { at: ['12:00', '20:00'], when: weekend, lines: [['A', '在逛商场'], ['A', '{{img}}'], ['B', '这件好看'], ['A', '太贵了，拍个照过过瘾']] },
]

// ---------------------------------------------------------------- parents' group (primary school class; no teacher in filler)
export const PARENTS_POOL: FillerDialogue[] = [
  { at: ['19:30', '21:30'], when: eveOfSchool, lines: [['A', '请问明天要带跳绳吗'], ['B', '要的，有体育课'], ['A', '谢谢']] },
  { once: true, at: ['16:00', '20:00'], when: schoolDay, lines: [['A', '哪位家长捡到一个蓝色水杯，上面贴着名字'], ['B', '我问问孩子'], ['C', '[OK]']] },
  { at: ['17:30', '20:30'], when: schoolDay, lines: [['A', '今天的作业老师发了吗'], ['B', '发了，在群文件里'], ['A', '找到了谢谢']] },
  { at: ['13:30', '15:00'], when: schoolDay, lines: [['A', '下雨了，放学接孩子记得带伞'], ['B', '好的谢谢提醒']] },
  { at: ['16:00', '20:00'], when: schoolDay, lines: [['A', '{{img}}'], ['A', '孩子们做的手工，好可爱'], ['B', '[强][强]'], ['C', '好棒']] },
  { once: true, at: ['18:30', '21:00'], when: schoolDay, lines: [['A', '数学练习册第12页是全做吗'], ['B', '老师说只做单数题'], ['A', '好的']] },
  { once: true, at: ['19:00', '21:30'], when: all(days(2), eveOfSchool), lines: [['A', '明天穿校服还是运动服'], ['B', '周三有体育课，穿运动服'], ['A', '谢谢']] },
  { once: true, at: ['09:00', '21:00'], lines: [['A', '听写本在哪买'], ['B', '校门口文具店有'], ['A', '好嘞']] },
  { at: ['19:00', '21:00'], when: eveOfSchool, lines: [['A', '有没有家长明天顺路一起接孩子'], ['B', '我可以，放学在东门等你'], ['A', '太感谢了']] },
  { at: ['18:00', '21:00'], when: schoolDay, lines: [['A', '孩子说今天午饭有鸡腿，开心了一整天'], ['B', '我家也是'], ['C', '[呲牙]']] },
  { once: true, at: ['10:00', '21:00'], lines: [['A', '[语音] 9"'], ['B', '听不清，打字吧'], ['A', '就是问下周要不要带水彩笔'], ['B', '要的，美术课用']] },
  { at: ['08:00', '12:00'], when: onDates('2026-09-10'), lines: [['A', '教师节快乐，老师们辛苦了[玫瑰]'], ['B', '老师们节日快乐'], ['C', '[玫瑰][玫瑰]']] },
  { at: ['19:00', '21:00'], when: all(days(3, 4, 5), schoolDay), lines: [['A', '这周的班级小报做完了吗'], ['B', '还没，周末做'], ['A', '我家也是，拖到最后']] },
  { once: true, at: ['16:00', '20:00'], when: schoolDay, roles: { A: ['parent'] }, lines: [['A', '{{img}}'], ['A', '这是哪位同学的外套落在我车上了'], ['B', '好像是我家的，谢谢谢谢']] },
  { at: ['21:05', '21:50'], when: schoolDay, lines: [['A', '今天作业有点多'], ['B', '是的，写到九点'], ['C', '我家还在写[流泪]']] },
  { at: ['10:00', '21:00'], lines: [['A', '{{img:missing}}'], ['B', '图片打不开'], ['A', '算了，就是个通知截图']] },
  { once: true, at: ['10:00', '21:00'], when: summerHoliday, lines: [['A', '开学要准备哪些文具'], ['B', '老师上次发过清单'], ['C', '在群文件里找找'], ['A', '找到了']] },
  { at: ['19:00', '21:00'], when: summerHoliday, lines: [['A', '暑假作业还剩一半没写[捂脸]'], ['B', '我家也在赶'], ['C', '年年如此']] },
  { once: true, at: ['10:00', '20:00'], when: summerHoliday, lines: [['A', '校服在哪领'], ['B', '开学第一天发'], ['A', '好的']] },
  { at: ['20:00', '21:30'], when: summerHoliday, lines: [['A', '孩子暑假玩疯了，作息调不回来'], ['B', '提前一周让他早点睡'], ['C', '说得容易[叹气]']] },
  { at: ['18:00', '21:00'], when: onDates('2026-08-29', '2026-08-30', '2026-08-31'), lines: [['A', '开学那天几点到校'], ['B', '七点五十'], ['A', '谢谢']] },
  { once: true, at: ['10:00', '21:00'], when: (s) => s.date <= '2026-09-04', lines: [['A', '有人知道书皮在哪买吗'], ['B', '超市就有'], ['C', '网上买便宜点']] },
  { at: ['19:00', '21:00'], when: days(4, 5), lines: [['A', '周末有没有一起去公园的'], ['A', '孩子在家闷坏了'], ['B', '我们去'], ['C', '下次吧，这周有事']] },
  { once: true, at: ['16:30', '19:00'], when: schoolDay, lines: [['A', '今天好热，孩子回来一身汗'], ['B', '教室有空调吗'], ['C', '有的，就是课间在外面跑']] },
  { at: ['19:00', '21:00'], when: schoolDay, lines: [['A', '孩子说想跟同桌换座位'], ['B', '这个得问老师'], ['A', '嗯，我私下问问']] },
  { at: ['19:00', '21:00'], when: (s) => s.weekday === 0 && s.date >= '2026-09-06', lines: [['A', '明天升旗仪式要穿校服吗'], ['B', '要的，周一都穿校服'], ['A', '好嘞']] },
  { at: ['19:00', '21:00'], when: schoolDay, lines: [['A', '孩子回家说今天学了一首古诗'], ['B', '我家的背了一晚上'], ['C', '[强]']] },
  { once: true, at: ['07:00', '07:40'], when: schoolDay, roles: { A: ['parent'] }, lines: [['A', '学校门口的路口今天好堵，大家提前出门'], ['B', '谢谢提醒']] },
  { at: ['18:00', '21:00'], when: summerHoliday, lines: [['A', '暑假阅读打卡还要交吗'], ['B', '开学交给老师'], ['A', '行，我找找本子']] },
  { at: ['10:00', '20:00'], when: summerHoliday, lines: [['A', '暑假最后几天带孩子去哪玩'], ['B', '科技馆不错'], ['C', '人太多了，要提前预约']] },
]

// ---------------------------------------------------------------- family group (June–September)
// Speaker tags used by the family script: elder (the grandparents, who live together), adult (working adults living
// elsewhere, who drive), student (away at university/internship).
export const FAMILY_POOL: FillerDialogue[] = [
  { at: ['07:00', '08:20'], lines: [['A', '早'], ['B', '早'], ['C', '早上好[太阳]']] },
  { roles: { A: ['elder'], B: ['adult', 'student'] }, lines: [['A', '[链接] 这几种食物千万不能一起吃 https://example.com/health/food-myths'], ['B', '这种都是谣言'], ['A', '小心点总没错']] },
  { at: ['18:00', '19:30'], when: days(1, 2, 3, 4), roles: { A: ['elder'], C: ['adult'] }, lines: [['A', '{{img}}'], ['A', '今天做的红烧肉'], ['B', '馋了'], ['C', '周末回去吃']] },
  { at: ['10:00', '16:00'], when: months(7, 8), roles: { A: ['elder'] }, lines: [['A', '今天好热，都少出门'], ['B', '知道了'], ['C', '[OK]']] },
  { at: ['12:00', '13:00'], roles: { A: ['elder'], B: ['adult', 'student'] }, lines: [['A', '[语音] 18"'], ['B', '语音听不了，打字'], ['A', '没事，就是问吃饭了没'], ['B', '吃了']] },
  { lines: [['A', '[动画表情]'], ['B', '哈哈哈'], ['C', '[呲牙]']] },
  { at: ['21:30', '22:30'], roles: { A: ['elder'] }, lines: [['A', '睡了，晚安'], ['B', '晚安'], ['C', '晚安[月亮]']] },
  { at: ['19:30', '21:00'], roles: { A: ['elder'] }, lines: [['A', '{{vid}}'], ['A', '楼下广场好热闹'], ['B', '跳广场舞呢']] },
  { at: ['07:00', '08:30'], roles: { A: ['elder'] }, lines: [['A', '下雨了，出门带伞'], ['B', '好']] },
  { at: ['17:30', '19:00'], when: workday, roles: { A: ['elder'], B: ['adult'] }, lines: [['A', '[视频通话]'], ['A', '刚才怎么不接'], ['B', '在开车'], ['A', '注意安全']] },
  { at: ['08:00', '11:00'], roles: { A: ['elder'], B: ['elder'] }, lines: [['A', '小区今天停水'], ['B', '什么时候来水'], ['A', '说是晚上六点']] },
  { at: ['08:00', '11:00'], when: months(6, 7, 8), roles: { A: ['elder'], B: ['adult'] }, lines: [['A', '菜市场今天的桃子好甜'], ['A', '{{img}}'], ['B', '给我留几个'], ['A', '留着呢']] },
  { at: ['09:00', '21:00'], when: months(7, 8, 9), roles: { A: ['elder'], B: ['adult'] }, lines: [['A', '看新闻说台风要来了'], ['B', '我们这边影响不大'], ['A', '还是注意点']] },
  { at: ['10:00', '20:00'], when: weekend, roles: { A: ['elder', 'adult'] }, lines: [['A', '[微信红包] 周末快乐'], ['B', '谢谢[抱拳]'], ['C', '抢到了哈哈']] },
  { at: ['18:00', '21:00'], when: days(5, 6), roles: { A: ['elder'], B: ['adult'] }, lines: [['A', '周末天气好，出去走走'], ['B', '好呀']] },
  { at: ['19:00', '21:00'], roles: { A: ['elder'], B: ['elder'] }, lines: [['A', '电视遥控器又找不到了'], ['B', '沙发缝里看看'], ['A', '找到了']] },
  { once: true, at: ['09:00', '20:00'], when: months(6, 7, 8), roles: { A: ['elder'] }, lines: [['A', '[视频号] 夏天的荷花池 https://channels.weixin.qq.com/web/pages/feed?eid=synthetic-0101'], ['B', '真好看']] },
  { at: ['09:00', '21:00'], lines: [['A', '刚才谁打我电话'], ['B', '我，按错了'], ['A', '哦哦']] },
  { at: ['09:00', '21:00'], roles: { A: ['elder'], B: ['adult', 'student'] }, lines: [['A', '家里网络好慢'], ['B', '重启一下路由器'], ['A', '好了']] },
  { at: ['10:00', '17:00'], when: months(6, 7, 8), roles: { A: ['elder'], B: ['adult'], C: ['adult'] }, lines: [['A', '西瓜买多了，谁要'], ['B', '我晚上过去拿'], ['C', '给我也留半个']] },
  { at: ['18:00', '21:00'], when: months(6, 7, 8), roles: { A: ['elder'] }, lines: [['A', '天气预报说明天有雷阵雨'], ['B', '收到'], ['C', '记得关窗']] },
  { at: ['09:00', '20:00'], when: months(6, 7, 8), roles: { A: ['elder'], B: ['adult', 'student'] }, lines: [['A', '空调遥控器怎么调除湿'], ['B', '按模式键，水滴那个'], ['A', '会了']] },
  { at: ['08:00', '11:00'], when: months(6, 7), roles: { A: ['elder'], B: ['adult', 'student'] }, lines: [['A', '{{img}}'], ['A', '阳台的茉莉开了'], ['B', '好香的样子'], ['C', '拍得不错']] },
  { at: ['09:00', '20:00'], when: onDates('2026-06-19'), lines: [['A', '端午节快乐'], ['B', '端午安康[庆祝]'], ['C', '粽子吃了没']] },
  { at: ['19:00', '21:00'], when: days(1, 2, 3, 4), roles: { A: ['elder'], B: ['adult', 'student'], C: ['adult'] }, lines: [['A', '手机又提示内存不足'], ['B', '把聊天记录清一清'], ['A', '不会弄'], ['C', '周末回去帮你弄']] },
  { at: ['19:00', '22:00'], when: months(6, 7, 8, 9), lines: [['A', '最近蚊子好多'], ['B', '插个电蚊香'], ['A', '插了，不管用']] },
  { at: ['20:00', '22:00'], when: onDates('2026-06-29', '2026-07-29', '2026-08-28'), lines: [['A', '今晚月亮好圆'], ['A', '{{img}}'], ['B', '真亮']] },
  { at: ['14:00', '17:00'], when: months(7, 8), roles: { A: ['elder'], B: ['elder'] }, lines: [['A', '冰箱里的绿豆汤记得喝'], ['B', '喝了，挺甜']] },
  { at: ['10:00', '20:00'], roles: { A: ['elder'], B: ['adult', 'student'] }, lines: [['A', '这个表情怎么发出来的'], ['B', '长按收藏就行'], ['A', '[动画表情]'], ['A', '学会了']] },
]
