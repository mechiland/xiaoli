'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signIn, signUp } from '@/lib/auth-client'
import { homeHref, signInHref, signUpHref, welcomeHref } from '@/lib/links'
import { authErrorMessage, validateAuthInput, type AuthMode } from './auth-helpers'

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const input = {
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
      name: String(form.get('name') ?? ''),
    }
    const invalid = validateAuthInput(mode, input)
    if (invalid) {
      setError(invalid)
      return
    }
    setPending(true)
    setError(null)
    const email = input.email.trim()
    const result =
      mode === 'sign-up'
        ? await signUp.email({ email, password: input.password, name: input.name.trim() || email.split('@')[0] })
        : await signIn.email({ email, password: input.password })
    if (result.error) {
      setPending(false)
      setError(authErrorMessage(result.error))
      return
    }
    // Sign-up → onboarding (SPEC §9.12); sign-in → home.
    router.replace(mode === 'sign-up' ? welcomeHref : homeHref)
    router.refresh()
  }

  const isSignUp = mode === 'sign-up'
  return (
    <div className="border border-line bg-paper px-6 py-7 sm:px-8">
      <h1 className="loam-section-title mb-6">{isSignUp ? '注册' : '登录'}</h1>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {isSignUp && (
          <div className="space-y-1.5">
            <Label htmlFor="name">怎么称呼你</Label>
            <Input id="name" name="name" autoComplete="nickname" maxLength={40} placeholder="可以不填" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email">邮箱</Label>
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">密码</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            required
            minLength={8}
            placeholder={isSignUp ? '至少 8 位' : undefined}
          />
        </div>
        {error && (
          <p role="alert" className="border-l border-danger pl-3 text-[14px] leading-6 text-danger">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? (isSignUp ? '正在注册…' : '正在登录…') : isSignUp ? '注册' : '登录'}
        </Button>
      </form>
      <p className="mt-6 border-t border-line pt-5 text-[14px] text-ink-2">
        {isSignUp ? (
          <>
            已经有账号了？<Link href={signInHref} className="loam-link">登录</Link>
          </>
        ) : (
          <>
            第一次使用？<Link href={signUpHref} className="loam-link">注册一个账号</Link>
          </>
        )}
      </p>
    </div>
  )
}
