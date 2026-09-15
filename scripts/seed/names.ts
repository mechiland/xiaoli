// Fictional person labels for seed data. Combinations of common surnames and given names — no real people.
import type { Rng } from './rng'

/** Hand-picked labels for tagged persons (fictional). */
export const TAGGED_LABELS = {
  longProfile: '林知夏',
  sparseProfile: '邓一帆',
  proposedHeavy: '许嘉禾',
  withHistory: '曾予安', // 曾 → Z (polyphonic surname)
  lunarBirthdaySoon: '孟春和',
  leapMonth: '闫小满',
  /** exactly 30 characters */
  longLabel: '大学室友阿宁（杭州独立设计工作室合伙人兼周末陶艺课代课老师）',
  deleteMe: '唐可可',
  reviewNew: '贺知遥',
  privateLatin: 'Nora Chen',
} as const

/** Latin, emoji and digit labels: I/U/V have no Chinese pinyin initials; '#' group for emoji/digits. */
export const SPECIAL_LABELS = ['Nora Chen', 'Ivy Zhang', 'Uma Patel', 'Vivian Ho', 'Kevin Wu', 'Oscar Li', 'Emma', '8楼邻居刘阿姨', '🐱 橘子妈妈', '3号技师小吴'] as const

/** Surnames grouped by pinyin initial (surname reading): covers A–Z except I, U, V. */
export const SURNAMES_BY_LETTER: Record<string, string[]> = {
  A: ['艾', '安'],
  B: ['白', '包', '毕'],
  C: ['陈', '曹', '程', '崔'],
  D: ['邓', '丁', '杜', '戴'],
  E: ['鄂'],
  F: ['范', '方', '冯', '傅'],
  G: ['高', '顾', '郭', '葛'],
  H: ['何', '胡', '黄', '韩'],
  J: ['江', '蒋', '金', '贾'],
  K: ['孔', '康'],
  L: ['刘', '李', '陆', '罗', '梁'],
  M: ['马', '毛', '莫'],
  N: ['聂', '牛', '倪'],
  O: ['欧阳', '区'],
  P: ['潘', '彭', '庞'],
  Q: ['钱', '秦', '邱', '仇'],
  R: ['任', '冉', '阮'],
  S: ['孙', '宋', '沈', '单', '苏'],
  T: ['陶', '田', '谭'],
  W: ['王', '吴', '魏', '温', '万'],
  X: ['徐', '谢', '解', '夏'],
  Y: ['杨', '叶', '于', '袁'],
  Z: ['张', '赵', '周', '郑', '朱'],
}

export const GIVEN_NAMES = [
  '雨桐', '子墨', '思远', '佳怡', '浩然', '梓涵', '一诺', '晓峰', '文静', '志强', '秀英', '建国', '雅琴', '俊杰', '欣悦', '明轩',
  '若溪', '嘉懿', '天佑', '诗涵', '宇航', '靖雯', '书瑶', '皓轩', '语嫣', '安然', '沐阳', '清妍', '景行', '晨曦', '乐怡', '泽宇',
  '可欣', '思齐', '亦凡', '梦洁', '睿哲', '晓燕', '海涛', '丽华', '春生', '秋月', '冬梅', '德明', '玉兰', '国栋', '卫东', '红霞',
  '小川', '大伟', '星辰', '慧敏', '立新', '婉清', '振华', '雪', '峰', '敏', '磊', '静',
]

/**
 * `count` distinct Chinese labels (in addition to `reserved`), at least `minPerLetter` per surname letter, deterministic.
 */
export function generateChineseLabels(rng: Rng, count: number, reserved: readonly string[], minPerLetter = 3): string[] {
  const used = new Set(reserved)
  const out: string[] = []
  const add = (surname: string) => {
    for (let tries = 0; tries < 50; tries++) {
      const label = surname + rng.pick(GIVEN_NAMES)
      if (!used.has(label)) {
        used.add(label)
        out.push(label)
        return true
      }
    }
    return false
  }
  const letters = Object.keys(SURNAMES_BY_LETTER)
  for (const letter of letters) {
    for (let i = 0; i < minPerLetter && out.length < count; i++) add(SURNAMES_BY_LETTER[letter][i % SURNAMES_BY_LETTER[letter].length])
  }
  const weighted = letters.flatMap((l) => SURNAMES_BY_LETTER[l])
  while (out.length < count) add(rng.pick(weighted))
  return out
}

/** Birth-cohort feel of a given name: 'old' (born 1950s–60s), 'mid70' (1970s–early 80s), 'mid' (mid 80s–2000), 'young' (2000s–). */
export type NameEra = 'old' | 'mid70' | 'mid' | 'young'
const FEMALE_GIVEN = new Set(['雨桐', '佳怡', '梓涵', '文静', '秀英', '雅琴', '欣悦', '若溪', '嘉懿', '诗涵', '靖雯', '书瑶', '语嫣', '清妍', '晨曦', '乐怡', '可欣', '梦洁', '晓燕', '丽华', '秋月', '冬梅', '玉兰', '红霞', '慧敏', '婉清', '雪', '敏', '静'])
const MALE_GIVEN = new Set(['子墨', '思远', '浩然', '晓峰', '志强', '建国', '俊杰', '明轩', '天佑', '宇航', '皓轩', '景行', '泽宇', '睿哲', '海涛', '春生', '德明', '国栋', '卫东', '小川', '大伟', '立新', '振华', '峰', '磊', '亦凡', '沐阳'])
const OLD_GIVEN = new Set(['秀英', '建国', '志强', '海涛', '丽华', '春生', '秋月', '冬梅', '德明', '玉兰', '国栋', '卫东', '红霞', '立新', '振华'])
const MID70_GIVEN = new Set(['晓燕', '大伟', '慧敏', '雅琴', '晓峰', '文静'])
const YOUNG_GIVEN = new Set(['梓涵', '子墨', '浩然', '一诺', '天佑', '皓轩', '语嫣', '沐阳', '泽宇'])
const ALL_SURNAMES = Object.values(SURNAMES_BY_LETTER).flat().sort((a, b) => b.length - a.length)

/** Given-name part of a generated Chinese label ('' when the label is not surname + given name). */
export function givenName(label: string): string {
  const s = ALL_SURNAMES.find((x) => label.startsWith(x) && label.length > x.length)
  return s ? label.slice(s.length) : ''
}
export function surnameOf(label: string): string {
  return ALL_SURNAMES.find((x) => label.startsWith(x) && label.length > x.length) ?? label.slice(0, 1)
}
/** 'f' | 'm' for gendered given names, null for neutral ones (一诺, 安然, 思齐, 星辰). */
export function nameGender(label: string): 'f' | 'm' | null {
  const g = givenName(label)
  return FEMALE_GIVEN.has(g) ? 'f' : MALE_GIVEN.has(g) ? 'm' : null
}
export function nameEra(label: string): NameEra {
  const g = givenName(label)
  return OLD_GIVEN.has(g) ? 'old' : MID70_GIVEN.has(g) ? 'mid70' : YOUNG_GIVEN.has(g) ? 'young' : 'mid'
}
