// Conversation scripts for the interaction layer (SPEC §7 交互层): short bursts of real dialogue that the seed
// plants in a chat on one day, so a conversation segment can span a real, coherent stretch of messages.
//
// Every script is invented; `{a}` / `{b}` are replaced with how the chat names the cast. `mark` names a line the
// seed hangs a loop on (its opening or closing message), so `openedMessageId` / `closedMessageId` always point at a
// message that really says the thing.
export interface ConvLine {
  who: 'self' | 'a' | 'b'
  text: string
  /** named anchor a loop plan refers to */
  mark?: string
}

export interface ConvScript {
  key: string
  /** the 段落摘要 as a person would write it ("聊了搬家和孩子择校") */
  summary: string
  /** 2–4 话题词 */
  topics: string[]
  lines: ConvLine[]
}

const s = (who: ConvLine['who'], text: string, mark?: string): ConvLine => ({ who, text, ...(mark ? { mark } : {}) })

/** 与 long-profile 的私聊：她 2025 年 8 月从上海搬到杭州城西，9 月进了一家动画工作室，女儿 5 岁，妈妈在苏州，养了一只叫年糕的猫。 */
export const LONG_SCRIPTS: Record<string, ConvScript> = {
  move: {
    key: 'pl-move',
    summary: '聊了搬家和孩子择校',
    topics: ['搬家', '择校', '猫'],
    lines: [
      s('self', '你们家具都搬完了吗'),
      s('a', '差不多了，就剩书房那堆书还没拆箱'),
      s('self', '城西那边幼儿园你打听得怎么样了'),
      s('a', '看了两家，一家离得近一家教得好，纠结死了'),
      s('self', '离得近的先去试一天课呗'),
      s('a', '也是，我周末带她去看看'),
      s('a', '对了，年糕到新家一直躲柜子底下，愁人'),
      s('self', '猫都这样，过一个礼拜就好了'),
    ],
  },
  job: {
    key: 'pl-job',
    summary: '聊了她跳槽到动画工作室的事',
    topics: ['跳槽', '动画', '通勤'],
    lines: [
      s('a', '我下个月就去新公司报到了'),
      s('self', '动画工作室那个？恭喜啊'),
      s('a', '嗯，还是做制片，就是通勤远一点'),
      s('self', '从城西到滨江地铁得四十分钟吧'),
      s('a', '四十分钟打底，早高峰还得挤'),
      s('self', '慢慢适应，总比在上海一趟两个小时强'),
      s('a', '那倒是，起码晚上能回家吃饭'),
    ],
  },
  resume: {
    key: 'pl-resume',
    summary: '聊了她表妹找工作的事',
    topics: ['找工作', '简历'],
    lines: [
      s('a', '我表妹今年毕业，简历投了一个月没回音'),
      s('self', '她想做什么岗位'),
      s('a', '想做新媒体运营，文字还行就是没经验'),
      s('self', '简历你发我吧，我这周帮她看看', 'open'),
      s('a', '那太好了，我这就让她整理一份'),
      s('self', '不急，周末之前给我就行'),
    ],
  },
  holiday: {
    key: 'pl-holiday',
    summary: '聊了她妈妈的身体，她问了国庆的安排',
    topics: ['家人', '国庆', '露营'],
    lines: [
      s('self', '阿姨身体最近怎么样'),
      s('a', '挺好的，就是老念叨让我回去'),
      s('self', '那你多回去看看，苏州也不远'),
      s('a', '嗯，这个月回过一趟了'),
      s('a', '对了，国庆你有空吗？想约着一起去千岛湖', 'open'),
      s('a', '上次那个露营地我一直惦记着'),
    ],
  },
  exhibition: {
    key: 'pl-exhibition',
    summary: '约了下个月一起去看动画展',
    topics: ['动画展', '约饭'],
    lines: [
      s('self', '你上次说的那个动画展，我看了下展期'),
      s('a', '我也在看！要不下个月一起去'),
      s('self', '行啊，挑个周末'),
      s('a', '那就说定了，看完再吃个饭', 'open'),
      s('self', '好，我先把票收藏起来'),
    ],
  },
  askKindergarten: {
    key: 'pl-ask-kindergarten',
    summary: '聊了她想搬来杭州的打算',
    topics: ['搬家', '杭州', '幼儿园'],
    lines: [
      s('a', '我们在认真考虑搬来杭州了'),
      s('self', '真的？那太好了'),
      s('a', '就是不知道那边幼儿园好不好进'),
      s('self', '我帮你问问我们小区附近的几家', 'open'),
      s('a', '那就麻烦你了'),
    ],
  },
  kindergartenDone: {
    key: 'pl-kindergarten-done',
    summary: '把打听到的幼儿园资料给了她',
    topics: ['幼儿园', '资料'],
    lines: [
      s('self', '幼儿园的事我问到了，明天把资料发你', 'close'),
      s('a', '太感谢了'),
      s('self', '一共三家，两家公办一家民办'),
      s('a', '我周末好好看看'),
    ],
  },
  book: {
    key: 'pl-book',
    summary: '聊了纪录片和最近看的书',
    topics: ['看书', '纪录片'],
    lines: [
      s('self', '昨晚熬夜看完一本讲纪录片拍摄的书'),
      s('a', '听着不错'),
      s('a', '叫什么名字？我也买一本', 'open'),
      s('a', '我最近正好想补一补这方面'),
    ],
  },
  newYear: {
    key: 'pl-newyear',
    summary: '聊了过年回苏州的安排',
    topics: ['过年', '苏州', '高铁'],
    lines: [
      s('a', '今年过年我们回苏州'),
      s('self', '高铁票抢到了吗'),
      s('a', '抢到了，腊月二十八的'),
      s('self', '那还挺早，回去能多待几天'),
      s('a', '是啊，我妈都开始念叨要包多少饺子了'),
    ],
  },
  smalltalk: {
    key: 'pl-smalltalk',
    summary: '随口聊了降温和晚饭',
    topics: ['闲聊'],
    lines: [
      s('self', '今天杭州降温了，你那边呢'),
      s('a', '上海也冷，风特别大'),
      s('self', '晚上吃什么'),
      s('a', '随便下点面吧，懒得做'),
      s('self', '我也是'),
    ],
  },
  project: {
    key: 'pl-project',
    summary: '聊了她新工作接手的第一个项目',
    topics: ['新工作', '动画短片', '排期'],
    lines: [
      s('a', '我接手第一个项目了，一部动画短片'),
      s('self', '这么快就上手了'),
      s('a', '赶鸭子上架，排期表昨天刚拉完'),
      s('self', '你最擅长这个'),
      s('a', '排期还行，难的是预算'),
      s('self', '被砍了？'),
      s('a', '制作费砍了两成，还得保证质量'),
      s('self', '那只能压后期了'),
      s('a', '上周连着加了三天班'),
      s('self', '别太拼，身体要紧'),
    ],
  },
  morning: {
    key: 'pl-morning',
    summary: '早上聊了送孩子上学',
    topics: ['孩子', '上学'],
    lines: [
      s('a', '早，刚把孩子送到幼儿园'),
      s('self', '你们家离得近真好'),
      s('a', '走路十分钟，比在上海强多了'),
    ],
  },
  evening: {
    key: 'pl-evening',
    summary: '晚上聊了她妈妈来杭州小住',
    topics: ['家人', '小住'],
    lines: [
      s('a', '我妈这周末过来住几天'),
      s('self', '那你可以歇歇了'),
      s('a', '主要是她想外孙女了'),
      s('self', '带阿姨去西湖转转'),
    ],
  },
}

/** 大学同学群 */
export const COLLEGE_SCRIPTS: Record<string, ConvScript> = {
  reunion: {
    key: 'gb-reunion',
    summary: '群里商量了毕业十周年聚会',
    topics: ['同学聚会', '长沙'],
    lines: [
      s('a', '明年就毕业十年了，要不组织一次聚会'),
      s('b', '支持！回长沙吗'),
      s('a', '回学校看看也行'),
      s('self', '我可以帮忙统计人数'),
      s('b', '那我负责联系班主任'),
      s('a', '时间定在五一前后比较合适'),
    ],
  },
  kids: {
    key: 'gb-kids',
    summary: '聊了各家小孩上学的事',
    topics: ['孩子', '上学', '学区'],
    lines: [
      s('b', '你们家孩子上几年级了'),
      s('a', '今年刚上一年级'),
      s('self', '时间过得真快'),
      s('b', '学区房愁死我了'),
      s('a', '别提了，都一样'),
    ],
  },
  groupPhoto: {
    key: 'gb-groupphoto',
    summary: '找毕业合影的原图',
    topics: ['合影', '老照片'],
    lines: [
      s('self', '有人还留着毕业合影的原图吗'),
      s('a', '我电脑里应该有，晚点找出来发给你', 'open'),
      s('b', '我只有翻拍的，糊得不行'),
      s('self', '有原图最好，想洗一张出来'),
    ],
  },
  nationalDay: {
    key: 'gb-nationalday',
    summary: '这天群里定了国庆回长沙的行程',
    topics: ['国庆', '长沙', '母校'],
    lines: [
      s('a', '国庆有人回长沙吗'),
      s('b', '我回，带家属'),
      s('self', '我看看能不能请到假'),
      s('a', '到时候一起去学校门口那家粉店'),
      s('b', '那家还在？太怀念了'),
    ],
  },
  photos: {
    key: 'gb-photos',
    summary: '聊了上次聚会的照片',
    topics: ['照片', '聚会'],
    lines: [
      s('b', '上次聚会的照片谁那儿有'),
      s('self', '我相机里有一堆，我回头整理好发群里', 'open'),
      s('a', '等你的照片'),
      s('b', '记得把合影单独发一份'),
    ],
  },
  borrow: {
    key: 'gb-borrow',
    summary: '聊了借出去的书和找钢琴老师',
    topics: ['借书', '钢琴课'],
    lines: [
      s('a', '上次那本书我看完了，下次见面还你', 'open-book'),
      s('self', '不急，你留着看'),
      s('b', '有没有人认识靠谱的钢琴老师？想给孩子找一个', 'open-piano'),
      s('a', '我帮你打听打听'),
    ],
  },
}

/** 小区业主群 */
export const OWNERS_SCRIPTS: Record<string, ConvScript> = {
  renovation: {
    key: 'ow-renovation',
    summary: '聊了楼上装修的噪音',
    topics: ['装修', '噪音', '物业'],
    lines: [
      s('a', '楼上又在装修，一早上就开始砸墙'),
      s('b', '我也被吵醒了'),
      s('self', '要不跟物业反映一下'),
      s('a', '我已经打过电话了，说会去沟通'),
      s('b', '希望别拖太久'),
    ],
  },
  parcel: {
    key: 'ow-parcel',
    summary: '聊了新装的快递柜',
    topics: ['快递', '门禁'],
    lines: [
      s('b', '新的快递柜装好了吗'),
      s('a', '装好了，在西门旁边'),
      s('self', '那以后方便多了'),
    ],
  },
  market: {
    key: 'ow-market',
    summary: '商量了周末的小区跳蚤市场',
    topics: ['跳蚤市场', '摆摊'],
    lines: [
      s('a', '周末花园那边搞跳蚤市场，有人一起摆摊吗'),
      s('self', '我把家里闲置的书拿去'),
      s('b', '我出个茶摊，带两把折叠椅'),
      s('a', '那就定了，九点在中心花园集合'),
    ],
  },
  water: {
    key: 'ow-water',
    summary: '通知了停水和电梯检修',
    topics: ['停水', '电梯', '物业'],
    lines: [
      s('b', '明天上午停水，大家记得存水'),
      s('a', '电梯也要检修，说是检两天'),
      s('self', '收到，谢谢提醒'),
    ],
  },
}

/** 周末羽毛球 */
export const BADMINTON_SCRIPTS: Record<string, ConvScript> = {
  booking: {
    key: 'bd-booking',
    summary: '约了周末的场地',
    topics: ['订场', '双打'],
    lines: [
      s('a', '这周六还是八点的场？'),
      s('self', '订好了，两片场地'),
      s('b', '我可能晚半小时到'),
      s('a', '没事，先热身'),
    ],
  },
  racket: {
    key: 'bd-racket',
    summary: '聊了球拍拉线的磅数',
    topics: ['球拍', '拉线'],
    lines: [
      s('b', '我新拍子到了，拉多少磅合适'),
      s('a', '你先从24磅试起'),
      s('self', '别拉太高，手腕受不了'),
    ],
  },
  dinner: {
    key: 'bd-dinner',
    summary: '打完球约了烧烤',
    topics: ['聚餐', '烧烤'],
    lines: [
      s('a', '打完去吃烧烤？'),
      s('self', '走'),
      s('b', '我请客，上次输了赌局'),
      s('a', '那必须去'),
    ],
  },
}

/** 通用私聊：`{a}` 不出现在正文里，任何一对一聊天都读得通。 */
export const PRIVATE_SCRIPTS: Record<string, ConvScript> = {
  work: {
    key: 'pv-work',
    summary: '聊了最近的工作',
    topics: ['工作', '加班'],
    lines: [
      s('a', '最近忙得脚不沾地'),
      s('self', '又赶项目？'),
      s('a', '嗯，这波结束就能歇两天'),
      s('self', '撑住，别老熬夜'),
    ],
  },
  weekend: {
    key: 'pv-weekend',
    summary: '聊了周末的安排',
    topics: ['周末', '约饭'],
    lines: [
      s('self', '这周末有安排吗'),
      s('a', '还没定，怎么了'),
      s('self', '想约你吃个饭'),
      s('a', '好啊，你定地方'),
    ],
  },
  health: {
    key: 'pv-health',
    summary: '聊了体检报告和作息',
    topics: ['体检', '作息'],
    lines: [
      s('a', '上周体检报告出来了'),
      s('self', '没什么大问题吧'),
      s('a', '就是有点脂肪肝，让我少喝酒'),
      s('self', '那正好戒了'),
    ],
  },
  trip: {
    key: 'pv-trip',
    summary: '聊了那趟古镇短途游',
    topics: ['旅行', '古镇'],
    lines: [
      s('self', '上次说的那个古镇你去了吗'),
      s('a', '去了，人少景好'),
      s('self', '下次带我一个'),
      s('a', '没问题'),
    ],
  },
  kid: {
    key: 'pv-kid',
    summary: '聊了孩子最近的变化',
    topics: ['孩子', '家里'],
    lines: [
      s('a', '孩子最近迷上了拼图'),
      s('self', '这个年纪正好'),
      s('a', '一坐一下午，省心'),
    ],
  },
  houseAsk: {
    key: 'pv-house-ask',
    summary: '聊了他想换房的打算',
    topics: ['换房', '苏州'],
    lines: [
      s('a', '我们在看园区那边的房子'),
      s('self', '想换个大点的？'),
      s('a', '孩子大了，得有个书房'),
      s('self', '回头我把打听到的房源整理给你', 'open'),
      s('a', '那太好了'),
    ],
  },
  houseDrop: {
    key: 'pv-house-drop',
    summary: '他调去上海，看房的事先放下了',
    topics: ['调岗', '上海', '看房'],
    lines: [
      s('a', '公司把我调去上海总部了'),
      s('self', '那苏州的房子还看吗'),
      s('a', '先不看了，等安顿下来再说', 'close'),
      s('self', '也好，先安顿要紧'),
    ],
  },
  planMeal: {
    key: 'pv-plan-meal',
    summary: '约了下下周一起吃饭',
    topics: ['约饭', '周末'],
    lines: [
      s('a', '下周有空一起吃个饭吗'),
      s('self', '有啊，周几'),
      s('a', '就定下下周六吧，我订位子', 'open'),
      s('self', '好，到时候见'),
    ],
  },
  movingHelp: {
    key: 'pv-moving-help',
    summary: '聊了搬家那天谁来帮忙',
    topics: ['搬家', '帮忙'],
    lines: [
      s('self', '搬家那天需要人帮忙吗'),
      s('a', '叫了搬家公司，你来搭把手就行'),
      s('self', '行，我早点过去'),
    ],
  },
  askCard: {
    key: 'pv-ask-card',
    summary: '问了体育馆年卡在哪儿办',
    topics: ['羽毛球', '年卡'],
    lines: [
      s('a', '昨天那场打得真过瘾'),
      s('self', '是啊，下周还约'),
      s('self', '对了，体育馆的年卡在哪儿办', 'open'),
      s('self', '想给我老公也办一张'),
    ],
  },
  pet: {
    key: 'pv-pet',
    summary: '聊了猫和宠物医院',
    topics: ['猫', '宠物医院'],
    lines: [
      s('a', '猫这两天不太吃东西'),
      s('self', '带去医院看看吧'),
      s('a', '明天就去，有点担心'),
      s('self', '有消息跟我说一声'),
    ],
  },
}
