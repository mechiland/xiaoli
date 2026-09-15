// Group chat: the user's family group. Address terms (老爸/儿子/妈/奶奶), @显示名 称呼, lunar and solar birthdays,
// education, a job change that supersedes an earlier job inside the same export, a planned move, and traps.
// All names, schools-as-person-facts, ID numbers and addresses are fictional.
import { FAMILY_POOL } from '../filler'
import { L, type ChatScript } from '../lib'

const M = 'M' // 小满 (self)
const F = 'F' // 林建国 (dad)
const Mo = 'Mo' // 春天的花 (mom)
const H = 'H' // 林大海 (brother)
const J = 'J' // 静静 (sister-in-law)
const N = 'N' // 林子航 (nephew)

export const groupFamily: ChatScript = {
  id: 'group-family',
  title: '林家一家人',
  kind: 'group',
  speakers: { M: '小满', F: '林建国', Mo: '春天的花', H: '林大海', J: '静静', N: '林子航' },
  selfCode: M,
  members: [
    { key: 'xiaoman', label: '小满', displayName: '小满', note: 'self' },
    { key: 'jianguo', label: '林建国', displayName: '林建国', note: "self's father" },
    { key: 'chuntian', label: '春天的花', displayName: '春天的花', note: "self's mother (WeChat nickname)" },
    { key: 'dahai', label: '林大海', displayName: '林大海', note: "self's elder brother" },
    { key: 'jingjing', label: '何静', displayName: '静静', note: "brother's wife; real name never appears" },
    { key: 'zihang', label: '林子航', displayName: '林子航', note: "brother's son" },
    { key: 'duoduo', label: '朵朵', note: "self's daughter; not a sender" },
  ],
  planted: [
    { id: 'rel-f-h', type: 'relation', from: 'jianguo', to: 'dahai', relationType: 'parent', text: '林建国是林大海的父亲（称呼“儿子”）' },
    { id: 'h-addr-erzi', type: 'handle', person: 'dahai', handleKind: 'address_term', value: '儿子', text: '父亲称林大海为“儿子”', optional: true },
    { id: 'm-mention-guinv', type: 'handle', person: 'xiaoman', handleKind: 'mentioned', value: '闺女', text: '@小满 闺女' },
    { id: 'rel-mo-m', type: 'relation', from: 'chuntian', to: 'xiaoman', relationType: 'parent', text: '春天的花是小满的妈妈' },
    { id: 'mo-addr-ma', type: 'handle', person: 'chuntian', handleKind: 'address_term', value: '妈', text: '小满称春天的花为“妈”' },
    { id: 'h-addr-laoba', type: 'handle', person: 'dahai', handleKind: 'address_term', value: '老爸', text: '林子航称林大海为“老爸”' },
    { id: 'rel-h-n', type: 'relation', from: 'dahai', to: 'zihang', relationType: 'parent', text: '林大海是林子航的父亲' },
    { id: 'rel-j-n', type: 'relation', from: 'jingjing', to: 'zihang', relationType: 'parent', text: '静静是林子航的妈妈', optional: true },
    { id: 'n-intern', type: 'claim', person: 'zihang', category: 'work', text: '2026年暑假在南京一家机器人公司实习' },
    { id: 'n-edu', type: 'claim', person: 'zihang', category: 'education', text: '在东南大学读机械专业，大三' },
    { id: 'rel-mo-n', type: 'relation', from: 'chuntian', to: 'zihang', relationType: 'relative', label: '奶奶', text: '春天的花是林子航的奶奶', optional: true },
    { id: 'mo-bday', type: 'date', person: 'chuntian', text: '生日农历七月初九', date: { kind: 'birthday', month: 7, day: 9, calendar: 'lunar' } },
    { id: 'h-work-old', type: 'claim', person: 'dahai', category: 'work', text: '在顺达物流做了十年调度' },
    { id: 'h-work-new', type: 'claim', person: 'dahai', category: 'work', text: '辞职后与朋友合伙开火锅店（大海老火锅）', validFrom: '2026-08', supersedes: 'h-work-old' },
    { id: 'h-open', type: 'claim', person: 'dahai', category: 'life_event', text: '火锅店2026年8月18日开业', validFrom: '2026-08-18', optional: true },
    { id: 'j-work', type: 'claim', person: 'jingjing', category: 'work', text: '在云杉二小教数学，教了十二年' },
    { id: 'rel-h-m', type: 'relation', from: 'dahai', to: 'xiaoman', relationType: 'sibling', label: '哥', text: '林大海是小满的哥哥' },
    { id: 'h-mention-ge', type: 'handle', person: 'dahai', handleKind: 'mentioned', value: '哥', text: '@林大海 哥' },
    { id: 'n-bday', type: 'date', person: 'zihang', text: '生日9月10日', date: { kind: 'birthday', month: 9, day: 10, calendar: 'solar' } },
    { id: 'fmo-move', type: 'claim', person: 'jianguo', category: 'location', text: '2026年10月起和妻子搬到大海家对面楼住，老房子出租', validFrom: '2026-10' },
    { id: 'mo-move', type: 'claim', person: 'chuntian', category: 'location', text: '2026年10月起搬到大海家对面楼住', validFrom: '2026-10', optional: true },
    { id: 'rel-f-mo', type: 'relation', from: 'jianguo', to: 'chuntian', relationType: 'spouse', text: '林建国与春天的花是夫妻', optional: true },
    { id: 'rel-j-h', type: 'relation', from: 'jingjing', to: 'dahai', relationType: 'spouse', text: '静静是林大海的妻子', optional: true },
    { id: 'duoduo-grade', type: 'claim', person: 'duoduo', category: 'education', text: '读三年级', optional: true },
  ],
  negatives: [
    { id: 'inv-transfer-c', kind: 'invisible_content', description: '生活费转账，金额不可见', forbidden: '生活费金额' },
    { id: 'trap-neighbor', kind: 'inference_trap', description: '隔壁老王家儿子考上清华，与家人无关', forbidden: '林子航（或家里任何人）考上清华' },
    { id: 'trap-not-care', kind: 'inference_trap', description: '“你们年轻人都不 care 这些”只是抱怨', forbidden: '据此推出任何关系或偏好' },
    { id: 'inv-redpacket-c', kind: 'invisible_content', description: '开业红包、生日红包，金额不可见', forbidden: '红包金额' },
    { id: 'inv-voice-c', kind: 'invisible_content', description: '语音内容不可见', forbidden: '猜测语音内容' },
    { id: 'sens-id', kind: 'sensitive', description: '为买票发送身份证号', forbidden: '证件号进入正文' },
    { id: 'tx-agent', kind: 'transactional', description: '中介名片、问租金' },
    { id: 'coord-midautumn', kind: 'coordination', description: '中秋在店里吃、安排包厢' },
    { id: 'tx-box', kind: 'transactional', description: '订生日包厢' },
  ],
  sensitiveValues: ['340000196612230016'],
  scenes: [
    {
      at: '2026-06-02 19:30',
      lines: [
        L(F, '儿子，周末回家吃饭不', { p: ['rel-f-h', 'h-addr-erzi'] }),
        L(H, '回，带静静和子航一起', { p: ['rel-j-h'] }),
        L(Mo, '@小满 闺女，你也回来，把朵朵带上', { p: ['m-mention-guinv', 'rel-mo-m'] }),
        L(M, '好嘞，妈', { p: ['mo-addr-ma', 'rel-mo-m'] }),
        L(M, '我带点荔枝回去'),
      ],
    },
    {
      at: '2026-06-08 10:20',
      lines: [
        L(N, '老爸，这个月生活费还没到', { p: ['h-addr-laoba', 'rel-h-n'] }),
        L(H, '转了转了'),
        L(H, '[转账]', { n: ['inv-transfer-c'] }),
        L(N, '[转账] 朋友已确认收款', { n: ['inv-transfer-c'] }),
        L(N, '谢谢老爸[抱拳]', { p: ['h-addr-laoba'] }),
        L(J, '省着点花，别天天点外卖'),
        L(N, '知道了妈', { p: ['rel-j-n'] }),
      ],
    },
    {
      at: '2026-06-20 21:00',
      lines: [
        L(Mo, '子航放暑假了吗'),
        L(N, '奶奶，下周放，暑假留在南京实习', { p: ['n-intern', 'rel-mo-n'] }),
        L(F, '大三了是该实习了', { p: ['n-edu'] }),
        L(N, '嗯，在一家做机器人的公司，跟我专业对口', { p: ['n-intern'] }),
        L(Mo, '读机械的去做机器人，好好好', { p: ['n-edu'] }),
        L(H, '他们东南大学机械专业不错的', { p: ['n-edu'] }),
      ],
    },
    {
      at: '2026-07-15 20:40',
      lines: [
        L(Mo, '大海，你们物流公司最近还那么忙吗', { p: ['h-work-old'] }),
        L(H, '妈，我正想说，我从顺达物流辞职了', { p: ['h-work-old', 'h-work-new'] }),
        L(H, '跟朋友合伙开了个火锅店，下个月开业', { p: ['h-work-new'] }),
        L(F, '胡闹！稳定工作说辞就辞'),
        L(H, '爸，我在顺达干了十年调度，也该出来闯闯了', { p: ['h-work-old'] }),
        L(J, '爸您别急，店面我们看过，在老城区'),
        L(Mo, '行吧，你们自己拿主意'),
      ],
    },
    {
      at: '2026-07-16 21:30',
      lines: [
        L(F, '隔壁老王家儿子考上清华了，你们看看人家', { n: ['trap-neighbor'] }),
        L(N, '爷爷，我都大三了[捂脸]'),
        L(F, '我是说给朵朵听的'),
        L(M, '朵朵才三年级呢爸', { p: ['duoduo-grade'] }),
        L(F, '你们年轻人都不 care 这些', { n: ['trap-not-care'] }),
      ],
    },
    {
      at: '2026-08-01 12:00',
      lines: [
        L(J, '暑假学校让我带暑托班，这几天忙'),
        L(Mo, '静静还在二小教数学啊', { p: ['j-work'] }),
        L(J, '对呀妈，在云杉二小教了十二年了', { p: ['j-work'] }),
      ],
    },
    {
      at: '2026-08-05 20:10',
      lines: [
        L(M, '妈的生日快到了，农历七月初九，今年是8月21号，大家记着点', { p: ['mo-bday'] }),
        L(H, '记着呢，今年订个包厢'),
        L(J, '我来订，还是去老地方？', { n: ['tx-box'] }),
        L(F, '别铺张，家里吃就行'),
        L(Mo, '听你爸的'),
        L(M, '@林大海 哥，荔枝给你留了一箱，记得来拿', { p: ['h-mention-ge', 'rel-h-m'] }),
      ],
    },
    {
      at: '2026-08-18 11:08',
      lines: [
        L(H, '{{img}}'),
        L(H, '今天开业，大家有空来尝尝', { p: ['h-open', 'h-work-new'] }),
        L(H, '[位置] 大海老火锅(老城区店)', { p: ['h-work-new'] }),
        L(M, '恭喜哥！晚上带朵朵过去', { p: ['rel-h-m'] }),
        L(F, '[微信红包] 开业大吉', { n: ['inv-redpacket-c'] }),
        L(Mo, '[语音] 35"', { n: ['inv-voice-c'] }),
        L(Mo, '[语音] 6"', { n: ['inv-voice-c'] }),
        L(N, '我在南京回不去[流泪]，给老爸点个赞'),
        L(N, '[动画表情]'),
      ],
    },
    {
      at: '2026-08-21 18:30',
      lines: [
        L(M, '妈生日快乐🎂', { p: ['mo-bday'] }),
        L(H, '妈生日快乐'),
        L(J, '妈生日快乐，身体健康'),
        L(N, '奶奶生日快乐！'),
        L(Mo, '谢谢孩子们[爱心]'),
        L(F, '{{vid}}'),
        L(F, '你妈吹蜡烛', { p: ['rel-f-mo'] }),
        L(F, '"林建国" 拍了拍 "林子航"'),
      ],
    },
    {
      at: '2026-08-28 09:00',
      lines: [
        L(J, '国庆高铁票我统一买，把身份证号发我'),
        L(F, '林建国 340000196612230016', { n: ['sens-id'] }),
        L(M, '我的你有，不用发'),
        L(M, '你撤回了一条消息'),
        L(N, '我自己买，从学校出发'),
        L(J, '行'),
      ],
    },
    {
      at: '2026-09-03 20:10',
      lines: [
        L(N, '下周四9月10号我生日，同学说要给我过', { p: ['n-bday'] }),
        L(Mo, '都二十一了，时间过得真快'),
        L(H, '生日快乐提前说了'),
        L(H, '[微信红包] 生日快乐', { n: ['inv-redpacket-c'] }),
        L(N, '谢谢老爸！', { p: ['h-addr-laoba'] }),
      ],
    },
    {
      at: '2026-09-08 19:45',
      lines: [
        L(F, '跟你们说个事，我和你妈下个月搬到大海那边的小区住，老房子租出去', { p: ['fmo-move', 'mo-move', 'rel-f-mo'] }),
        L(Mo, '年纪大了，离你们近点方便', { p: ['mo-move'] }),
        L(M, '好事啊，我也方便过去'),
        L(H, '房子我帮你们看好了，就在我家对面楼', { p: ['fmo-move'] }),
        L(F, '[名片] 中介小刘', { n: ['tx-agent'] }),
        L(F, '这个中介靠谱，你们谁有空帮我问问租金', { n: ['tx-agent'] }),
      ],
    },
    {
      at: '2026-09-11 21:00',
      lines: [
        L(Mo, '[链接] 中秋节老人出行注意事项 https://example.com/health/mid-autumn'),
        L(Mo, '大家都看看'),
        L(J, '妈，中秋25号咱们还是在店里吃？', { n: ['coord-midautumn'] }),
        L(H, '在店里，我安排包厢', { n: ['coord-midautumn'] }),
        L(Mo, '[聊天记录] 春天的花和林建国的聊天记录'),
        L(F, '[OK]'),
        L(M, '👌'),
        L(N, '[音乐] 追光者'),
      ],
    },
    {
      at: '2026-09-12 08:40',
      lines: [
        L(F, '早'),
        L(Mo, '早，今天降温了，都多穿点'),
        L(M, '收到[爱心]'),
        L(F, '嗯'),
        L(F, '嗯', { dt: 0 }),
      ],
    },
  ],
  filler: {
    seed: 20260912,
    count: 42,
    from: '2026-06-01',
    to: '2026-09-11',
    pool: FAMILY_POOL,
    speakers: [M, F, Mo, H, J, N],
    tags: { [F]: ['elder'], [Mo]: ['elder'], [M]: ['adult'], [H]: ['adult'], [J]: ['adult'], [N]: ['student'] },
    minRepeatGapDays: 21,
  },
  exports: [{ file: '聊天记录_20260912_095501.zip', from: '2026-05-01 00:00', to: '2026-09-12 23:59', purpose: '群聊（家庭群）', text: { bom: true, crlf: true, trailingNewline: false } }],
}
