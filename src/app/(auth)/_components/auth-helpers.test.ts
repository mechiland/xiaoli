import { describe, expect, it } from 'vitest'
import { authErrorMessage, validateAuthInput } from './auth-helpers'

describe('validateAuthInput', () => {
  it('requires a well-formed email and a password', () => {
    expect(validateAuthInput('sign-in', { email: '', password: 'x' })).toBe('请填写邮箱')
    expect(validateAuthInput('sign-in', { email: 'no-at', password: 'x' })).toBe('邮箱格式不对')
    expect(validateAuthInput('sign-in', { email: 'a@b.cn', password: '' })).toBe('请填写密码')
    expect(validateAuthInput('sign-in', { email: ' a@b.cn ', password: 'x' })).toBeNull()
  })
  it('enforces sign-up password length and name length', () => {
    expect(validateAuthInput('sign-up', { email: 'a@b.cn', password: '1234567' })).toBe('密码至少 8 位')
    expect(validateAuthInput('sign-up', { email: 'a@b.cn', password: 'x'.repeat(129) })).toBe('密码太长了')
    expect(validateAuthInput('sign-up', { email: 'a@b.cn', password: '12345678', name: '名'.repeat(41) })).toBe('称呼太长了')
    expect(validateAuthInput('sign-up', { email: 'a@b.cn', password: '12345678', name: '合成' })).toBeNull()
  })
})

describe('authErrorMessage', () => {
  it('maps Better Auth codes to Chinese copy without leaking internals', () => {
    expect(authErrorMessage({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 })).toBe('邮箱或密码不对')
    expect(authErrorMessage({ code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', status: 422 })).toBe('这个邮箱已经注册过了，可以直接登录')
    expect(authErrorMessage({ status: 429 })).toBe('尝试次数太多，请稍后再试')
    expect(authErrorMessage({ status: 500, message: 'SQLITE_ERROR: secret detail' })).toBe('没有成功，请稍后再试')
    expect(authErrorMessage(null)).toBe('没有成功，请稍后再试')
  })
})
