'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, type FormEvent } from 'react'
import { BlockError, Skeleton } from '@/components/loam'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient, signOut } from '@/lib/auth-client'
import { signInHref } from '@/lib/links'
import { useMeQuery } from './hooks'
import { FieldError, SettingRow } from './parts'

export interface PasswordInput {
  current: string
  next: string
  repeat: string
}

/** Client-side checks before calling Better Auth; returns a Chinese message or null. */
export function validatePasswordChange({ current, next, repeat }: PasswordInput): string | null {
  if (!current) return '请填写当前密码'
  if (!next) return '请填写新密码'
  if (next.length < 8) return '新密码至少 8 位'
  if (next.length > 128) return '新密码太长了'
  if (next !== repeat) return '两次输入的新密码不一样'
  if (next === current) return '新密码和当前密码一样'
  return null
}

/** Maps Better Auth change-password errors to Chinese; never echoes server text. */
export function passwordErrorMessage(err: { code?: string; status?: number } | null | undefined): string {
  switch (err?.code) {
    case 'INVALID_PASSWORD':
      return '当前密码不对'
    case 'PASSWORD_TOO_SHORT':
      return '新密码至少 8 位'
    case 'PASSWORD_TOO_LONG':
      return '新密码太长了'
    case 'CREDENTIAL_ACCOUNT_NOT_FOUND':
      return '这个账户没有设置密码'
  }
  if (err?.status === 429) return '尝试次数太多，请稍后再试'
  if (err?.status === 401) return '登录已过期，请重新登录后再修改'
  return '没有修改成功，请稍后再试'
}

/** 账户：修改密码、退出 (SPEC §9.11). */
export function AccountBlock() {
  const me = useMeQuery()
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [changed, setChanged] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const input: PasswordInput = {
      current: String(form.get('current') ?? ''),
      next: String(form.get('next') ?? ''),
      repeat: String(form.get('repeat') ?? ''),
    }
    setChanged(false)
    const invalid = validatePasswordChange(input)
    if (invalid) {
      setError(invalid)
      return
    }
    setError(null)
    setPending(true)
    const result = await authClient.changePassword({ currentPassword: input.current, newPassword: input.next, revokeOtherSessions: false })
    setPending(false)
    if (result.error) {
      setError(passwordErrorMessage(result.error))
      return
    }
    formRef.current?.reset()
    setChanged(true)
  }

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      router.replace(signInHref)
      router.refresh()
    }
  }

  return (
    <div data-settings-block="account">
      <SettingRow label="登录邮箱">
        {me.isPending ? (
          <Skeleton className="mt-1.5 h-4 w-48" />
        ) : me.isError ? (
          <BlockError onRetry={() => void me.refetch()} />
        ) : (
          <p className="break-all font-data text-[14px] leading-7 text-ink" data-account-email>
            {me.data.user.email}
          </p>
        )}
      </SettingRow>

      <SettingRow
        label="修改密码"
        status={
          changed ? (
            <span aria-live="polite" className="block font-data text-[12px] leading-5 text-ink-3" data-password-changed>
              密码已修改
            </span>
          ) : undefined
        }
      >
        <form ref={formRef} onSubmit={onSubmit} noValidate className="max-w-[360px] space-y-4" data-password-form>
          <div className="space-y-1.5">
            <Label htmlFor="current-password">当前密码</Label>
            <Input id="current-password" name="current" type="password" autoComplete="current-password" className="bg-paper" onChange={() => setChanged(false)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">新密码</Label>
            <Input id="new-password" name="next" type="password" autoComplete="new-password" placeholder="至少 8 位" className="bg-paper" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="repeat-password">再输一次新密码</Label>
            <Input id="repeat-password" name="repeat" type="password" autoComplete="new-password" className="bg-paper" />
          </div>
          {error && <FieldError>{error}</FieldError>}
          <div className="pt-1">
            <Button type="submit" variant="outline" className="bg-paper" disabled={pending}>
              {pending ? '正在修改…' : '修改密码'}
            </Button>
          </div>
        </form>
      </SettingRow>

      <SettingRow label="退出登录" align="control" hint="在这台设备上退出，数据不受影响。">
        <Button type="button" variant="outline" className="bg-paper" onClick={() => void handleSignOut()} disabled={signingOut}>
          {signingOut ? '正在退出…' : '退出'}
        </Button>
      </SettingRow>
    </div>
  )
}
