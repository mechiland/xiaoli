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
