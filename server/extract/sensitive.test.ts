import { describe, expect, it } from 'vitest'
import type { ExtractionOutput } from '@/contracts'
import { applySensitiveGuard, detectSensitive, neutraliseLabel, softenDayNumbers } from './sensitive'

// All values are invented test data.
const empty = (): ExtractionOutput => ({ newPersons: [], handles: [], relations: [], claims: [], events: [], dates: [] })
const claim = (statement: string) => ({ person: { personId: 1 }, statement, category: 'other' as const, confidence: 0.9, sensitive: false, evidence: [1] })

describe('detectSensitive', () => {
  it.each([
    ['手机号是13800001111', 'phone'],
    ['电话 138 0000 1111', 'phone'],
    ['座机010-12345678', 'phone'],
    ['身份证11010519900101123X', 'id_card'],
    ['卡号6222 0000 1111 2222 333', 'bank_card'],
    ['住在枫叶路12号', 'address'],
    ['住3栋2单元501室', 'address'],
    ['家在88弄', 'address'],
  ])('%s → %s', (text, kind) => {
    expect(detectSensitive(text)).toBe(kind)
  })

  it.each(['住在杭州', '10月3号过生日', '今年30岁', '坐3号线上班', '在2026年入职'])('%s is clean', (text) => {
    expect(detectSensitive(text)).toBeNull()
  })
})

describe('softenDayNumbers', () => {
  it('turns a bare day number into 日 but leaves addresses alone', () => {
    expect(softenDayNumbers('周五5号交房租')).toBe('周五5日交房租')
    // after 月 it is already a date for the detector and stays as written
    expect(softenDayNumbers('每月5号交房租')).toBe('每月5号交房租')
    expect(softenDayNumbers('住在枫叶路12号')).toBe('住在枫叶路12号')
    expect(softenDayNumbers('坐3号线')).toBe('坐3号线')
  })
})

describe('applySensitiveGuard', () => {
  it('rewrites sensitive claims, drops sensitive handles/events, strips sensitive places and labels', () => {
    const out = empty()
    out.claims.push(claim('收货地址是枫叶路12号3栋'), claim('手机号13800001111'), claim('在杭州做设计'))
    out.handles.push({ person: { personId: 1 }, kind: 'mentioned', value: '13800001111', evidence: [1] }, { person: { personId: 1 }, kind: 'address_term', value: '小周', evidence: [1] })
    out.events.push(
      { summary: '去枫叶路12号吃饭', participants: [{ personId: 1 }], evidence: [2] },
      { summary: '一起吃饭', place: '枫叶路12号', participants: [{ personId: 1 }], evidence: [2] },
    )
    out.relations.push({ from: { personId: 1 }, to: { personId: 2 }, type: 'friend', label: '12号楼邻居', evidence: [3] })
    const { output, rewritten } = applySensitiveGuard(out)
    expect(output.claims.map((c) => [c.statement, c.sensitive])).toEqual([
      ['提供过收货地址', true],
      ['提供过手机号', true],
      ['在杭州做设计', false],
    ])
    expect(output.handles.map((h) => h.value)).toEqual(['小周'])
    expect(output.events).toHaveLength(1)
    expect(output.events[0].place).toBeUndefined()
    expect(output.relations[0].label).toBeUndefined()
    expect(rewritten).toBe(6)
    for (const c of output.claims) expect(detectSensitive(c.statement)).toBeNull()
    const landline = applySensitiveGuard({ ...empty(), claims: [claim('座机010-12345678')] })
    expect(landline.output.claims[0].statement).toBe('提供过联系方式')
  })

  it('neutralises sensitive new-person labels, or drops the person with every item about it', () => {
    expect(neutraliseLabel('快递13812345678')).toBe('快递')
    expect(neutraliseLabel('3号楼王姐')).toBe('王姐')
    expect(neutraliseLabel('13812345678')).toBeNull()
    expect(neutraliseLabel('小周')).toBe('小周')
    const out = empty()
    out.newPersons.push({ tempId: 't1', label: '快递13812345678', evidence: [1] }, { tempId: 't2', label: '3栋502', evidence: [2] })
    out.handles.push({ person: { tempId: 't2' }, kind: 'address_term', value: '邻居', evidence: [2] })
    out.relations.push({ from: { tempId: 't2' }, to: { personId: 1 }, type: 'other', label: '邻居', evidence: [2] })
    out.claims.push({ ...claim('送快递'), person: { tempId: 't1' } }, { ...claim('养了一只猫'), person: { tempId: 't2' } })
    out.events.push({ summary: '一起吃饭', participants: [{ tempId: 't2' }, { personId: 1 }], evidence: [2] }, { summary: '搬家', participants: [{ tempId: 't2' }], evidence: [2] })
    out.dates.push({ person: { tempId: 't2' }, kind: 'birthday', month: 3, day: 8, calendar: 'solar', evidence: [2] })
    const { output, rewritten } = applySensitiveGuard(out)
    expect(output.newPersons).toEqual([{ tempId: 't1', label: '快递', evidence: [1] }])
    expect(output.claims.map((c) => c.statement)).toEqual(['送快递'])
    expect(output.handles).toEqual([])
    expect(output.relations).toEqual([])
    expect(output.dates).toEqual([])
    expect(output.events).toEqual([{ summary: '一起吃饭', participants: [{ personId: 1 }], evidence: [2] }])
    expect(rewritten).toBe(2)
    for (const p of output.newPersons) expect(detectSensitive(p.label)).toBeNull()
  })
})
