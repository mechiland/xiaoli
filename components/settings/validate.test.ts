import { describe, expect, it } from 'vitest'
import { passwordErrorMessage, validatePasswordChange } from './AccountBlock'
import { modelOptions, parseThreshold } from './ExtractBlock'
import { validateSelfName } from './SelfNamesBlock'

describe('settings pure helpers', () => {
  it('validateSelfName', () => {
    expect(validateSelfName('  ', [])).toBe('请填写显示名')
    expect(validateSelfName('小丽', ['小丽'])).toBe('这个名字已经登记过了')
    expect(validateSelfName(' 小丽 ', ['小丽'])).toBe('这个名字已经登记过了')
    expect(validateSelfName('长'.repeat(41), [])).toBe('显示名最多 40 个字')
    expect(validateSelfName('新名字', Array.from({ length: 10 }, (_, i) => `n${i}`))).toBe('最多登记 10 个显示名')
    expect(validateSelfName('小丽', ['阿丽'])).toBeNull()
  })

  it('parseThreshold', () => {
    expect(parseThreshold('0.8')).toEqual({ value: 0.8 })
    expect(parseThreshold(' 0.855 ')).toEqual({ value: 0.86 })
    expect(parseThreshold('1')).toEqual({ value: 1 })
    for (const bad of ['', '0.49', '1.01', 'abc', '80']) expect(parseThreshold(bad)).toEqual({ error: '请填 0.5 到 1 之间的数' })
  })

  it('modelOptions: null shows 默认（deepseek-flash）; explicit flash listed only when saved', () => {
    expect(modelOptions(null).map((o) => o.label)).toEqual(['默认（deepseek-flash）', 'deepseek-v4-pro'])
    expect(modelOptions('deepseek-flash').map((o) => o.value)).toEqual(['default', 'deepseek-flash', 'deepseek-v4-pro'])
  })

  it('validatePasswordChange + passwordErrorMessage', () => {
    expect(validatePasswordChange({ current: '', next: 'abcdefgh', repeat: 'abcdefgh' })).toBe('请填写当前密码')
    expect(validatePasswordChange({ current: 'x', next: 'short', repeat: 'short' })).toBe('新密码至少 8 位')
    expect(validatePasswordChange({ current: 'x', next: 'abcdefgh', repeat: 'abcdefgX' })).toBe('两次输入的新密码不一样')
    expect(validatePasswordChange({ current: 'abcdefgh', next: 'abcdefgh', repeat: 'abcdefgh' })).toBe('新密码和当前密码一样')
    expect(validatePasswordChange({ current: 'old-pass-1', next: 'new-pass-1', repeat: 'new-pass-1' })).toBeNull()
    expect(passwordErrorMessage({ code: 'INVALID_PASSWORD', status: 400 })).toBe('当前密码不对')
    expect(passwordErrorMessage({ status: 429 })).toBe('尝试次数太多，请稍后再试')
    expect(passwordErrorMessage({ status: 500 })).toBe('没有修改成功，请稍后再试')
  })
})
