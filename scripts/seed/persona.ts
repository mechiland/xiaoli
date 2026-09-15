// Coherent synthetic lives for seed persons (ARCHITECTURE §9). One persona per person: a timeline (school, jobs, homes,
// family, habits) from which every claim is derived, so a profile never holds two current jobs, two cities or two ages.
// Exclusive slots (job, home, school, drink/sport habit, car, relationship) change only through a chain: the old fact is
// said before the change date, the new one after it.
import type { Category } from '@/contracts'
import type { Rng } from './rng'

export type Gender = 'f' | 'm'
export type Stage = 'child' | 'student' | 'adult' | 'retired'
export interface YM {
  y: number
  m: number
}
const DAY = 86_400_000
export const ymStr = (v: YM) => `${v.y}-${String(v.m).padStart(2, '0')}`
const ymLt = (a: YM, b: YM) => a.y < b.y || (a.y === b.y && a.m < b.m)

/** Day arithmetic relative to the seed's "today"; windows are [older, newer] in days ago. */
export class Clock {
  readonly year: number
  readonly month: number
  private readonly base: number
  constructor(today: string) {
    const [y, m, d] = today.split('-').map(Number)
    this.year = y
    this.month = m
    this.base = Date.UTC(y, m - 1, d)
  }
  ago(y: number, m = 1, d = 1): number {
    return Math.round((this.base - Date.UTC(y, m - 1, d)) / DAY)
  }
  endAgo(v: YM): number {
    return Math.round((this.base - Date.UTC(v.y, v.m, 0)) / DAY)
  }
  at(daysAgo: number): YM {
    const t = new Date(this.base - daysAgo * DAY)
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 }
  }
  /** sent once the month has started */
  since(v: YM): [number, number] {
    return [Math.max(0, this.ago(v.y, v.m, 1) - 3), 0]
  }
  /** sent after the month ended (or after it started, for the current month) */
  after(v: YM): [number, number] {
    const e = this.endAgo(v)
    return [e > 2 ? e : Math.max(0, this.ago(v.y, v.m, 1) - 3), 0]
  }
  before(v: YM): [number, number] {
    return [99_999, this.ago(v.y, v.m, 1) + 2]
  }
  between(from: YM, to: YM): [number, number] {
    return [Math.max(0, this.ago(from.y, from.m, 1) - 3), this.ago(to.y, to.m, 1) + 2]
  }
  thisYear(): [number, number] {
    return [this.ago(this.year, 1, 1), 0]
  }
  /** the last completed school year (Sept → July) — grades are stated as of then */
  schoolYear(): { start: number; window: [number, number] } {
    const start = this.year - 1
    return { start, window: [this.ago(start, 9, 1) - 2, this.ago(start + 1, 7, 10)] }
  }
}

// ---------- vocabulary ----------

const DISTRICTS: Record<string, string[]> = {
  杭州: ['城西', '滨江', '萧山', '拱墅', '西湖区'],
  上海: ['徐汇', '浦东', '闵行', '静安', '杨浦'],
  苏州: ['工业园区', '姑苏区', '吴中'],
  南京: ['鼓楼', '江宁', '建邺'],
  长沙: ['岳麓', '雨花', '开福', '天心'],
  武汉: ['光谷', '汉口', '武昌'],
  成都: ['高新区', '武侯', '锦江'],
  北京: ['海淀', '朝阳', '通州'],
  深圳: ['南山', '福田', '宝安'],
  广州: ['天河', '海珠', '番禺'],
  西安: ['雁塔', '曲江', '高新区'],
  重庆: ['渝北', '南岸', '沙坪坝'],
  厦门: ['思明', '湖里'],
  青岛: ['市南', '崂山'],
  宁波: ['鄞州', '江北'],
  合肥: ['蜀山', '包河'],
}
export const WORK_CITIES = Object.keys(DISTRICTS)
export const HOMETOWNS = ['长沙', '株洲', '岳阳', '常德', '衡阳', '湘潭', '益阳', '邵阳', '南昌', '赣州', '宜昌', '襄阳', '洛阳', '安庆', '无锡', '扬州', '温州', '绍兴', '绵阳', '汉中', '潍坊', '泉州', '桂林', '苏州', '合肥']
export function districtOf(r: Rng, city: string, avoid?: string): string {
  const pool = (DISTRICTS[city] ?? ['城东', '城西', '新区', '老城区']).filter((d) => d !== avoid)
  return r.pick(pool)
}

export interface School {
  name: string
  city: string
}
const SCHOOL_TYPES: { suffix: string; majors: string[] }[] = [
  { suffix: '师范大学', majors: ['中文', '英语', '数学', '历史', '学前教育', '心理学', '新闻', '美术'] },
  { suffix: '理工大学', majors: ['计算机', '软件工程', '机械', '土木工程', '建筑学'] },
  { suffix: '财经大学', majors: ['会计', '金融', '市场营销', '国际贸易', '人力资源管理'] },
  { suffix: '医科大学', majors: ['临床医学', '护理', '药学'] },
  { suffix: '外国语学院', majors: ['英语', '国际贸易', '新闻'] },
  { suffix: '艺术学院', majors: ['视觉传达', '动画', '美术'] },
  { suffix: '政法大学', majors: ['法学'] },
]
const SCHOOL_CITIES = ['长沙', '武汉', '南京', '西安', '成都', '重庆', '合肥', '南昌', '郑州', '济南', '昆明', '大连']

interface Place {
  company: string
  roles: string[]
  senior: string
  projects: string[]
}
interface Field {
  places: Place[]
  certs: string[]
  overtime: boolean
  travel: boolean
  courses: string[]
}
const FIELDS: Record<string, Field> = {
  design: {
    places: [
      { company: '一家设计公司', roles: ['UI 设计师', '平面设计师'], senior: '设计总监', projects: ['一个 App 改版', '一个品牌升级'] },
      { company: '一家动画工作室', roles: ['原画师', '动画师'], senior: '美术总监', projects: ['一部动画短片', '一部动画番剧'] },
      { company: '一家广告公司', roles: ['美术设计'], senior: '美术指导', projects: ['一个汽车广告', '一个品牌年度广告'] },
    ],
    certs: [],
    overtime: true,
    travel: false,
    courses: ['三维建模', '插画'],
  },
  media: {
    places: [
      { company: '一家影视公司', roles: ['编导', '后期剪辑'], senior: '制片人', projects: ['一部纪录片', '一档访谈节目'] },
      { company: '一家出版社', roles: ['编辑'], senior: '编辑室主任', projects: ['一套儿童绘本', '一本新书的出版'] },
      { company: '一家新媒体公司', roles: ['内容运营', '视频编导'], senior: '内容主编', projects: ['一个美食账号', '一档短视频栏目'] },
    ],
    certs: [],
    overtime: true,
    travel: true,
    courses: ['摄影', '写作'],
  },
  teaching: {
    places: [
      { company: '一所中学', roles: ['{subject}'], senior: '年级组长', projects: ['初三毕业班', '一次公开课评比'] },
      { company: '一所小学', roles: ['{subject}'], senior: '教导主任', projects: ['学校的读书节', '一次公开课评比'] },
    ],
    certs: ['心理咨询师'],
    overtime: false,
    travel: false,
    courses: ['儿童心理学', '绘本阅读指导'],
  },
  kindergarten: {
    places: [
      { company: '一家公立幼儿园', roles: ['幼师'], senior: '园长助理', projects: ['幼儿园的六一汇演', '新学期的开学活动'] },
      { company: '一家私立幼儿园', roles: ['幼师'], senior: '教学主管', projects: ['幼儿园的六一汇演', '新学期的开学活动'] },
    ],
    certs: ['心理咨询师'],
    overtime: false,
    travel: false,
    courses: ['儿童心理学'],
  },
  tech: {
    places: [
      { company: '一家游戏公司', roles: ['前端工程师', '后端工程师', '游戏策划'], senior: '技术组长', projects: ['一款新游戏上线', '一次版本大更新'] },
      { company: '一家做软件的创业公司', roles: ['前端工程师', '产品经理', '测试工程师'], senior: '技术总监', projects: ['一个新系统上线', '一个 App 改版'] },
      { company: '一家做跨境电商的公司', roles: ['数据分析师', '后端工程师'], senior: '数据组长', projects: ['双十一大促', '推荐系统改版'] },
    ],
    certs: ['软考高级'],
    overtime: true,
    travel: false,
    courses: ['机器学习', '英语口语'],
  },
  finance: {
    places: [
      { company: '一家银行', roles: ['客户经理', '风控专员'], senior: '支行副行长', projects: ['年底冲业绩', '一次内部审计'] },
      { company: '一家会计师事务所', roles: ['审计', '税务顾问'], senior: '项目经理', projects: ['年底审计', '一家公司的上市审计'] },
      { company: '一家物流公司', roles: ['会计'], senior: '财务主管', projects: ['季度结账', '仓库搬迁的预算'] },
    ],
    certs: ['注册会计师', 'CFA'],
    overtime: true,
    travel: true,
    courses: ['税法', 'Excel 建模'],
  },
  medical: {
    places: [
      { company: '市第一医院', roles: ['{med}'], senior: '{medSenior}', projects: ['医院评级', '科室搬新楼'] },
      { company: '一家社区医院', roles: ['{med}'], senior: '{medSenior}', projects: ['社区义诊', '家庭医生签约'] },
    ],
    certs: ['{medCert}'],
    overtime: true,
    travel: false,
    courses: ['营养学'],
  },
  law: {
    places: [
      { company: '一家律师事务所', roles: ['律师助理', '律师'], senior: '合伙人', projects: ['一个合同纠纷案', '一家公司的并购项目'] },
      { company: '区法院', roles: ['书记员'], senior: '法官助理', projects: ['年底结案'] },
    ],
    certs: ['法律职业资格'],
    overtime: true,
    travel: true,
    courses: ['知识产权'],
  },
  engineering: {
    places: [
      { company: '一家建筑设计院', roles: ['结构工程师', '建筑师'], senior: '项目负责人', projects: ['一个商业综合体', '一所学校的新校区'] },
      { company: '一家新能源车企', roles: ['结构工程师', '测试工程师'], senior: '测试主管', projects: ['新车型测试', '一条新产线投产'] },
    ],
    certs: ['一级建造师', '注册结构工程师'],
    overtime: true,
    travel: true,
    courses: ['BIM 建模'],
  },
  business: {
    places: [
      { company: '一家做跨境电商的公司', roles: ['运营', '外贸业务员'], senior: '运营主管', projects: ['海外客户对接', '一个新站点上线'] },
      { company: '一家新能源车企', roles: ['销售顾问', '市场专员'], senior: '销售主管', projects: ['车展筹备', '新店开业'] },
      { company: '一家咖啡连锁', roles: ['店长'], senior: '区域经理', projects: ['新门店开业', '秋季新品上市'] },
    ],
    certs: ['人力资源管理师'],
    overtime: false,
    travel: true,
    courses: ['商务英语'],
  },
  hr: {
    places: [
      { company: '一家做软件的创业公司', roles: ['HR'], senior: 'HR 经理', projects: ['秋季校园招聘', '年终绩效考核'] },
      { company: '一家物流公司', roles: ['招聘专员'], senior: '人事主管', projects: ['年底招聘'] },
    ],
    certs: ['人力资源管理师', '心理咨询师'],
    overtime: false,
    travel: false,
    courses: ['心理咨询'],
  },
  factory: {
    places: [
      { company: '一家纺织厂', roles: ['挡车工'], senior: '车间主任', projects: [] },
      { company: '一家国营商场', roles: ['售货员'], senior: '柜组长', projects: [] },
      { company: '一家机械厂', roles: ['钳工'], senior: '车间主任', projects: [] },
      { company: '一家食品厂', roles: ['质检员'], senior: '质检科长', projects: [] },
    ],
    certs: [],
    overtime: false,
    travel: false,
    courses: ['用智能手机'],
  },
  trade: {
    places: [
      { company: '一家装修公司', roles: ['装修队长'], senior: '工程经理', projects: ['一套老房子翻新'] },
      { company: '一家理发店', roles: ['理发师'], senior: '店长', projects: ['店里的会员活动'] },
      { company: '一家连锁超市', roles: ['理货员'], senior: '店长', projects: ['中秋备货'] },
      { company: '一家汽修店', roles: ['汽修师傅'], senior: '店长', projects: ['年检高峰'] },
    ],
    certs: [],
    overtime: false,
    travel: false,
    courses: ['短视频剪辑'],
  },
}
const MAJOR_FIELDS: Record<string, string[]> = {
  中文: ['teaching', 'media', 'hr'],
  英语: ['teaching', 'business'],
  数学: ['teaching', 'tech', 'finance'],
  历史: ['teaching', 'media'],
  学前教育: ['kindergarten'],
  心理学: ['hr', 'teaching'],
  新闻: ['media', 'business'],
  广播电视编导: ['media'],
  美术: ['design', 'teaching'],
  计算机: ['tech'],
  软件工程: ['tech'],
  机械: ['engineering'],
  土木工程: ['engineering'],
  建筑学: ['engineering'],
  会计: ['finance'],
  金融: ['finance'],
  市场营销: ['business'],
  国际贸易: ['business'],
  人力资源管理: ['hr'],
  临床医学: ['medical'],
  护理: ['medical'],
  药学: ['medical'],
  视觉传达: ['design'],
  动画: ['design', 'media'],
  法学: ['law'],
}
const SUBJECT: Record<string, string> = { 中文: '语文老师', 英语: '英语老师', 数学: '数学老师', 历史: '历史老师', 心理学: '心理老师', 美术: '美术老师', 新闻: '语文老师', 广播电视编导: '语文老师' }
const MED: Record<string, [string, string, string]> = { 临床医学: ['内科医生', '主治医生', '主治医师'], 护理: ['护士', '护士长', '主管护师'], 药学: ['药剂师', '药剂科主任', '执业药师'] }
const OWN_SHOPS = ['面馆', '花店', '水果店', '烘焙店', '宠物店']

const FOODS = ['香菜', '葱', '内脏', '羊肉', '芹菜', '苦瓜', '海鲜', '辣']
const DRINKS = ['美式咖啡', '绿茶', '豆浆', '柠檬水', '普洱', '拿铁']
const PREV_DRINKS = ['奶茶', '冰可乐', '果汁']
const SPORTS = ['跑步', '游泳', '瑜伽', '健身', '骑行']
const WEEKEND = ['图书馆', '菜市场', '公园', '书店', '郊外', '商场']
const CUISINES = ['火锅', '湘菜', '粤菜', '日料', '本帮菜', '西北菜', '川菜', '杭帮菜']
const SPICY = new Set(['火锅', '湘菜', '川菜'])
const MUSIC = ['民谣', '爵士', '粤语老歌', '古典音乐', '摇滚', '电影原声']
const GENRES = ['悬疑小说', '纪录片', '历史书', '科幻小说', '综艺节目', '美食视频']
const TRIPS = ['日本', '云南', '新疆', '泰国', '冰岛', '西藏', '意大利', '川西', '海南', '青海湖', '新西兰', '敦煌', '桂林', '内蒙古草原']
const SKILLS = ['游泳', '日语', '开车', '咖啡拉花', '钢琴', '潜水', '剪辑视频', '尤克里里', '滑雪', '粤语']
const LANGS = ['日语', '粤语', '韩语', '一点法语', '西班牙语']
const CARS = ['白色的SUV', '电动车', '二手的小轿车', '灰色的新能源车']
const ALLERGENS = ['花粉', '芒果', '猫毛', '尘螨', '青霉素']
const PETS: [string, string][] = [['猫', '年糕'], ['狗', '豆豆'], ['猫', '芝麻'], ['柯基', '旺财'], ['兔子', '棉花'], ['金毛', '可乐'], ['乌龟', '慢慢'], ['猫', '汤圆']]
const CLUBS = ['话剧社', '学生会', '篮球队', '摄影协会', '吉他社', '辩论队', '志愿者协会']

/** hobby → [statement, first person, third person] */
const HOBBIES: Record<string, [string, string, string]> = {
  爬山: ['喜欢爬山', '周末有空就去爬山', '{name}周末有空就去爬山'],
  做饭: ['喜欢下厨做饭', '我最近迷上了做饭，周末都自己下厨', '{name}很喜欢下厨做饭'],
  拍照: ['喜欢拍照', '我喜欢拍照，出门一定背着相机', '{name}喜欢拍照，出门一定背着相机'],
  跑步: ['喜欢跑步', '我每天早上都去跑步', '{name}每天早上都去跑步'],
  钓鱼: ['喜欢钓鱼', '周末我一般去水库钓鱼', '{name}周末一般去水库钓鱼'],
  弹吉他: ['会弹吉他', '我弹吉他弹了好多年了', '{name}吉他弹得很好'],
  看话剧: ['喜欢看话剧', '我超爱看话剧，一个月去一次剧场', '{name}特别喜欢看话剧'],
  打羽毛球: ['喜欢打羽毛球', '我每周都要打羽毛球', '{name}每周都要打羽毛球'],
  养多肉: ['喜欢养多肉', '我阳台上养了一堆多肉', '{name}阳台上养了一堆多肉'],
  露营: ['喜欢露营', '天气好我就带帐篷出去露营', '{name}天气好就去露营'],
  下围棋: ['喜欢下围棋', '我从小学围棋，现在还常下', '{name}从小学围棋，现在还常下'],
  烘焙: ['喜欢烘焙', '我喜欢烘焙，周末在家烤面包', '{name}喜欢烘焙，周末在家烤面包'],
  骑行: ['喜欢骑行', '周末我常骑行绕湖一圈', '{name}周末常骑行绕湖一圈'],
  写书法: ['喜欢写书法', '我每天晚上练半小时书法', '{name}每天晚上练半小时书法'],
  玩桌游: ['喜欢玩桌游', '我们几个周五晚上固定玩桌游', '{name}周五晚上固定玩桌游'],
  做陶艺: ['喜欢做陶艺', '我周末去陶艺教室拉坯', '{name}周末去陶艺教室拉坯'],
  种花: ['喜欢种花', '我喜欢种花，阳台种满了月季', '{name}喜欢种花，阳台种满了月季'],
  打篮球: ['喜欢打篮球', '我下班常去打篮球', '{name}下班常去打篮球'],
  看电影: ['喜欢看电影', '新片上映我基本都去电影院看', '{name}新片上映基本都去电影院看'],
}
const RETIREE_HOBBIES: Record<string, [string, string, string]> = {
  跳广场舞: ['喜欢跳广场舞', '我每天晚饭后去跳广场舞', '{name}每天晚饭后去跳广场舞'],
  打太极: ['每天早上打太极', '我每天早上去公园打太极', '{name}每天早上去公园打太极'],
  下象棋: ['喜欢下象棋', '我天天在楼下跟老邻居下象棋', '{name}天天在楼下跟老邻居下象棋'],
  听戏: ['喜欢听越剧', '我没事就听越剧', '{name}没事就听越剧'],
  种菜: ['在阳台种菜', '我阳台上种了辣椒和小葱', '{name}阳台上种了辣椒和小葱'],
  写书法: ['喜欢写书法', '我每天练一个钟头书法', '{name}每天练一个钟头书法'],
}
const KID_HOBBIES: Record<string, [string, string, string]> = {
  画画: ['喜欢画画', '我最喜欢画画', '{name}最喜欢画画'],
  乐高: ['喜欢拼乐高', '我在拼一个乐高城堡', '{name}天天在拼乐高'],
  踢足球: ['喜欢踢足球', '我放学去踢足球', '{name}放学就去踢足球'],
  看动画片: ['喜欢看动画片', '我最喜欢看动画片', '{name}最喜欢看动画片'],
  跳绳: ['喜欢跳绳', '我喜欢跳绳，一分钟能跳一百五十个', '{name}喜欢跳绳，一分钟能跳一百五十个'],
  搭积木: ['喜欢搭积木', '我最喜欢搭积木，能搭一个大城堡', '{name}最喜欢搭积木'],
}

// ---------- persona ----------

export interface Job {
  city: string
  company: string
  role: string
  from: YM
  to?: YM
  /** shop name when self-employed */
  own?: string
  projects?: string[]
  certs?: string[]
  overtime?: boolean
  travel?: boolean
}
export interface Kid {
  gender: Gender
  birthYear: number
  personId?: number
}
type SecondaryChange = 'drink' | 'sport' | 'car' | 'relationship' | 'skill'
export interface Persona {
  id: number
  label: string
  gender: Gender
  birthYear: number
  stage: Stage
  hometown: string
  highSchoolCity: string
  city: string
  district: string
  since: YM
  prevHome?: { city: string; district: string; from: YM }
  ownsHome?: number
  school?: School & { major: string; grad: number; enroll: number }
  master?: School & { major: string; grad: number }
  field?: string
  jobs: Job[]
  retiredYear?: number
  jobChange?: 'job' | 'promotion'
  moveChange?: boolean
  spouse?: { year: number; personId?: number; label?: string; how: string; job: string }
  partner?: { dating: boolean; since?: YM }
  kids: Kid[]
  parents: { city: string; retired: boolean; personIds: number[]; alive: boolean }
  siblings: { term: string; city: string; personId?: number }[]
  pet?: { kind: string; name: string; since: number }
  allergy?: string
  hobbies: string[]
  dislikes: string[]
  drink: string
  prevDrink?: string
  sport?: { name: string; n: number }
  prevSport?: { name: string; n: number }
  weekend: string
  cuisine: string
  music: string
  genre: string
  earlyBird: boolean
  drinksAlcohol: boolean
  trips: { year: number; m: number; place: string }[]
  skill?: string
  lang?: string
  car?: string
  license?: number
  myopia?: number
  secondary?: SecondaryChange
  secondaryAt?: YM
  extras: { club?: string; inService?: number; side?: string; leftHanded?: boolean; donor?: boolean; volunteer?: boolean; commute: number; team?: number; nearby: string; grandparent?: { term: string; age: number }; grandkids?: string }
}

export interface PersonaSpec {
  id: number
  label: string
  gender: Gender
  birthYear: number
  stage?: Stage
  city?: string
  district?: string
  hometown?: string
  school?: School
  major?: string
  hobbies?: string[]
  married?: boolean
  marriedYear?: number
  kids?: Kid[]
  parentsCity?: string
  /** force the current job (from defaults to a plausible start) */
  job?: { company: string; role: string; city?: string; from?: YM; own?: string }
  /** earlier jobs, oldest first (replaces the generated history) */
  pastJobs?: Job[]
  jobChange?: 'job' | 'promotion' | null
  moveChange?: boolean | null
  secondary?: SecondaryChange | null
  since?: YM
  prevHome?: Persona['prevHome'] | null
  pet?: { kind: string; name: string; since?: number }
  noDegree?: boolean
  field?: string
}

function pickRole(r: Rng, place: Place, major: string, senior = false): string {
  const raw = senior ? place.senior : r.pick(place.roles)
  return raw
    .replace('{subject}', SUBJECT[major] ?? '语文老师')
    .replace('{medSenior}', MED[major]?.[1] ?? '主治医生')
    .replace('{med}', MED[major]?.[0] ?? '内科医生')
}
const MALE_TRADES = new Set(['一家装修公司', '一家汽修店', '一家机械厂'])
function jobAt(r: Rng, field: string, major: string, city: string, from: YM, avoid?: string, gender?: Gender): Job {
  const f = FIELDS[field]
  const places = f.places.filter((p) => p.company !== avoid && !(gender === 'f' && MALE_TRADES.has(p.company)))
  const place = r.pick(places.length ? places : f.places)
  return {
    city,
    company: place.company,
    role: pickRole(r, place, major),
    from,
    projects: place.projects,
    certs: f.certs.map((c) => c.replace('{medCert}', MED[major]?.[2] ?? '主治医师')),
    overtime: f.overtime,
    travel: f.travel,
  }
}
function placeOf(company: string): Place | undefined {
  for (const f of Object.values(FIELDS)) for (const p of f.places) if (p.company === company) return p
  return undefined
}

export function makePersona(r: Rng, clk: Clock, spec: PersonaSpec): Persona {
  const now = clk.year
  const age = now - spec.birthYear
  const stage: Stage = spec.stage ?? (spec.birthYear <= 1966 ? 'retired' : spec.birthYear >= 2008 ? 'child' : spec.birthYear >= 2004 ? 'student' : 'adult')
  const hometown = spec.hometown ?? r.pick(HOMETOWNS)
  const p: Persona = {
    id: spec.id,
    label: spec.label,
    gender: spec.gender,
    birthYear: spec.birthYear,
    stage,
    hometown,
    highSchoolCity: hometown,
    city: spec.city ?? (stage === 'retired' ? (r.chance(0.6) ? hometown : r.pick(WORK_CITIES)) : r.pick(WORK_CITIES)),
    district: '',
    since: { y: now - 3, m: 3 },
    jobs: [],
    kids: [],
    parents: { city: spec.parentsCity ?? hometown, retired: age >= 30, personIds: [], alive: age < 62 || r.chance(0.3) },
    siblings: [],
    hobbies: [],
    dislikes: [],
    drink: r.pick(DRINKS),
    weekend: r.pick(WEEKEND),
    cuisine: r.pick(CUISINES),
    music: r.pick(MUSIC),
    genre: r.pick(GENRES),
    earlyBird: stage === 'retired' || r.chance(0.4),
    drinksAlcohol: r.chance(0.4),
    trips: [],
    extras: { commute: r.pick([10, 15, 20, 30, 40, 50]), nearby: r.pick(['家离地铁站很近', '小区旁边有个大公园', '家楼下就是菜市场', '家附近有好几家咖啡店']) },
  }
  p.district = spec.district ?? districtOf(r, p.city)
  if (p.city === hometown && r.chance(0.7)) p.highSchoolCity = hometown

  if (stage === 'child') {
    p.since = { y: spec.birthYear, m: r.int(1, 12) }
    p.parents.retired = false
    p.parents.city = p.city
    const kidAge = now - spec.birthYear
    const hs = kidAge < 2 ? [] : kidAge < 4 ? ['看动画片', '搭积木'] : kidAge < 7 ? ['画画', '乐高', '看动画片'] : ['画画', '乐高', '踢足球', '跳绳']
    p.hobbies = r.sample(hs, r.int(1, 2))
    p.dislikes = r.chance(0.5) ? [r.pick(['香菜', '葱', '芹菜', '苦瓜'])] : []
    if (r.chance(0.2)) p.allergy = r.pick(['芒果', '花粉', '尘螨'])
    return p
  }

  // education
  const degree = !spec.noDegree && (spec.school ? true : stage === 'student' ? true : r.chance(age < 45 ? 0.85 : 0.45))
  if (degree) {
    const type = spec.major ? (SCHOOL_TYPES.find((t) => t.majors.includes(spec.major!)) ?? SCHOOL_TYPES[0]) : r.pick(SCHOOL_TYPES)
    const schoolCity = spec.school?.city ?? r.pick(SCHOOL_CITIES)
    const school = spec.school ?? { name: `${schoolCity}${type.suffix}`, city: schoolCity }
    const major = spec.major ?? r.pick(spec.school ? SCHOOL_TYPES[0].majors : type.majors)
    const enroll = spec.birthYear + 18
    p.school = { ...school, major, enroll, grad: enroll + 4 }
    if (stage === 'adult' && age >= 28 && !spec.school && r.chance(0.12)) {
      const mc = r.pick(SCHOOL_CITIES)
      p.master = { name: `${mc}${type.suffix}`, city: mc, major, grad: p.school.grad + 3 }
    }
  }
  const major = p.school?.major ?? ''
  const field = spec.field ?? (p.school ? r.pick(MAJOR_FIELDS[major] ?? ['business']) : stage === 'retired' ? 'factory' : 'trade')
  p.field = field

  // family basics
  const hobbyPool = stage === 'retired' ? Object.keys(RETIREE_HOBBIES) : Object.keys(HOBBIES)
  p.hobbies = [...new Set([...(spec.hobbies ?? []), ...r.sample(hobbyPool, r.int(2, 3))])].slice(0, 4)
  p.dislikes = r.sample(FOODS, r.int(1, 2))
  if (p.dislikes.includes('辣')) p.cuisine = r.pick(CUISINES.filter((c) => !SPICY.has(c)))
  const siblingCount = spec.birthYear < 1980 ? r.int(1, 3) : r.chance(0.45) ? 1 : 0
  for (let i = 0; i < siblingCount; i++) {
    const older = r.chance(0.5)
    const female = r.chance(0.5)
    const term = older ? (female ? '姐姐' : '哥哥') : female ? '妹妹' : '弟弟'
    if (p.siblings.some((s) => s.term === term)) continue
    p.siblings.push({ term, city: r.chance(0.5) ? hometown : r.pick(WORK_CITIES) })
  }
  if (r.chance(0.3) && stage !== 'retired') p.pet = { kind: r.pick(PETS)[0], name: '', since: 0 }
  if (spec.pet) p.pet = { kind: spec.pet.kind, name: spec.pet.name, since: spec.pet.since ?? now - r.int(1, 6) }
  else if (p.pet) {
    const pet = r.pick(PETS)
    p.pet = { kind: pet[0], name: pet[1], since: now - r.int(1, 8) }
  }
  if (r.chance(0.35)) p.allergy = r.pick(ALLERGENS.filter((a) => !(a === '猫毛' && p.pet?.kind === '猫')))
  if (r.chance(0.35)) p.lang = r.pick(LANGS)
  p.myopia = r.chance(0.55) ? r.pick([200, 300, 450, 500, 600, 800]) : undefined

  if (stage === 'student') {
    const s = p.school!
    p.city = spec.city ?? s.city
    p.district = spec.district ?? districtOf(r, p.city)
    p.since = { y: s.enroll, m: 9 }
    p.parents.retired = false
    p.skill = r.pick(SKILLS.filter((k) => !p.hobbies.includes(k) && k !== p.lang))
    p.trips = [{ year: now - 1, m: r.pick([1, 2, 7, 8]), place: r.pick(TRIPS) }]
    p.extras.club = r.pick(CLUBS)
    if (r.chance(0.4)) p.secondary = 'skill'
    p.secondaryAt = clk.at(r.int(90, 330))
    return p
  }

  // jobs
  const startY = p.master?.grad ?? p.school?.grad ?? spec.birthYear + 20
  const endY = stage === 'retired' ? (p.retiredYear = Math.min(now - 1, spec.birthYear + (spec.gender === 'f' ? 55 : 60))) : now
  if (stage === 'retired') {
    const j = jobAt(r, field, major, p.city, { y: startY, m: 7 }, undefined, spec.gender)
    j.to = { y: endY, m: r.int(1, 12) }
    p.jobs = [j]
    p.since = { y: r.int(1995, 2012), m: r.int(1, 12) }
    p.parents.alive = false
  } else {
    const jobChange = spec.jobChange !== undefined ? spec.jobChange : r.chance(0.36) ? 'job' : r.chance(0.22) ? 'promotion' : null
    const at = clk.at(r.int(110, 420))
    const years = now - startY
    const early = spec.pastJobs ? 0 : years >= 9 ? r.int(0, 2) : years >= 4 ? r.int(0, 1) : 0
    const bounds: YM[] = []
    for (let k = 1; k <= early; k++) {
      const y = Math.min(startY + Math.round((years * k) / (early + 1)), (jobChange ? at.y : now) - 2)
      if (y > startY && (!bounds.length || y > bounds[bounds.length - 1].y)) bounds.push({ y, m: r.int(2, 11) })
    }
    const recent = jobChange && startY <= at.y - 2 ? at : null
    p.jobChange = recent ? jobChange! : undefined
    const cityChange = recent && jobChange === 'job' && !spec.city ? r.chance(0.3) : bounds.length > 0 && r.chance(0.4)
    const changeAt = cityChange ? (recent && jobChange === 'job' ? recent : bounds[bounds.length - 1]) : null
    const prevCity = changeAt ? r.pick(WORK_CITIES.filter((c) => c !== p.city)) : p.city
    const starts = [{ y: startY, m: 7 }, ...bounds, ...(recent ? [recent] : [])]
    if (spec.pastJobs) {
      p.jobs = spec.pastJobs.map((j) => ({ ...j }))
    } else {
      starts.forEach((from, i) => {
        const city = changeAt && ymLt(from, changeAt) ? prevCity : p.city
        const prev = p.jobs[i - 1]
        let job: Job
        if (prev && i === starts.length - 1 && recent && jobChange === 'promotion') {
          const place = placeOf(prev.company)
          job = { ...prev, from, to: undefined, role: place ? pickRole(r, place, major, true) : prev.role }
          if (job.role === prev.role) job.role = `${prev.role}组长`
        } else job = jobAt(r, field, major, city, from, prev?.company, spec.gender)
        if (prev) prev.to = from
        p.jobs.push(job)
      })
      if (field === 'trade' && r.chance(0.35)) {
        const last = p.jobs[p.jobs.length - 1]
        const shop = r.pick(OWN_SHOPS)
        Object.assign(last, { company: `自己开的${shop}`, role: '老板', own: shop, projects: [], certs: [], overtime: false, travel: false })
      }
    }
    if (spec.job) {
      const last = p.jobs[p.jobs.length - 1]
      const from = spec.job.from ?? last?.from ?? { y: startY, m: 7 }
      if (last && !spec.pastJobs) {
        last.company = spec.job.company
        last.role = spec.job.role
        last.city = spec.job.city ?? p.city
        last.own = spec.job.own
        last.from = from
      } else {
        const prev = p.jobs[p.jobs.length - 1]
        if (prev && !prev.to) prev.to = from
        const place = placeOf(spec.job.company)
        p.jobs.push({ city: spec.job.city ?? p.city, company: spec.job.company, role: spec.job.role, from, own: spec.job.own, projects: place?.projects ?? [], certs: FIELDS[field]?.certs ?? [], overtime: FIELDS[field]?.overtime, travel: FIELDS[field]?.travel })
      }
    }
    // homes
    const lastCityChange = [...p.jobs].reverse().find((j, i, arr) => arr[i + 1] && arr[i + 1].city !== j.city)
    const firstInCity = p.jobs.find((j) => j.city === p.city && (!lastCityChange || !ymLt(j.from, lastCityChange.from)))
    if (spec.since) p.since = spec.since
    else if (p.jobs.some((j) => j.city !== p.city)) {
      const move = [...p.jobs].reverse().find((j, i, arr) => j.city === p.city && arr[i + 1] && arr[i + 1].city !== p.city)
      p.since = move?.from ?? firstInCity?.from ?? { y: startY, m: 7 }
      const prevJob = p.jobs.filter((j) => j.city !== p.city).pop()!
      p.prevHome = { city: prevJob.city, district: districtOf(r, prevJob.city), from: prevJob.from }
    } else {
      const moveChange = spec.moveChange !== undefined ? spec.moveChange : r.chance(0.3)
      if (moveChange) {
        const mAt = clk.at(r.int(100, 400))
        p.since = mAt
        p.prevHome = { city: p.city, district: districtOf(r, p.city, p.district), from: { y: Math.max(startY, mAt.y - r.int(2, 6)), m: r.int(1, 12) } }
        p.moveChange = true
      } else p.since = { y: r.int(Math.min(startY + 1, now - 2), now - 2), m: r.int(1, 12) }
    }
    if (spec.prevHome !== undefined) p.prevHome = spec.prevHome ?? undefined
    if (spec.moveChange) p.moveChange = true
    p.moveChange = p.moveChange || Boolean(p.prevHome && p.since.y >= clk.at(430).y && clk.ago(p.since.y, p.since.m) < 430 && clk.ago(p.since.y, p.since.m) > 80)
  }

  // marriage & kids
  const marryChance = age < 26 ? 0 : age < 30 ? 0.4 : age < 36 ? 0.7 : 0.88
  const married = spec.married ?? r.chance(marryChance)
  if (married) {
    const year = spec.marriedYear ?? Math.min(now - 1, spec.birthYear + r.int(25, Math.max(25, Math.min(34, age - 1))))
    const how = p.school && p.school.grad >= year - 8 && r.chance(0.3) ? '大学同学' : r.pick(['朋友介绍', '同事', '相亲'])
    p.spouse = { year, how, job: '' }
    if (spec.kids) p.kids = spec.kids
    else {
      const n = stage === 'retired' ? r.int(1, 2) : r.chance(0.7) ? (r.chance(0.25) ? 2 : 1) : 0
      let by = year + r.int(1, 3)
      for (let i = 0; i < n && by <= now; i++) {
        p.kids.push({ gender: r.chance(0.5) ? 'f' : 'm', birthYear: by })
        by += r.int(2, 5)
      }
    }
    if (age >= 30 && (stage === 'retired' || r.chance(0.65))) p.ownsHome = Math.min(now - 1, Math.max(p.since.y, year))
  } else {
    if (spec.kids) p.kids = spec.kids
    if (stage === 'adult' && age >= 23) p.partner = { dating: r.chance(0.35) }
  }
  if (stage === 'adult' && age >= 23 && r.chance(0.15)) p.extras.grandparent = { term: r.pick(['奶奶', '外婆']), age: r.int(86, 95) }

  // habits & extras
  if (stage === 'retired') {
    p.drink = '茶'
    p.trips = r.sample(TRIPS, r.int(1, 2)).map((place, i) => ({ year: now - 1 - i * r.int(1, 3), m: r.int(3, 11), place }))
    if (r.chance(0.4)) p.extras.volunteer = true
    if (r.chance(0.35)) {
      p.secondary = 'skill'
      p.skill = r.pick(['用智能手机拍视频', '弹电子琴', '画国画'])
      p.secondaryAt = clk.at(r.int(100, 380))
    }
    return p
  }
  p.sport = r.chance(0.7) ? { name: r.pick(SPORTS.filter((s) => !p.hobbies.includes(s))), n: r.int(1, 4) } : undefined
  p.trips = r
    .sample(TRIPS, r.int(2, 3))
    .map((place) => ({ place, year: r.int(Math.max(startY, now - 8), now - 1), m: r.int(1, 12) }))
    .filter((t, i, arr) => arr.findIndex((x) => x.year === t.year) === i)
  if (r.chance(0.6)) p.license = r.int(Math.max(spec.birthYear + 18, now - 15), now - 1)
  if (p.license && r.chance(0.6)) p.car = r.pick(CARS)
  const skillPool = SKILLS.filter((k) => !p.hobbies.includes(k) && k !== p.sport?.name && k !== p.lang && !(k === '开车' && p.license))
  p.skill = r.chance(0.6) ? r.pick(skillPool) : undefined
  p.extras.club = p.school && r.chance(0.5) ? r.pick(CLUBS) : undefined
  p.extras.inService = p.school && age < 45 && !p.master && r.chance(0.1) ? r.pick([now - 2, now - 1]) : undefined
  p.extras.side = r.chance(0.1) ? r.pick(['在夜市摆摊卖咖啡', '做美食博主', '接一些翻译的私活']) : undefined
  p.extras.leftHanded = r.chance(0.07)
  p.extras.donor = r.chance(0.12)
  p.extras.volunteer = r.chance(0.08)
  p.extras.team = age >= 33 && !p.jobs.at(-1)?.own && !['teaching', 'kindergarten', 'medical', 'trade'].includes(field) ? r.int(3, 12) : undefined

  const secondary = spec.secondary !== undefined ? spec.secondary : r.chance(0.8) ? r.pick<SecondaryChange>(['drink', 'sport', 'car', 'relationship', 'skill']) : null
  const sAt = clk.at(r.int(90, 400))
  if (secondary === 'drink') {
    p.prevDrink = r.pick(PREV_DRINKS)
    p.secondary = 'drink'
  } else if (secondary === 'sport' && p.sport) {
    p.prevSport = { name: r.pick(SPORTS.filter((s) => s !== p.sport!.name && !p.hobbies.includes(s))), n: r.int(1, 4) }
    p.secondary = 'sport'
  } else if (secondary === 'car' && !p.car && !(p.skill === '开车')) {
    p.car = r.pick(CARS)
    p.license = p.license ?? r.int(Math.max(spec.birthYear + 18, now - 12), now - 2)
    p.secondary = 'car'
  } else if (secondary === 'relationship' && p.partner && !p.partner.dating) {
    p.partner = { dating: true, since: sAt }
    p.secondary = 'relationship'
  } else if (secondary === 'skill' && p.skill) p.secondary = 'skill'
  if (p.secondary) p.secondaryAt = sAt
  return p
}

/** "杭州的一家建筑设计院做建筑师" — how a spouse would describe this person's job. */
export function jobPhrase(p: Persona): string {
  if (p.stage === 'retired') return '已经退休了'
  if (p.stage === 'student') return `在${p.school?.name}读书`
  const j = p.jobs.at(-1)
  if (!j) return '在家带孩子'
  return j.own ? `在${j.city}开了一家${j.own}` : `在${j.city}的${j.company}做${j.role}`
}
export function currentJob(p: Persona): Job | undefined {
  return p.stage === 'adult' ? p.jobs.at(-1) : undefined
}

// ---------- facts ----------

export interface Fact {
  key: string
  category: Category
  statement: string
  first: string
  third: string
  validFrom?: string
  validTo?: string
  /** message must be sent within [older, newer] days ago */
  window?: [number, number]
  /** persons the statement is about besides the subject (never used as the speaker) */
  mentionIds?: number[]
  /** question self asks before a first-person answer in a private chat */
  q?: string
  /** 0 core, 1 normal, 2 minor */
  tier: number
}
export interface Chain {
  key: string
  old: Fact
  cur: Fact
}

const kidTerm = (k: Kid, kids: Kid[]) => {
  const same = kids.filter((x) => x.gender === k.gender)
  const base = k.gender === 'f' ? '女儿' : '儿子'
  if (same.length < 2) return base
  return same[0] === k ? `大${base}` : `小${base}`
}
export function gradeName(ageAtSept: number): string | null {
  const G = ['幼儿园小班', '幼儿园中班', '幼儿园大班', '小学一年级', '小学二年级', '小学三年级', '小学四年级', '小学五年级', '小学六年级', '初一', '初二', '初三', '高一', '高二', '高三', '大一', '大二', '大三', '大四']
  const i = ageAtSept - 3
  return i >= 0 && i < G.length ? G[i] : null
}
const cn = (n: number) => (n <= 10 ? ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'][n] : String(n))

function jobCurrent(j: Job, key: string, clk: Clock, tier = 0): Fact {
  const statement = j.own ? `在${j.city}开了一家${j.own}` : `在${j.city}的${j.company}做${j.role}`
  const first = j.own ? `我在${j.city}开了家${j.own}，有空来坐坐` : `我现在在${j.city}的${j.company}做${j.role}`
  return { key, category: 'work', statement, first, third: `{name}现在${statement}`, validFrom: ymStr(j.from), window: clk.since(j.from), q: '现在在哪儿上班？', tier }
}
function jobPast(j: Job, key: string, clk: Clock): Fact {
  const to = j.to!
  const span = to.y === j.from.y ? `${j.from.y}年` : `${j.from.y}年到${to.y}年`
  const what = j.own ? `开过一家${j.own}` : `在${j.city}的${j.company}做${j.role}`
  const statement = `${span}${what}`
  return { key, category: 'work', statement, first: `我${span}${j.own ? '在' + j.city + '开过一家' + j.own : what}`, third: `{name}${statement}`, validFrom: String(j.from.y), validTo: String(to.y), window: clk.after(to), tier: 1 }
}
function homeFact(city: string, district: string, from: YM, key: string, clk: Clock, tier = 0): Fact {
  const statement = `住在${city}${district}`
  return { key, category: 'location', statement, first: `我现在住${city}${district}那边`, third: `{name}现在住在${city}${district}`, validFrom: ymStr(from), window: clk.since(from), q: '你现在住哪边？', tier }
}

/** Every fact this persona supports, plus chains (old → current) for exclusive slots that changed recently. */
export function factsOf(p: Persona, clk: Clock): { facts: Fact[]; chains: Chain[] } {
  const F: Fact[] = []
  const chains: Chain[] = []
  const now = clk.year
  const add = (f: Fact) => F.push(f)
  const sy = clk.schoolYear()

  if (p.stage === 'child') {
    const ageSept = sy.start - p.birthYear
    const grade = gradeName(ageSept)
    if (grade) add({ key: 'E.grade', category: 'education', statement: `在读${grade}`, first: `我在读${grade}`, third: `{name}在读${grade}`, window: sy.window, tier: 0 })
    add({ key: 'O.age', category: 'other', statement: `今年${now - p.birthYear}岁`, first: `我今年${now - p.birthYear}岁了`, third: `{name}今年${now - p.birthYear}岁了`, window: clk.thisYear(), tier: 0 })
    add({ key: 'L.home', category: 'location', statement: `跟爸妈住在${p.city}`, first: `我跟爸爸妈妈住在${p.city}`, third: `{name}跟爸妈住在${p.city}`, mentionIds: p.parents.personIds, tier: 1 })
    for (const h of p.hobbies) {
      const [s, f1, t] = KID_HOBBIES[h]
      add({ key: `P.hobby.${h}`, category: 'preference', statement: s, first: f1, third: t, tier: 1 })
    }
    for (const d of p.dislikes) add({ key: `P.dislike.${d}`, category: 'preference', statement: `不吃${d}`, first: `我不吃${d}`, third: `{name}不吃${d}`, tier: 2 })
    if (p.allergy) add({ key: 'O.allergy', category: 'other', statement: `对${p.allergy}过敏`, first: `我对${p.allergy}过敏`, third: `{name}对${p.allergy}过敏`, tier: 1 })
    if (ageSept >= 5) add({ key: 'E.class', category: 'education', statement: '周末在上游泳课', first: '我周末去上游泳课', third: '{name}周末在上游泳课', window: sy.window, tier: 2 })
    return { facts: F, chains }
  }

  // ----- work -----
  if (p.stage === 'student') {
    const s = p.school!
    const year = sy.start - s.enroll + 1
    add({ key: 'E.school', category: 'education', statement: `在${s.name}读${s.major}`, first: `我在${s.name}读${s.major}`, third: `{name}在${s.name}读${s.major}`, validFrom: `${s.enroll}-09`, window: clk.since({ y: s.enroll, m: 9 }), q: '你在哪儿读书？', tier: 0 })
    const ord = ['一', '二', '三', '四']
    if (year >= 1 && year <= 4) add({ key: 'E.year', category: 'education', statement: `读大${ord[year - 1]}`, first: `我今年大${ord[year - 1]}`, third: `{name}今年大${ord[year - 1]}`, window: sy.window, tier: 1 })
    add({ key: 'L.dorm', category: 'location', statement: '住在学校宿舍', first: '我平时住学校宿舍', third: '{name}平时住学校宿舍', tier: 1 })
    add({ key: 'W.parttime', category: 'work', statement: '周末在一家奶茶店兼职', first: '我周末在一家奶茶店兼职', third: '{name}周末在一家奶茶店兼职', window: [300, 0], tier: 1 })
    if (year >= 3) add({ key: 'W.intern', category: 'work', statement: `暑假在${s.city}一家公司实习`, first: `我暑假在${s.city}一家公司实习`, third: `{name}暑假在${s.city}一家公司实习`, window: clk.after({ y: now - 1, m: 8 }), tier: 1 })
    add({ key: 'LE.enroll', category: 'life_event', statement: `${s.enroll}年考上大学`, first: `我是${s.enroll}年考上大学的`, third: `{name}是${s.enroll}年考上大学的`, validFrom: String(s.enroll), window: clk.after({ y: s.enroll, m: 9 }), tier: 1 })
    if (p.extras.club) add({ key: 'E.club', category: 'education', statement: `参加了学校的${p.extras.club}`, first: `我参加了学校的${p.extras.club}`, third: `{name}参加了学校的${p.extras.club}`, tier: 2 })
  } else if (p.stage === 'retired') {
    const j = p.jobs[0]
    const what = j.own ? `开${j.own}` : `在${j.city}的${j.company}做${j.role}`
    add({ key: 'W.retired', category: 'work', statement: '已经退休了', first: '我已经退休好几年了', third: '{name}已经退休了', validFrom: String(p.retiredYear), window: clk.after({ y: p.retiredYear!, m: 12 }), tier: 0 })
    add({ key: 'W.past0', category: 'work', statement: `退休前${what}`, first: `我退休前${what}`, third: `{name}退休前${what}`, validTo: String(p.retiredYear), tier: 0 })
    add({ key: 'LE.retire', category: 'life_event', statement: `${p.retiredYear}年退休`, first: `我是${p.retiredYear}年退的休`, third: `{name}是${p.retiredYear}年退的休`, validFrom: String(p.retiredYear), window: clk.after({ y: p.retiredYear!, m: 12 }), tier: 1 })
    if (p.extras.volunteer) add({ key: 'W.volunteer', category: 'work', statement: '退休后在社区当志愿者', first: '我退休以后在社区当志愿者', third: '{name}退休后在社区当志愿者', tier: 1 })
  } else {
    const cur = p.jobs.at(-1)!
    const curFact = jobCurrent(cur, 'W.job', clk)
    add(curFact)
    p.jobs.slice(0, -1).forEach((j, i) => add(jobPast(j, `W.past${i}`, clk)))
    if (p.jobChange && p.jobs.length >= 2) {
      const prev = p.jobs.at(-2)!
      const old = jobCurrent({ ...prev, to: undefined }, `W.past${p.jobs.length - 2}`, clk)
      old.window = clk.between(prev.from, cur.from)
      chains.push({ key: 'C.job', old, cur: curFact })
      if (p.jobChange === 'job') {
        curFact.first = cur.own ? curFact.first : `我换工作了，现在在${cur.city}的${cur.company}做${cur.role}`
      } else curFact.first = `我升职了，现在在${cur.company}做${cur.role}`
    }
    const sameRole = p.jobs.filter((j) => j.role === cur.role)
    const years = now - sameRole[0].from.y
    if (years >= 2) {
      const what = cur.own ? `${cur.own}开了${years}年了` : `做${cur.role}${years}年了`
      add({ key: 'W.tenure', category: 'work', statement: what, first: cur.own ? `我这家${cur.own}开了${years}年了` : `我做${cur.role}都${years}年了`, third: cur.own ? `{name}的${cur.own}开了${years}年了` : `{name}做${cur.role}都${years}年了`, window: clk.thisYear(), tier: 1 })
    }
    const projects = cur.projects ?? []
    if (projects.length) {
      const pr = projects[p.id % projects.length]
      add({ key: 'W.project', category: 'work', statement: `最近在负责${pr}`, first: cur.overtime ? `最近在忙${pr}，天天加班` : `最近在负责${pr}，有点忙`, third: `{name}最近在负责${pr}`, window: [200, 0], tier: 1 })
    }
    const certs = cur.certs ?? []
    if (certs.length && p.birthYear > 1975) {
      const c = certs[p.id % certs.length]
      add({ key: 'W.cert', category: 'work', statement: `在准备${c}考试`, first: `我在准备${c}考试，头大`, third: `{name}在准备${c}考试`, window: [240, 0], tier: 2 })
    }
    if (!cur.own) add({ key: 'W.commute', category: 'work', statement: `上班通勤${p.extras.commute}分钟`, first: `我每天上班路上要${p.extras.commute}分钟`, third: `{name}每天上班路上要${p.extras.commute}分钟`, tier: 2 })
    if (p.extras.team) add({ key: 'W.team', category: 'work', statement: `带着一个${p.extras.team}人的团队`, first: `我现在手下带着${p.extras.team}个人`, third: `{name}现在手下带着${p.extras.team}个人`, tier: 2 })
    add(cur.overtime ? { key: 'W.hours', category: 'work', statement: '工作经常加班', first: '我们这行加班是常态', third: '{name}工作经常加班', tier: 2 } : { key: 'W.hours', category: 'work', statement: '工作时间比较规律', first: '我工作时间比较规律，基本不加班', third: '{name}工作时间比较规律，基本不加班', tier: 2 })
    if (cur.travel) {
      const c = WORK_CITIES.filter((x) => x !== cur.city)[p.id % (WORK_CITIES.length - 1)]
      add({ key: 'W.travel', category: 'work', statement: `经常出差去${c}`, first: `我这阵子老往${c}出差`, third: `{name}经常出差去${c}`, window: [300, 0], tier: 2 })
    }
    if (p.extras.side) add({ key: 'W.side', category: 'work', statement: `业余时间${p.extras.side}`, first: `我业余时间${p.extras.side}`, third: `{name}业余时间${p.extras.side}`, tier: 2 })
    if (p.field && FIELDS[p.field]) {
      const course = FIELDS[p.field].courses[p.id % FIELDS[p.field].courses.length]
      add({ key: 'E.course', category: 'education', statement: `在上${course}的网课`, first: `最近下班在上${course}的网课`, third: `{name}最近在上${course}的网课`, window: [240, 0], tier: 2 })
    }
  }

  // ----- location -----
  if (p.stage !== 'student') {
    const home = homeFact(p.city, p.district, p.since, 'L.home', clk)
    add(home)
    if (p.prevHome) {
      const ph = p.prevHome
      if (p.moveChange || (p.jobChange === 'job' && ph.city !== p.city && clk.ago(p.since.y, p.since.m) < 430)) {
        const old = homeFact(ph.city, ph.district, ph.from, 'L.prev', clk)
        old.window = clk.between(ph.from, p.since)
        chains.push({ key: 'C.home', old, cur: home })
        home.first = ph.city === p.city ? `我搬家了，现在住${p.city}${p.district}` : `我搬到${p.city}了，住${p.district}那边`
      } else if (ph.city !== p.city) {
        add({ key: 'L.prev', category: 'location', statement: `${ph.from.y}年到${p.since.y}年住在${ph.city}`, first: `我${ph.from.y}年到${p.since.y}年一直住在${ph.city}`, third: `{name}${ph.from.y}年到${p.since.y}年住在${ph.city}`, validFrom: String(ph.from.y), validTo: String(p.since.y), tier: 1 })
      }
      if (ph.city !== p.city) add({ key: 'LE.move', category: 'life_event', statement: `${p.since.y}年搬到${p.city}`, first: `我是${p.since.y}年搬到${p.city}的`, third: `{name}是${p.since.y}年搬到${p.city}的`, validFrom: String(p.since.y), window: clk.after(p.since), tier: 1 })
    }
  }
  if (p.hometown !== p.city) add({ key: 'L.hometown', category: 'location', statement: `老家在${p.hometown}`, first: `我老家是${p.hometown}的`, third: `{name}老家是${p.hometown}的`, q: '你老家哪儿的？', tier: 0 })
  else add({ key: 'L.hometown', category: 'location', statement: `从小在${p.city}长大`, first: `我是土生土长的${p.city}人`, third: `{name}是土生土长的${p.city}人`, tier: 0 })
  if (p.stage === 'adult' || p.stage === 'retired') {
    if (p.ownsHome) add({ key: 'L.house', category: 'location', statement: `在${p.city}买了房`, first: `我们${p.ownsHome}年在${p.city}买的房`, third: `{name}家${p.ownsHome}年在${p.city}买了房`, validFrom: String(p.ownsHome), window: clk.after({ y: p.ownsHome, m: 12 }), tier: 1 })
    else if (p.stage === 'adult') add({ key: 'L.house', category: 'location', statement: `在${p.city}租房住`, first: `我在${p.city}一直是租房住`, third: `{name}在${p.city}是租房住`, tier: 1 })
    add({ key: 'L.nearby', category: 'location', statement: p.extras.nearby, first: `我${p.extras.nearby}，挺方便的`, third: `{name}${p.extras.nearby}`, tier: 2 })
    if (p.hometown !== p.city && p.stage === 'adult') add({ key: 'L.newyear', category: 'location', statement: `每年春节回${p.hometown}过年`, first: `我每年春节都回${p.hometown}过年`, third: `{name}每年春节都回${p.hometown}过年`, tier: 2 })
  } else if (p.hometown !== p.city) add({ key: 'L.newyear', category: 'location', statement: `寒暑假回${p.hometown}`, first: `我寒暑假都回${p.hometown}`, third: `{name}寒暑假都回${p.hometown}`, tier: 2 })

  // ----- education -----
  if (p.school && p.stage !== 'student') {
    const s = p.school
    add({ key: 'E.degree', category: 'education', statement: `${s.name}${s.major}专业毕业`, first: `我是${s.name}${s.major}专业毕业的`, third: `{name}是${s.name}${s.major}专业毕业的`, validFrom: String(s.grad), window: clk.after({ y: s.grad, m: 6 }), q: '你当年学的什么专业？', tier: 0 })
    add({ key: 'LE.grad', category: 'life_event', statement: `${s.grad}年大学毕业`, first: `我是${s.grad}年大学毕业的`, third: `{name}是${s.grad}年大学毕业的`, validFrom: String(s.grad), window: clk.after({ y: s.grad, m: 6 }), tier: 1 })
    if (p.extras.club) add({ key: 'E.club', category: 'education', statement: `大学时参加过${p.extras.club}`, first: `我大学的时候在${p.extras.club}待了三年`, third: `{name}大学时在${p.extras.club}待了三年`, tier: 2 })
    if (p.birthYear > 1978) add({ key: 'E.cet', category: 'education', statement: '大学英语过了六级', first: '我大学英语过了六级', third: '{name}大学英语过了六级', tier: 2 })
  }
  if (p.master) add({ key: 'E.master', category: 'education', statement: `${p.master.name}${p.master.major}硕士毕业`, first: `我硕士是在${p.master.name}读的${p.master.major}`, third: `{name}硕士是在${p.master.name}读的${p.master.major}`, validFrom: String(p.master.grad), window: clk.after({ y: p.master.grad, m: 6 }), tier: 1 })
  if (p.extras.inService) add({ key: 'E.inservice', category: 'education', statement: `在读${p.school!.major}的在职研究生`, first: `我在读${p.school!.major}的在职研究生，周末上课`, third: `{name}在读${p.school!.major}的在职研究生`, validFrom: `${p.extras.inService}-09`, window: clk.since({ y: p.extras.inService, m: 9 }), tier: 1 })
  if (p.stage !== 'retired') add({ key: 'E.high', category: 'education', statement: `高中在${p.highSchoolCity}读的`, first: `我高中是在${p.highSchoolCity}读的`, third: `{name}高中是在${p.highSchoolCity}读的`, tier: 1 })
  else add({ key: 'E.senior', category: 'education', statement: '在老年大学学国画', first: '我在老年大学报了国画班', third: '{name}在老年大学报了国画班', window: [400, 0], tier: 1 })

  // ----- family -----
  const spouseTerm = p.stage === 'retired' ? '老伴' : p.gender === 'f' ? '老公' : '老婆'
  if (p.spouse) {
    const sp = p.spouse
    const mention = sp.personId !== undefined ? [sp.personId] : []
    if (sp.job) add({ key: 'F.spouse', category: 'family', statement: `${spouseTerm}${sp.job}`, first: `我${spouseTerm}${sp.job}`, third: `{name}的${spouseTerm}${sp.job}`, mentionIds: mention, tier: 0 })
    const how = sp.how === '大学同学' ? `和${spouseTerm}是大学同学` : sp.how === '同事' ? `和${spouseTerm}是在公司认识的` : `和${spouseTerm}是${sp.how}认识的`
    add({ key: 'F.met', category: 'family', statement: how, first: `我${how.replace(/^和/, '跟')}`, third: `{name}${how}`, mentionIds: mention, tier: 2 })
    add({ key: 'LE.marry', category: 'life_event', statement: `${sp.year}年结婚`, first: `我们是${sp.year}年结的婚`, third: `{name}是${sp.year}年结的婚`, validFrom: String(sp.year), window: clk.after({ y: sp.year, m: 12 }), mentionIds: mention, tier: 1 })
    if (!p.kids.length && p.stage === 'adult') add({ key: 'F.nokid', category: 'family', statement: '还没有要孩子', first: '我们暂时还没打算要孩子', third: '{name}两口子暂时还没打算要孩子', tier: 2 })
  } else if (p.partner) {
    const bf = p.gender === 'f' ? '男朋友' : '女朋友'
    const cur: Fact = p.partner.dating
      ? { key: 'F.rel', category: 'family', statement: `有${bf}了`, first: `我有${bf}了，是朋友介绍的`, third: `{name}有${bf}了`, validFrom: p.partner.since ? ymStr(p.partner.since) : undefined, window: p.partner.since ? clk.since(p.partner.since) : undefined, tier: 1 }
      : { key: 'F.rel', category: 'family', statement: '目前单身', first: '我现在还是单身，别催了', third: '{name}现在还是单身', tier: 1 }
    add(cur)
    if (p.secondary === 'relationship' && p.partner.since) chains.push({ key: 'C.rel', cur, old: { key: 'F.rel0', category: 'family', statement: '目前单身', first: '我现在还是单身，别催了', third: '{name}现在还是单身', window: clk.before(p.partner.since), tier: 1 } })
  }
  p.kids.forEach((k, i) => {
    const term = kidTerm(k, p.kids)
    const mention = k.personId !== undefined ? [k.personId] : []
    const age = now - k.birthYear
    if (age <= 22) add({ key: `F.kidAge${i}`, category: 'family', statement: `${term}今年${age}岁`, first: `我${term}今年${age}岁了`, third: `{name}的${term}今年${age}岁了`, window: clk.thisYear(), mentionIds: mention, q: '孩子多大啦？', tier: 0 })
    const grade = gradeName(sy.start - k.birthYear)
    if (grade) add({ key: `F.kidGrade${i}`, category: 'family', statement: `${term}在读${grade}`, first: `我${term}在读${grade}`, third: `{name}的${term}在读${grade}`, window: sy.window, mentionIds: mention, tier: 1 })
    if (age > 22 && k.personId === undefined) add({ key: `F.kidWork${i}`, category: 'family', statement: `${term}已经工作了`, first: `我${term}已经工作了`, third: `{name}的${term}已经工作了`, tier: 1 })
    if (p.stage === 'adult' || age <= 22) add({ key: `LE.kid${i}`, category: 'life_event', statement: `${k.birthYear}年${term}出生`, first: `我${term}是${k.birthYear}年出生的`, third: `{name}的${term}是${k.birthYear}年出生的`, validFrom: String(k.birthYear), mentionIds: mention, tier: 1 })
  })
  if (p.stage !== 'retired') {
    const parentIds = p.parents.personIds
    if (p.parents.alive || parentIds.length) {
      const where = p.parents.city === p.city ? `爸妈也住在${p.city}` : `爸妈住在${p.parents.city}`
      add({ key: 'F.parents', category: 'family', statement: where, first: p.parents.city === p.city ? `我爸妈也在${p.city}，离得不远` : `我爸妈在${p.parents.city}`, third: `{name}的${where}`, mentionIds: parentIds, tier: 1 })
      if (p.parents.retired && p.stage === 'adult') add({ key: 'F.parentsRetired', category: 'family', statement: '爸妈都已经退休了', first: '我爸妈都已经退休了', third: '{name}的爸妈都已经退休了', mentionIds: parentIds, tier: 2 })
    }
    if (p.siblings.length) {
      p.siblings.forEach((s, i) => {
        const mention = s.personId !== undefined ? [s.personId] : []
        add({ key: `F.sib${i}`, category: 'family', statement: `有个${s.term}在${s.city}`, first: `我${s.term}在${s.city}`, third: `{name}的${s.term}在${s.city}`, mentionIds: mention, tier: 1 })
      })
    } else add({ key: 'F.only', category: 'family', statement: `是家里的独生${p.gender === 'f' ? '女' : '子'}`, first: `我是独生${p.gender === 'f' ? '女' : '子'}`, third: `{name}是独生${p.gender === 'f' ? '女' : '子'}`, tier: 2 })
    if (p.extras.grandparent) {
      const g = p.extras.grandparent
      add({ key: 'F.gp', category: 'family', statement: `${g.term}今年${g.age}岁，身体还很硬朗`, first: `我${g.term}今年${g.age}岁了，身体还很硬朗`, third: `{name}的${g.term}今年${g.age}岁了，身体还很硬朗`, window: clk.thisYear(), tier: 2 })
    }
  } else {
    if (p.extras.grandkids) add({ key: 'F.grandkid', category: 'family', statement: `已经抱上${p.extras.grandkids}了`, first: `我已经抱上${p.extras.grandkids}了`, third: `{name}已经抱上${p.extras.grandkids}了`, tier: 1 })
    if (p.spouse) add({ key: 'F.together', category: 'family', statement: '和老伴一起住', first: '我跟老伴两个人住', third: '{name}跟老伴两个人住', tier: 2 })
  }

  // ----- preference -----
  const hobbyMap = p.stage === 'retired' ? RETIREE_HOBBIES : HOBBIES
  for (const h of p.hobbies) {
    const t = hobbyMap[h] ?? HOBBIES[h]
    if (!t) continue
    add({ key: `P.hobby.${h}`, category: 'preference', statement: t[0], first: t[1], third: t[2], q: '周末一般干嘛？', tier: 1 })
  }
  for (const d of p.dislikes) add({ key: `P.dislike.${d}`, category: 'preference', statement: d === '辣' ? '不吃辣' : `不吃${d}`, first: d === '辣' ? '我不吃辣，一点辣都吃不了' : `我不吃${d}的哈`, third: d === '辣' ? '{name}不吃辣，一点辣都吃不了' : `{name}不吃${d}`, q: '平时有什么忌口吗？', tier: 1 })
  const drink: Fact = p.stage === 'retired'
    ? { key: 'P.drink', category: 'preference', statement: '每天都要泡一壶茶', first: '我每天早上都要泡一壶茶', third: '{name}每天早上都要泡一壶茶', tier: 1 }
    : { key: 'P.drink', category: 'preference', statement: `每天都要喝${p.drink}`, first: `我每天都要来一杯${p.drink}`, third: `{name}每天都要喝${p.drink}`, tier: 1 }
  add(drink)
  if (p.secondary === 'drink' && p.prevDrink && p.secondaryAt) {
    drink.first = `我戒了${p.prevDrink}，现在每天喝${p.drink}`
    drink.validFrom = ymStr(p.secondaryAt)
    drink.window = clk.since(p.secondaryAt)
    chains.push({ key: 'C.drink', cur: drink, old: { key: 'P.drink0', category: 'preference', statement: `每天都要喝${p.prevDrink}`, first: `我每天都要来一杯${p.prevDrink}`, third: `{name}每天都要喝${p.prevDrink}`, window: clk.before(p.secondaryAt), tier: 1 } })
  }
  if (p.sport) {
    const sp = p.sport
    const sport: Fact = { key: 'P.sport', category: 'preference', statement: `每周${sp.name}${sp.n}次`, first: `我现在每周${sp.name}${sp.n}次`, third: `{name}每周${sp.name}${sp.n}次`, tier: 1 }
    add(sport)
    if (p.secondary === 'sport' && p.prevSport && p.secondaryAt) {
      sport.first = `我不${p.prevSport.name}了，改成每周${sp.name}${sp.n}次`
      sport.validFrom = ymStr(p.secondaryAt)
      sport.window = clk.since(p.secondaryAt)
      chains.push({ key: 'C.sport', cur: sport, old: { key: 'P.sport0', category: 'preference', statement: `每周${p.prevSport.name}${p.prevSport.n}次`, first: `我现在每周${p.prevSport.name}${p.prevSport.n}次`, third: `{name}每周${p.prevSport.name}${p.prevSport.n}次`, window: clk.before(p.secondaryAt), tier: 1 } })
    }
  }
  if (p.stage !== 'retired') add({ key: 'P.weekend', category: 'preference', statement: `周末常去${p.weekend}`, first: `我周末一般去${p.weekend}`, third: `{name}周末常去${p.weekend}`, tier: 2 })
  add({ key: 'P.cuisine', category: 'preference', statement: `最爱吃${p.cuisine}`, first: `我最爱吃${p.cuisine}`, third: `{name}最爱吃${p.cuisine}`, tier: 2 })
  if (p.stage !== 'retired') {
    add({ key: 'P.music', category: 'preference', statement: `喜欢听${p.music}`, first: `我平时喜欢听${p.music}`, third: `{name}平时喜欢听${p.music}`, tier: 2 })
    add({ key: 'P.genre', category: 'preference', statement: `爱看${p.genre}`, first: `我最近在补${p.genre}`, third: `{name}爱看${p.genre}`, tier: 2 })
  }
  add(p.earlyBird ? { key: 'P.sleep', category: 'preference', statement: '习惯早睡早起', first: '我习惯早睡早起，十点睡六点起', third: '{name}习惯早睡早起', tier: 2 } : { key: 'P.sleep', category: 'preference', statement: '经常熬夜', first: '我经常熬夜，基本一点以后才睡', third: '{name}经常熬夜', tier: 2 })
  add(p.drinksAlcohol ? { key: 'P.alcohol', category: 'preference', statement: '喜欢喝点精酿啤酒', first: '我周末喜欢喝点精酿啤酒', third: '{name}周末喜欢喝点精酿啤酒', tier: 2 } : { key: 'P.alcohol', category: 'preference', statement: '不喝酒', first: '我不喝酒，一喝就脸红', third: '{name}不喝酒', tier: 2 })
  if (p.stage === 'adult') add(p.car ? { key: 'P.travel', category: 'preference', statement: '出去玩喜欢自驾', first: '我出去玩一般自驾', third: '{name}出去玩喜欢自驾', tier: 2 } : { key: 'P.travel', category: 'preference', statement: '旅行喜欢住民宿', first: '我出去玩喜欢住民宿', third: '{name}旅行喜欢住民宿', tier: 2 })

  // ----- life events -----
  p.trips.forEach((t, i) => {
    const style = p.stage === 'retired' ? '跟团去' : '去'
    add({ key: `LE.trip${i}`, category: 'life_event', statement: `${t.year}年${style}${t.place}旅行`, first: `${t.year}年我${style}${t.place}玩了一趟`, third: `{name}${t.year}年${style}${t.place}玩了一趟`, validFrom: String(t.year), window: clk.after({ y: t.year, m: t.m }), tier: 1 })
  })
  p.jobs.slice(1).forEach((j, i) => {
    if (p.stage !== 'adult') return
    const prev = p.jobs[i]
    const what = j.own ? `辞职开了一家${j.own}` : j.city !== prev.city ? `去了${j.city}的${j.company}` : j.company === prev.company && j.role !== prev.role ? `升职做了${j.role}` : `跳槽去了${j.company}`
    add({ key: `LE.job${i}`, category: 'life_event', statement: `${j.from.y}年${what}`, first: `我${j.from.y}年${what}`, third: `{name}${j.from.y}年${what}`, validFrom: String(j.from.y), window: clk.since(j.from), tier: 1 })
  })
  const runs = p.hobbies.includes('跑步') || p.sport?.name === '跑步' || p.prevSport?.name === '跑步'
  if (runs && p.stage === 'adult') {
    const y = Math.max(now - 5, (p.school?.grad ?? now - 5) + 1)
    add({ key: 'LE.marathon', category: 'life_event', statement: `${y}年跑完了第一个半程马拉松`, first: `${y}年我跑完了人生第一个半马`, third: `{name}${y}年跑完了第一个半马`, validFrom: String(y), window: clk.after({ y, m: 12 }), tier: 1 })
  }
  if (p.license) add({ key: 'LE.license', category: 'life_event', statement: `${p.license}年考了驾照`, first: `我${p.license}年考的驾照`, third: `{name}${p.license}年考的驾照`, validFrom: String(p.license), window: clk.after({ y: p.license, m: 12 }), tier: 2 })
  if (p.pet) add({ key: 'LE.pet', category: 'life_event', statement: `${p.pet.since}年开始养${p.pet.kind}`, first: `我${p.pet.since}年开始养的${p.pet.name}`, third: `{name}${p.pet.since}年开始养${p.pet.kind}`, validFrom: String(p.pet.since), window: clk.after({ y: p.pet.since, m: 12 }), tier: 2 })

  // ----- other -----
  if (p.pet) add({ key: 'O.pet', category: 'other', statement: `养了一只叫${p.pet.name}的${p.pet.kind}`, first: `我家${p.pet.kind}叫${p.pet.name}，可闹了`, third: `{name}家的${p.pet.kind}叫${p.pet.name}`, tier: 1 })
  if (p.allergy) add({ key: 'O.allergy', category: 'other', statement: `对${p.allergy}过敏`, first: `我对${p.allergy}过敏`, third: `{name}对${p.allergy}过敏`, tier: 1 })
  if (p.skill) {
    const learning: Fact = { key: 'O.skill', category: 'other', statement: `最近在学${p.skill}`, first: `最近在学${p.skill}`, third: `{name}最近在学${p.skill}`, window: [300, 0], tier: 1 }
    if (p.secondary === 'skill' && p.secondaryAt) {
      const done: Fact = { key: 'O.skill', category: 'other', statement: `学会了${p.skill}`, first: `练了大半年，我终于学会${p.skill}了`, third: `{name}学会了${p.skill}`, validFrom: ymStr(p.secondaryAt), window: clk.since(p.secondaryAt), tier: 1 }
      add(done)
      chains.push({ key: 'C.skill', cur: done, old: { ...learning, key: 'O.skill0', window: clk.before(p.secondaryAt) } })
    } else add(learning)
  }
  if (p.lang) add({ key: 'O.lang', category: 'other', statement: `会说${p.lang}`, first: `我会说${p.lang}`, third: `{name}会说${p.lang}`, tier: 2 })
  if (p.stage === 'adult') {
    if (p.car) {
      const car: Fact = { key: 'O.car', category: 'other', statement: `开一辆${p.car}`, first: `我开的是一辆${p.car}`, third: `{name}开的是一辆${p.car}`, tier: 2 }
      add(car)
      if (p.secondary === 'car' && p.secondaryAt) {
        car.first = `我前阵子提了一辆${p.car}`
        car.validFrom = ymStr(p.secondaryAt)
        car.window = [clk.ago(p.secondaryAt.y, p.secondaryAt.m, 1) - 3, Math.max(0, clk.ago(p.secondaryAt.y, p.secondaryAt.m, 1) - 90)]
        chains.push({ key: 'C.car', cur: car, old: { key: 'O.car0', category: 'other', statement: '还没买车', first: '我到现在还没买车，出门都坐地铁', third: '{name}还没买车，出门都坐地铁', window: clk.before(p.secondaryAt), tier: 2 } })
      }
    } else if (p.skill !== '开车') add({ key: 'O.car', category: 'other', statement: '还没买车', first: '我到现在还没买车，出门都坐地铁', third: '{name}还没买车，出门都坐地铁', tier: 2 })
  }
  if (p.myopia) add({ key: 'O.myopia', category: 'other', statement: `近视${p.myopia}度`, first: `我近视${p.myopia}度，不戴眼镜啥都看不清`, third: `{name}近视${p.myopia}度`, tier: 2 })
  if (p.extras.leftHanded) add({ key: 'O.left', category: 'other', statement: '是左撇子', first: '我是左撇子，吃饭老跟人撞胳膊', third: '{name}是左撇子', tier: 2 })
  if (p.extras.donor) add({ key: 'O.donor', category: 'other', statement: '每年都去献血', first: '我每年都去献一次血', third: '{name}每年都去献一次血', tier: 2 })
  if (p.stage === 'retired') add({ key: 'O.knee', category: 'other', statement: '膝盖不太好', first: '我膝盖不太好，爬楼梯费劲', third: '{name}膝盖不太好，爬楼梯费劲', tier: 1 })
  if (p.extras.volunteer && p.stage === 'adult') add({ key: 'O.volunteer', category: 'other', statement: '周末在社区做志愿者', first: '我周末在社区做志愿者', third: '{name}周末在社区做志愿者', tier: 2 })

  return { facts: F, chains }
}

/** Handles-friendly nicknames: `mentioned` (叠字) and an address term that fits gender, age and job. */
export function addressTermFor(p: Persona, surname: string): string {
  const job = p.jobs.at(-1)
  if (p.stage === 'retired') return `${surname}${p.gender === 'f' ? '阿姨' : '叔'}`
  if (job?.role.includes('老师') || job?.role === '幼师') return `${surname}老师`
  if (job?.role.includes('医生')) return `${surname}医生`
  if (job?.own) return `${surname}老板`
  if (job?.role.includes('师傅') || job?.role.includes('队长')) return `${surname}师傅`
  if (job && /总监|主管|经理|行长|合伙人/.test(job.role)) return `${surname}总`
  return `${surname}${p.gender === 'f' ? '姐' : '哥'}`
}

/** A proposed update for a current job or home, as heard very recently ("下个月去…上班", "下个月搬去…"). */
export function changeFactFor(p: Persona, category: 'work' | 'location', clk: Clock, r: Rng): Fact {
  const next = clk.month === 12 ? { y: clk.year + 1, m: 1 } : { y: clk.year, m: clk.month + 1 }
  if (category === 'work') {
    const cur = p.jobs.at(-1)!
    const field = FIELDS[p.field ?? 'business'] ?? FIELDS.business
    const places = field.places.filter((pl) => pl.company !== cur.company)
    const place = places.length ? r.pick(places) : field.places[0]
    const role = pickRole(r, place, p.school?.major ?? '')
    const statement = `在${cur.city}的${place.company}做${role}`
    return { key: 'X.job', category: 'work', statement, first: `我下个月去${place.company}上班了，还是在${cur.city}，做${role}`, third: `{name}下个月去${place.company}上班，做${role}`, validFrom: ymStr(next), window: [30, 0], tier: 0 }
  }
  const d = districtOf(r, p.city, p.district)
  return { key: 'X.home', category: 'location', statement: `住在${p.city}${d}`, first: `我们下个月搬去${d}，新房子刚交房`, third: `{name}家下个月搬去${p.city}${d}`, validFrom: ymStr(next), window: [30, 0], tier: 0 }
}
