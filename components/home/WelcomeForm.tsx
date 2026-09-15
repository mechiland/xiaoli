'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ApiClientError, api, unwrap } from '@/lib/api-client'
import { homeHref } from '@/lib/links'
import { queryKeys } from '@/lib/query'
import { splitNames } from './format'

/** /welcome form (SPEC §9.12): "保存" and "跳过" both PATCH /api/settings { onboarded: true, … } and go home. */
export function WelcomeForm({ initialNames }: { initialNames: string[] }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [value, setValue] = useState(initialNames.join('、'))
  const [pending, setPending] = useState<null | 'save' | 'skip'>(null)
  const [error, setError] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)

  async function submit(kind: 'save' | 'skip') {
    const names = splitNames(value)
    if (kind === 'save') {
      const problem =
        names.length === 0 ? '先填写显示名，或者跳过' : names.some((n) => n.length > 40) ? '每个显示名最多 40 个字' : names.length > 10 ? '最多填写 10 个显示名' : null
      setInvalid(problem !== null)
      if (problem) return setError(problem)
    }
    setPending(kind)
    setError(null)
    setInvalid(false)
    try {
      await unwrap(await api.settings.$patch({ json: kind === 'save' ? { selfDisplayNames: names, onboarded: true } : { onboarded: true } }))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.me() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.settings() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home() }),
      ])
      router.replace(homeHref)
      router.refresh()
    } catch (e) {
      setPending(null)
      setError(e instanceof ApiClientError && e.status < 500 ? e.message : '没有保存成功，请再试一次')
    }
  }

  return (
    <form
      noValidate
      className="mt-10 border-t border-line pt-8"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        void submit('save')
      }}
    >
      <label htmlFor="self-display-name" className="block text-[15px] font-medium leading-7 text-ink">
        我在微信里的显示名
      </label>
      <Input
        id="self-display-name"
        name="selfDisplayName"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          if (error) setError(null)
          setInvalid(false)
        }}
        autoFocus
        autoComplete="nickname"
        placeholder="例如：小丽"
        aria-describedby="self-display-name-hint"
        aria-invalid={invalid || undefined}
        className="mt-2 h-11 bg-paper px-3.5 text-[16px] md:text-[16px]"
      />
      <p id="self-display-name-hint" className="mt-2 text-[13px] leading-6 text-ink-3">
        在不同的群里用了不同的昵称，可以都填上，用顿号隔开。
      </p>
      {error && (
        <p role="alert" className="mt-3 border-l border-danger pl-3 text-[14px] leading-6 text-danger">
          {error}
        </p>
      )}
      <div className="mt-8 flex items-center gap-6">
        <Button type="submit" className="h-10 px-7" disabled={pending !== null}>
          {pending === 'save' ? '正在保存…' : '保存'}
        </Button>
        <button type="button" className="loam-text-button text-[14px] disabled:opacity-50" disabled={pending !== null} onClick={() => void submit('skip')}>
          {pending === 'skip' ? '正在跳过…' : '跳过'}
        </button>
      </div>
      <p className="mt-8 text-[13px] leading-6 text-ink-3">可以跳过。之后在设置里随时填写，导入时也可以直接指出哪一位是你。</p>
    </form>
  )
}
