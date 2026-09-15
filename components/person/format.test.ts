import { describe, expect, it } from 'vitest'
import { dateAsWritten, daysText, formatPartialDate, linkMentions, markClassFor, parseAnchor, relationPhrase, sentence } from './format'

const A = { id: 1, label: '林知夏' }
const B = { id: 2, label: '王芳' }

describe('person format helpers', () => {
  it('relationPhrase reads from the page person', () => {
    // 王芳 是 林知夏 的 妈妈
    const r = { fromPersonId: 2, from: B, to: A, type: 'parent', label: '妈妈' }
    expect(relationPhrase(r, 1)).toEqual({ other: B, term: '妈妈', note: null })
    expect(relationPhrase(r, 2)).toEqual({ other: A, term: '子女', note: 'TA 是对方的妈妈' })
    expect(relationPhrase({ ...r, label: null }, 2)).toEqual({ other: A, term: '子女', note: null })
    expect(relationPhrase({ ...r, type: 'friend', label: null }, 2)).toEqual({ other: A, term: '朋友', note: null })
    expect(relationPhrase({ ...r, type: 'classmate', label: '大学同学' }, 2, 1)).toEqual({ other: A, term: '同学', note: 'TA 是我的大学同学' })
    expect(relationPhrase({ ...r, type: 'other', label: '邻居' }, 2)).toEqual({ other: A, term: '其他关系', note: 'TA 是对方的邻居' })
    expect(relationPhrase({ ...r, type: 'friend', label: '朋友' }, 2)).toEqual({ other: A, term: '朋友', note: null })
  })

  it('markClassFor tightens only after full-width punctuation', () => {
    expect(markClassFor('在汉中读高中。')).toBeDefined()
    expect(markClassFor('杭州')).toBeUndefined()
  })

  it('dates', () => {
    expect(formatPartialDate('2024')).toBe('2024年')
    expect(formatPartialDate('2024-05')).toBe('2024年5月')
    expect(formatPartialDate('2024-05-03')).toBe('2024年5月3日')
    expect(dateAsWritten({ calendar: 'lunar', month: 8, day: 15, year: null, isLeapMonth: false, next: null })).toBe('农历八月十五')
    expect(dateAsWritten({ calendar: 'lunar', month: 6, day: 1, year: null, isLeapMonth: true, next: null })).toBe('农历闰六月初一')
    expect(dateAsWritten({ calendar: 'lunar', month: 12, day: 20, year: null, isLeapMonth: false, next: null })).toBe('农历腊月二十')
    expect(dateAsWritten({ calendar: 'solar', month: 3, day: 1, year: 1990, isLeapMonth: false, next: null })).toBe('1990年3月1日')
    expect(daysText(0)).toBe('就是今天')
    expect(daysText(12)).toBe('还有 12 天')
  })

  it('linkMentions links the first occurrence of each label, longest first, never self', () => {
    expect(linkMentions('和王芳、林知夏一起开店，王芳管账', [B, A])).toEqual([
      { text: '和' },
      { text: '王芳', person: B },
      { text: '、' },
      { text: '林知夏', person: A },
      { text: '一起开店，王芳管账' },
    ])
    expect(linkMentions('和我一起', [{ id: 9, label: '我' }], 9)).toEqual([{ text: '和我一起' }])
  })

  it('sentence and anchors', () => {
    expect(sentence('在汉中读高中')).toBe('在汉中读高中。')
    expect(sentence('在汉中读高中。')).toBe('在汉中读高中。')
    expect(parseAnchor('#claim-345')).toEqual({ type: 'claim', id: 345 })
    expect(parseAnchor('#handle-2')).toEqual({ type: 'handle', id: 2 })
    expect(parseAnchor('#foo')).toBeNull()
  })
})
