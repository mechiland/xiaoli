'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_HIGH_CONFIDENCE_THRESHOLD, type ExtractModel } from '@/contracts'
import { BlockError, Skeleton } from '@/components/loam'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePatchSettings, useSettingsQuery } from './hooks'
import { FieldError, SaveNote, SettingRow } from './parts'

const DEFAULT_VALUE = 'default'

/** Select options: null → "默认（deepseek-flash）"; an explicit 'deepseek-flash' is listed only while it is the saved value. */
export function modelOptions(current: ExtractModel | null): { value: string; label: string }[] {
  const options = [{ value: DEFAULT_VALUE, label: '默认（deepseek-flash）' }]
  if (current === 'deepseek-flash') options.push({ value: 'deepseek-flash', label: 'deepseek-flash' })
  options.push({ value: 'deepseek-v4-pro', label: 'deepseek-v4-pro' })
  return options
}

/** Parses the threshold field; returns the number (rounded to 2 decimals) or an error message. */
export function parseThreshold(raw: string): { value: number } | { error: string } {
  const text = raw.trim()
  if (!text) return { error: '请填 0.5 到 1 之间的数' }
  const n = Number(text)
  if (!Number.isFinite(n) || n < 0.5 || n > 1) return { error: '请填 0.5 到 1 之间的数' }
  return { value: Math.round(n * 100) / 100 }
}

function formatThreshold(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/** 抽取：模型选择；"高可信度"的阈值 (SPEC §9.11). */
export function ExtractBlock() {
  const q = useSettingsQuery()
  const model = usePatchSettings()
  const threshold = usePatchSettings()
  const saved = q.data?.highConfidenceThreshold
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (saved !== undefined) setDraft(formatThreshold(saved))
  }, [saved])

  function commitThreshold() {
    const parsed = parseThreshold(draft)
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    setError(null)
    setDraft(formatThreshold(parsed.value))
    if (parsed.value !== saved) threshold.save({ highConfidenceThreshold: parsed.value })
  }

  if (q.isError) {
    return (
      <div data-settings-block="extract" data-block-error>
        <BlockError onRetry={() => void q.refetch()} />
      </div>
    )
  }

  if (q.isPending) {
    return (
      <div aria-busy="true" data-settings-block="extract">
        {[0, 1].map((i) => (
          <SettingRow key={i} label={i === 0 ? '抽取模型' : '高可信度的阈值'}>
            <Skeleton className="h-9 w-56 max-w-full" />
            <Skeleton className="mt-3 h-3.5 w-72 max-w-full" />
          </SettingRow>
        ))}
      </div>
    )
  }

  const current = q.data?.extractModel ?? null
  return (
    <div data-settings-block="extract">
      <SettingRow
        label="抽取模型"
        htmlFor="extract-model"
        align="control"
        status={<SaveNote state={model.state} onRetry={model.retry} />}
        hint="只影响之后开始读取的聊天，已读过的不会重读。"
      >
        <Select
          value={current ?? DEFAULT_VALUE}
          onValueChange={(v) => model.save({ extractModel: v === DEFAULT_VALUE ? null : (v as ExtractModel) })}
        >
          <SelectTrigger id="extract-model" className="w-[260px] max-w-full bg-paper font-data text-[14px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start" className="bg-paper">
            {modelOptions(current).map((o) => (
              <SelectItem key={o.value} value={o.value} className="font-data text-[14px]">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow
        label="高可信度的阈值"
        htmlFor="high-confidence"
        align="control"
        status={<SaveNote state={threshold.state} onRetry={threshold.retry} />}
        hint={`导入结果页的“确认所有可信度高的条目”，只会确认可信度不低于这个值的信息。默认 ${DEFAULT_HIGH_CONFIDENCE_THRESHOLD}，可填 0.5 到 1。`}
      >
        <div className="flex items-center gap-4">
          <Input
            id="high-confidence"
            inputMode="decimal"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              if (error) setError(null)
            }}
            onBlur={commitThreshold}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitThreshold()
              }
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'high-confidence-error' : undefined}
            className="w-[96px] bg-paper font-data text-[14px] tabular-nums"
            autoComplete="off"
          />
          {saved !== undefined && saved !== DEFAULT_HIGH_CONFIDENCE_THRESHOLD && (
            <button
              type="button"
              className="loam-text-button text-[13px]"
              onClick={() => {
                setError(null)
                setDraft(formatThreshold(DEFAULT_HIGH_CONFIDENCE_THRESHOLD))
                threshold.save({ highConfidenceThreshold: DEFAULT_HIGH_CONFIDENCE_THRESHOLD })
              }}
            >
              恢复默认
            </button>
          )}
        </div>
        {error && (
          <FieldError id="high-confidence-error" className="mt-2.5">
            {error}
          </FieldError>
        )}
      </SettingRow>
    </div>
  )
}
