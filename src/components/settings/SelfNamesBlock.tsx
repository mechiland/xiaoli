'use client'

import { useState, type FormEvent } from 'react'
import { BlockError, Skeleton } from '@/components/loam'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePatchSettings, useSettingsQuery } from './hooks'
import { FieldError, SaveNote, SettingRow } from './parts'

export const MAX_SELF_NAMES = 10
export const MAX_SELF_NAME_LENGTH = 40

/** Pure validation for a new display name; returns a Chinese message or null. */
export function validateSelfName(raw: string, existing: string[]): string | null {
  const name = raw.trim()
  if (!name) return '请填写显示名'
  if ([...name].length > MAX_SELF_NAME_LENGTH) return `显示名最多 ${MAX_SELF_NAME_LENGTH} 个字`
  if (existing.includes(name)) return '这个名字已经登记过了'
  if (existing.length >= MAX_SELF_NAMES) return `最多登记 ${MAX_SELF_NAMES} 个显示名`
  return null
}

/** 我：我在微信里的显示名，可添加多个 (SPEC §9.11). Saves on add/remove. */
export function SelfNamesBlock() {
  const q = useSettingsQuery()
  const patch = usePatchSettings()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const names = q.data?.selfDisplayNames ?? []
  const full = names.length >= MAX_SELF_NAMES

  if (q.isError) {
    return (
      <div data-settings-block="self" data-block-error>
        <BlockError onRetry={() => void q.refetch()} />
      </div>
    )
  }

  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const invalid = validateSelfName(draft, names)
    if (invalid) {
      setError(invalid)
      return
    }
    setError(null)
    patch.save({ selfDisplayNames: [...names, draft.trim()] })
    setDraft('')
  }

  function remove(name: string) {
    setError(null)
    patch.save({ selfDisplayNames: names.filter((n) => n !== name) })
  }

  return (
    <div data-settings-block="self">
      <SettingRow
        label="我在微信里的显示名"
        htmlFor="self-name-input"
        status={<SaveNote state={patch.state} onRetry={patch.retry} />}
        hint="导入聊天记录时，用这些名字发言的人会自动选为『我』。改过微信名的话，可以都登记上。"
      >
        {q.isPending ? (
          <div className="max-w-[420px] space-y-3 pt-1.5" aria-busy="true">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-5 h-9 w-full" />
          </div>
        ) : (
          <div className="max-w-[420px]">
            {names.length > 0 ? (
              <ul className="mb-4 border-b border-line" data-self-names>
                {names.map((name) => (
                  <li key={name} className="flex items-baseline justify-between gap-4 border-t border-line py-2 first:border-t-0 first:pt-0">
                    <span className="min-w-0 break-words text-[15px] leading-7 text-ink">{name}</span>
                    <button
                      type="button"
                      onClick={() => remove(name)}
                      disabled={patch.pending}
                      className="loam-text-button shrink-0 text-[13px] disabled:opacity-50"
                      aria-label={`移除 ${name}`}
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-[14px] leading-7 text-ink-2" data-self-names-empty>
                还没有登记。导入时需要手动指出哪位发送者是你。
              </p>
            )}
            <form onSubmit={add} noValidate className="flex gap-2">
              <Input
                id="self-name-input"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  if (error) setError(null)
                }}
                placeholder={full ? `已登记 ${MAX_SELF_NAMES} 个，先移除一个` : '添加一个显示名'}
                disabled={full}
                maxLength={MAX_SELF_NAME_LENGTH + 10}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'self-name-error' : undefined}
                className="bg-paper"
                autoComplete="off"
              />
              <Button type="submit" variant="outline" disabled={full || patch.pending} className="shrink-0 bg-paper">
                添加
              </Button>
            </form>
            {error && (
              <FieldError id="self-name-error" className="mt-2.5">
                {error}
              </FieldError>
            )}
          </div>
        )}
      </SettingRow>
    </div>
  )
}
