// Pure helpers for the auth pages (unit-tested in auth-helpers.test.ts).

export type AuthMode = 'sign-in' | 'sign-up'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Client-side validation; returns a Chinese message or null. */
export function validateAuthInput(mode: AuthMode, input: { email: string; password: string; name?: string }): string | null {
  const email = input.email.trim()
  if (!email) return '请填写邮箱'
  if (!EMAIL.test(email)) return '邮箱格式不对'
  if (!input.password) return '请填写密码'
  if (mode === 'sign-up') {
    if (input.password.length < 8) return '密码至少 8 位'
    if (input.password.length > 128) return '密码太长了'
    if ((input.name ?? '').trim().length > 40) return '称呼太长了'
  }
  return null
}

/** Maps Better Auth client errors to user-facing Chinese; never echoes server internals. */
export function authErrorMessage(err: { code?: string; status?: number; message?: string } | null | undefined): string {
  const code = err?.code ?? ''
  switch (code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_PASSWORD':
    case 'USER_NOT_FOUND':
    case 'CREDENTIAL_ACCOUNT_NOT_FOUND':
      return '邮箱或密码不对'
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return '这个邮箱已经注册过了，可以直接登录'
    case 'PASSWORD_TOO_SHORT':
      return '密码至少 8 位'
    case 'PASSWORD_TOO_LONG':
      return '密码太长了'
    case 'INVALID_EMAIL':
      return '邮箱格式不对'
  }
  if (err?.status === 429) return '尝试次数太多，请稍后再试'
  if (err?.status === 401) return '邮箱或密码不对'
  return '没有成功，请稍后再试'
}
