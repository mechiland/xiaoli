import { describe, expect, it } from 'vitest'
import { highlightRanges, isLatinQuery, likeContains, normalizeQuery, pinyinKeys, segmentsFor, splitTerms } from './text'

describe('search text helpers', () => {
  it('normalizes like the stored *_norm columns and collapses whitespace', () => {
    expect(normalizeQuery('  ＡＢＣ　 公司  ')).toBe('abc 公司')
  })

  it('splits terms longest first without duplicates', () => {
    expect(splitTerms('茶 景德镇  茶')).toEqual(['景德镇', '茶'])
  })

  it('escapes LIKE wildcards', () => {
    expect(likeContains('50%_a\\b')).toBe('%50\\%\\_a\\\\b%')
  })

  it('highlights every occurrence, maps full-width offsets back to the original, merges overlaps', () => {
    expect(highlightRanges('收藏了一整套景德镇青花茶具', ['景德镇'])).toEqual([[6, 9]])
    expect(highlightRanges('在ＡＢＣ公司，后来去了abc', ['abc'])).toEqual([[1, 4], [11, 14]])
    expect(highlightRanges('杭州杭州', ['杭州'])).toEqual([[0, 4]])
    expect(highlightRanges('青花茶具', ['青花', '花茶'])).toEqual([[0, 3]])
    expect(highlightRanges('没有', ['杭州'])).toEqual([])
    // astral code points keep UTF-16 offsets
    expect(highlightRanges('🐱 橘子妈妈', ['橘子'])).toEqual([[3, 5]])
  })

  it('segments text for rendering', () => {
    expect(segmentsFor('在杭州读书', [[1, 3]])).toEqual([
      { text: '在', hit: false },
      { text: '杭州', hit: true },
      { text: '读书', hit: false },
    ])
    expect(segmentsFor('abc', [])).toEqual([{ text: 'abc', hit: false }])
  })

  it('detects Latin queries and builds pinyin keys only for Han labels', () => {
    expect(isLatinQuery('lzx')).toBe(true)
    expect(isLatinQuery('Lin Zhi')).toBe(true)
    expect(isLatinQuery('林')).toBe(false)
    expect(isLatinQuery('a1')).toBe(false)
    expect(pinyinKeys('林知夏', 'lin zhi xia')).toEqual({ full: 'linzhixia', initials: 'lzx' })
    expect(pinyinKeys('8楼邻居刘阿姨', '8 lou lin ju liu a yi')).toEqual({ full: 'loulinjuliuayi', initials: 'lljlay' })
    expect(pinyinKeys('Nora Chen', 'nora chen')).toBeNull()
  })
})
