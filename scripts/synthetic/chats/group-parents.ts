// Group chat: a primary-school class parents' group. Heavy on transactional noise (fees, prices, schedules,
// "我在校门口了"), @显示名 称呼 aliases, fake sensitive data, and the "你儿子不 care" inference trap.
// All names, schools, phone numbers, card numbers and addresses are fictional.
import { PARENTS_POOL } from '../filler'
import { L, type ChatScript } from '../lib'

const M = 'M' // 小满 (self)
const T = 'T' // teacher
const D = 'D' // 豆豆妈
const LB = 'LB' // 乐乐爸爸
const A = 'A' // Amy
const Z = 'Z' // 周明杰
const G = 'G' // 果果奶奶

export const groupParents: ChatScript = {
  id: 'group-parents',
  title: '三年二班家长群',
  kind: 'group',
  speakers: { M: '小满', T: '春燕老师', D: '豆豆妈', LB: '乐乐爸爸', A: 'Amy', Z: '周明杰', G: '果果奶奶' },
  selfCode: M,
  members: [
    { key: 'xiaoman', label: '小满', displayName: '小满', note: 'self' },
    { key: 'chunyan', label: '刘春燕', displayName: '春燕老师', note: 'class teacher' },
    { key: 'doudou_mom', label: '王晓雯', displayName: '豆豆妈' },
    { key: 'lele_dad', label: '张立行', displayName: '乐乐爸爸', note: 'real name never appears in chat; label is generator-side only' },
    { key: 'amy', label: 'Amy', displayName: 'Amy' },
    { key: 'zhou_mingjie', label: '周明杰', displayName: '周明杰' },
    { key: 'guoguo_grandma', label: '果果奶奶', displayName: '果果奶奶' },
    { key: 'xiaoyu', label: '小宇', note: "Amy's son; not a sender" },
    { key: 'lele', label: '乐乐', note: 'not a sender' },
    { key: 'duoduo', label: '朵朵', note: "self's daughter; not a sender" },
  ],
  planted: [
    { id: 't-realname', type: 'handle', person: 'chunyan', handleKind: 'real_name', value: '刘春燕', text: '班主任真名刘春燕' },
    { id: 't-work', type: 'claim', person: 'chunyan', category: 'work', text: '是三年二班班主任，教语文' },
    { id: 't-mention', type: 'handle', person: 'chunyan', handleKind: 'mentioned', value: '刘老师', text: '@春燕老师 刘老师' },
    { id: 'rel-amy-xiaoyu', type: 'relation', from: 'amy', to: 'xiaoyu', relationType: 'parent', text: 'Amy 是小宇的妈妈' },
    { id: 'xiaoyu-transfer', type: 'claim', person: 'xiaoyu', category: 'education', text: '本学期转入三年二班' },
    { id: 'd-mention', type: 'handle', person: 'doudou_mom', handleKind: 'mentioned', value: '雯姐', text: '@豆豆妈 雯姐' },
    { id: 'd-realname', type: 'handle', person: 'doudou_mom', handleKind: 'real_name', value: '王晓雯', text: '真名王晓雯（出现在含手机号的消息里）', optional: true },
    { id: 'l-mention', type: 'handle', person: 'lele_dad', handleKind: 'mentioned', value: '张医生', text: '@乐乐爸爸 张医生' },
    { id: 'l-work', type: 'claim', person: 'lele_dad', category: 'work', text: '在云杉口腔医院当牙医，周二周四坐诊儿童牙科' },
    { id: 'lele-pref', type: 'claim', person: 'lele', category: 'preference', text: '喜欢恐龙', optional: true },
    { id: 'rel-l-lele', type: 'relation', from: 'lele_dad', to: 'lele', relationType: 'parent', text: '乐乐爸爸是乐乐的爸爸', optional: true },
    { id: 'z-work', type: 'claim', person: 'zhou_mingjie', category: 'work', text: '开办明杰少儿编程培训班' },
    { id: 'z-committee', type: 'claim', person: 'zhou_mingjie', category: 'other', text: '是班级家委会成员，负责收班费', optional: true },
    { id: 'duoduo-grade', type: 'claim', person: 'duoduo', category: 'education', text: '读三年级' },
    { id: 'rel-m-duoduo', type: 'relation', from: 'xiaoman', to: 'duoduo', relationType: 'parent', text: '小满是朵朵的妈妈', optional: true },
    { id: 'amy-move', type: 'claim', person: 'amy', category: 'location', text: '2026年10月搬去上海' },
    { id: 'amy-husband', type: 'claim', person: 'amy', category: 'family', text: '丈夫调到上海分公司', optional: true },
    { id: 'xiaoyu-back', type: 'claim', person: 'xiaoyu', category: 'education', text: '读完本学期转回上海', optional: true },
    { id: 'ev-farewell', type: 'event', text: '9月5日在云杉万象城给小宇办欢送会', optional: true },
  ],
  negatives: [
    { id: 'sens-bank', kind: 'sensitive', description: '家委会收款银行卡号和户名', forbidden: '卡号进入正文' },
    { id: 'tx-classfee', kind: 'transactional', description: '班费金额与截止日期' },
    { id: 'inv-transfer-b', kind: 'invisible_content', description: '班费转账，金额不可见', forbidden: '转账金额' },
    { id: 'coord-at-gate', kind: 'coordination', description: '“我在校门口了”' },
    { id: 'tx-schedule', kind: 'transactional', description: '三点半放学、东门等候' },
    { id: 'tx-price-list', kind: 'transactional', description: '编程班课程价格表' },
    { id: 'trap-your-son', kind: 'inference_trap', description: '周明杰对 Amy 说“你儿子不 care 这些”，不能推出周明杰与孩子的关系', forbidden: '周明杰与小宇（或任何孩子）的亲属关系' },
    { id: 'sens-phone', kind: 'sensitive', description: '家长把紧急联系人手机号发到群里', forbidden: '手机号进入正文' },
    { id: 'sens-address', kind: 'sensitive', description: 'Amy 发了详细收件地址', forbidden: '详细地址进入正文' },
    { id: 'coord-farewell', kind: 'coordination', description: '欢送会时间地点' },
    { id: 'coord-parking', kind: 'coordination', description: '“我到了”“我在门口停车”' },
    { id: 'inv-redpacket-b', kind: 'invisible_content', description: '红包金额不可见', forbidden: '红包金额' },
    { id: 'tx-timetable', kind: 'transactional', description: '作息时间表文件' },
    { id: 'tx-teachers-day', kind: 'transactional', description: '教师节送花安排' },
  ],
  sensitiveValues: ['6222 0000 1111 2222 333', '13900002222', '银杏路12号3栋501'],
  scenes: [
    {
      at: '2026-08-24 09:00',
      lines: [
        L(T, '"春燕老师"邀请"Amy"加入了群聊'),
        L(T, '欢迎新同学家长～这学期我继续担任三二班班主任，我是刘春燕，教语文', { p: ['t-realname', 't-work'] }),
        L(A, '刘老师好，我是小宇妈妈，小宇这学期转到咱们班', { p: ['rel-amy-xiaoyu', 'xiaoyu-transfer'] }),
        L(D, '欢迎欢迎[鼓掌]'),
        L(LB, '[强]'),
        L(M, '欢迎～'),
      ],
    },
    {
      at: '2026-08-24 20:15',
      lines: [
        L(Z, '各位家长，家委会提醒一下：', { p: ['z-committee'] }),
        L(Z, '本学期班费每人200元\n请在8月30日前转到家委会账户\n6222 0000 1111 2222 333\n户名：周明杰', { n: ['sens-bank', 'tx-classfee'], p: ['z-committee'] }),
        L(M, '收到'),
        L(D, '收到'),
        L(D, '收到', { dt: 0 }),
        L(A, '请问可以微信转吗'),
        L(Z, '可以，直接转我就行'),
        L(A, '[转账]', { n: ['inv-transfer-b'] }),
        L(Z, '[转账] 朋友已确认收款', { n: ['inv-transfer-b'] }),
      ],
    },
    {
      at: '2026-08-26 15:10',
      lines: [
        L(G, '我在校门口了，果果今天几点放学', { n: ['coord-at-gate'] }),
        L(T, '@果果奶奶 今天三点半放学，请在东门等候', { n: ['tx-schedule'] }),
        L(G, '好的好的谢谢老师'),
        L(G, '[语音] 12"'),
      ],
    },
    {
      at: '2026-08-27 21:30',
      lines: [
        L(Z, '顺便打个广告，我开的明杰少儿编程暑期班还有名额', { p: ['z-work'] }),
        L(Z, 'Scratch 入门 12 课时 1680 元\nPython 进阶 16 课时 2380 元\n报名私聊', { n: ['tx-price-list'] }),
        L(A, '小宇在上海学过一点Scratch'),
        L(Z, '那可以直接上进阶'),
        L(LB, '我们家乐乐只对恐龙感兴趣哈哈', { p: ['lele-pref', 'rel-l-lele'] }),
      ],
    },
    {
      at: '2026-08-28 20:05',
      lines: [
        L(A, '学校发的阅读书单谁家买齐了'),
        L(M, '我买齐了，网上买的'),
        L(Z, '@Amy 你儿子不 care 这些，买了也不看😂', { n: ['trap-your-son'] }),
        L(A, '哈哈哈他确实只看漫画'),
        L(D, '[动画表情] 捂脸'),
        L(A, '谁家有多余的二年级旧课本，麻烦寄到云杉市青禾区银杏路12号3栋501，谢谢', { n: ['sens-address'] }),
      ],
    },
    {
      at: '2026-08-29 12:10',
      lines: [
        L(D, '@乐乐爸爸 张医生，豆豆这两天牙疼，能去您那看看吗', { p: ['l-mention'] }),
        L(LB, '可以的，我周二周四在云杉口腔医院坐诊，挂儿童牙科就行', { p: ['l-work'] }),
        L(D, '太好了谢谢[抱拳]'),
        L(LB, '不客气，先别吃太甜的'),
      ],
    },
    {
      at: '2026-08-30 19:00',
      lines: [
        L(T, '请各位家长把紧急联系人信息私发给我，不要发群里'),
        L(D, '豆豆 紧急联系人 王晓雯 13900002222', { n: ['sens-phone'], p: ['d-realname'] }),
        L(T, '@豆豆妈 雯姐，手机号不要发群里哈，我已经记下了', { p: ['d-mention'] }),
        L(D, '不好意思，发错地方了'),
      ],
    },
    {
      at: '2026-09-01 07:50',
      lines: [
        L(M, '{{img}}'),
        L(M, '朵朵第一天上三年级，比二年级沉稳多了哈哈', { p: ['duoduo-grade', 'rel-m-duoduo'] }),
        L(A, '小宇有点紧张，毕竟新学校'),
        L(T, '放心，孩子们很快会熟悉的'),
        L(LB, '{{vid}}'),
        L(LB, '乐乐非要穿恐龙衣服去学校', { p: ['lele-pref'] }),
      ],
    },
    {
      at: '2026-09-02 21:20',
      lines: [
        L(A, '跟大家说一下，我们家下个月要搬去上海了，我老公调到上海分公司', { p: ['amy-move', 'amy-husband'] }),
        L(A, '小宇这学期读完就转回上海', { p: ['xiaoyu-back'] }),
        L(D, '啊这么快'),
        L(M, '舍不得小宇，朵朵刚跟他玩熟'),
        L(A, '以后回云杉一定约'),
        L(A, '[位置] 云杉万象城', { n: ['coord-farewell'] }),
        L(A, '周六下午三点在这儿给小宇办个欢送会，孩子们都来玩呀', { n: ['coord-farewell'], p: ['ev-farewell'] }),
      ],
    },
    {
      at: '2026-09-05 15:02',
      lines: [
        L(A, '我到了', { n: ['coord-parking'] }),
        L(M, '我在门口停车', { n: ['coord-parking'] }),
        L(Z, '[微信红包] 给小宇的欢送红包', { n: ['inv-redpacket-b'] }),
        L(A, '谢谢周老师[抱拳]'),
        L(D, '{{img}}'),
        L(D, '{{img}}', { dt: 0 }),
        L(G, '[视频通话]'),
      ],
    },
    {
      at: '2026-09-06 09:30',
      lines: [
        L(T, '[文件] 三年级上学期作息时间表.pdf', { n: ['tx-timetable'] }),
        L(T, '请家长们查收，明天周一起按新作息', { n: ['tx-timetable'] }),
        L(T, '"春燕老师"修改群名为"三年二班家长群"'),
        L(M, '收到'),
        L(LB, '收到[OK]'),
        L(Z, '[链接] 云杉实验小学秋季运动会报名通知 https://example.com/school/sports-2026'),
        L(Z, '家长志愿者报名找我'),
      ],
    },
    {
      at: '2026-09-09 20:40',
      lines: [
        L(D, '明天教师节，家委会给老师们准备了花，大家不用单独送了', { n: ['tx-teachers-day'] }),
        L(M, '好的[爱心]'),
        L(A, '[聊天记录] 群聊的聊天记录'),
        L(A, '这是之前上海学校家长群的做法，参考一下'),
        L(T, '谢谢各位家长，心意到了就好，礼物真的不用'),
        L(T, '[群公告] 教师节不收任何礼物，请家长们理解'),
      ],
    },
    {
      at: '2026-09-10 17:55',
      lines: [
        L(LB, '@春燕老师 刘老师，乐乐今天说在学校摔倒了，您知道吗', { p: ['t-mention'] }),
        L(T, '知道的，校医看过了，膝盖擦破点皮，不严重'),
        L(LB, '好的谢谢老师'),
      ],
    },
  ],
  filler: { seed: 20260910, count: 34, from: '2026-08-24', to: '2026-09-10', pool: PARENTS_POOL, speakers: [M, D, LB, A, Z, G], tags: { [M]: ['parent'], [D]: ['parent'], [LB]: ['parent'], [A]: ['parent'], [Z]: ['parent'], [G]: ['grandma'] }, minRepeatGapDays: 6 },
  extraMedia: [{ name: '微信图片_202609051530_9.jpg', kind: 'image' }],
  exports: [{ file: '聊天记录_20260910_183020.zip', from: '2026-08-01 00:00', to: '2026-09-10 23:59', purpose: '群聊（家长群）' }],
}
