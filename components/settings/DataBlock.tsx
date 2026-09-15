'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { DELETE_ALL_CONFIRM_TEXT } from '@/contracts'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, unwrap } from '@/lib/api-client'
import { FieldError, SettingRow } from './parts'

type ExportState = { phase: 'idle' } | { phase: 'working' } | { phase: 'done'; fileName: string } | { phase: 'error' }

function fileNameFrom(disposition: string | null): string {
  const m = disposition?.match(/filename="([^"]+)"/)
  return m?.[1] ?? 'xiaoli-export.json'
}

/** 数据：导出全部数据为 JSON；删除全部数据（需输入确认文字） (SPEC §9.11). */
export function DataBlock({ defaultDialogOpen = false }: { defaultDialogOpen?: boolean }) {
  const [exp, setExp] = useState<ExportState>({ phase: 'idle' })
  const [open, setOpen] = useState(defaultDialogOpen)
  const [deletedAt, setDeletedAt] = useState<number | null>(null)

  async function runExport() {
    setExp({ phase: 'working' })
    try {
      const res = await fetch('/api/export', { credentials: 'same-origin', cache: 'no-store' })
      if (!res.ok) throw new Error(`export ${res.status}`)
      const blob = await res.blob()
      const fileName = fileNameFrom(res.headers.get('content-disposition'))
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setExp({ phase: 'done', fileName })
    } catch {
      setExp({ phase: 'error' })
    }
  }

  return (
    <div data-settings-block="data">
      <SettingRow
        label="导出全部数据"
        align="control"
        status={
          <span aria-live="polite" className="block min-h-5 font-data text-[12px] leading-5" data-export-state={exp.phase}>
            {exp.phase === 'working' && <span className="text-ink-3">正在准备文件…</span>}
            {exp.phase === 'error' && (
              <span role="alert" className="text-danger">
                没有导出成功
              </span>
            )}
          </span>
        }
        hint="一个 JSON 文件，包括聊天、消息、人物、信息、证据和抽取记录。图片与视频只含文件信息，不含文件本身。"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="button" variant="outline" className="bg-paper" onClick={() => void runExport()} disabled={exp.phase === 'working'}>
            {exp.phase === 'working' ? '正在导出…' : exp.phase === 'error' ? '重新导出' : '导出为 JSON'}
          </Button>
          {exp.phase === 'done' && <span className="break-all font-data text-[12px] leading-5 text-ink-3">已下载 {exp.fileName}</span>}
        </div>
      </SettingRow>

      <SettingRow
        label="删除全部数据"
        align="control"
        hint="删除这个账户下的全部聊天记录、人物、信息和上传的图片。账户保留，之后可以重新导入。删除后无法恢复。"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="button" variant="outline" className="border-danger/40 bg-paper text-danger hover:bg-paper-hover hover:text-danger" onClick={() => setOpen(true)}>
            删除全部数据…
          </Button>
          {deletedAt !== null && (
            <span aria-live="polite" className="text-[13px] leading-6 text-ink-2" data-deleted-all>
              已删除全部数据
            </span>
          )}
        </div>
      </SettingRow>

      <DeleteAllDialog open={open} onOpenChange={setOpen} onDeleted={() => setDeletedAt(Date.now())} />
    </div>
  )
}

/** Typed-confirmation dialog. The confirm button is enabled only when the input equals "删除全部数据" exactly. */
export function DeleteAllDialog({ open, onOpenChange, onDeleted }: { open: boolean; onOpenChange: (open: boolean) => void; onDeleted: () => void }) {
  const qc = useQueryClient()
  const router = useRouter()
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  const matches = text === DELETE_ALL_CONFIRM_TEXT
  const mismatch = text.length > 0 && !matches

  function change(next: boolean) {
    if (pending) return
    if (!next) {
      setText('')
      setFailed(false)
    }
    onOpenChange(next)
  }

  async function confirm() {
    if (!matches || pending) return
    setPending(true)
    setFailed(false)
    try {
      await unwrap(await api.data.$delete({ json: { confirm: DELETE_ALL_CONFIRM_TEXT } }))
      setPending(false)
      setText('')
      onOpenChange(false)
      onDeleted()
      await qc.invalidateQueries()
      router.refresh()
    } catch {
      setPending(false)
      setFailed(true)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={change}>
      <AlertDialogContent className="gap-0 border-line bg-paper p-0 sm:max-w-[480px]" data-delete-all-dialog>
        <AlertDialogHeader className="place-items-start px-6 pb-2 pt-6 text-left sm:px-7 sm:pt-7">
          <AlertDialogTitle className="font-serif text-[20px] font-semibold leading-8 text-ink">删除全部数据</AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-[14px] leading-7 text-ink-2">
            这个账户下的全部聊天记录、人物、信息、证据和上传的图片都会被删除，账户本身保留。删除后无法恢复，建议先导出一份。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          className="px-6 pb-6 pt-4 sm:px-7 sm:pb-7"
          onSubmit={(e) => {
            e.preventDefault()
            void confirm()
          }}
        >
          <label htmlFor="delete-all-confirm" className="block text-[13px] leading-6 text-ink-2">
            请输入“<span className="text-ink">{DELETE_ALL_CONFIRM_TEXT}</span>”以确认
          </label>
          <Input
            id="delete-all-confirm"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (failed) setFailed(false)
            }}
            autoComplete="off"
            autoFocus
            disabled={pending}
            aria-invalid={mismatch ? true : undefined}
            aria-describedby="delete-all-hint"
            className="mt-2 bg-ground"
          />
          <p id="delete-all-hint" className="mt-2 min-h-6 text-[13px] leading-6 text-ink-3" data-confirm-state={matches ? 'match' : mismatch ? 'mismatch' : 'empty'}>
            {mismatch ? '输入的文字不一致' : matches ? '确认后立即删除' : ' '}
          </p>
          {failed && <FieldError className="mt-1">没有删除成功，数据仍在。请稍后再试。</FieldError>}
          <AlertDialogFooter className="mt-5 gap-2 border-t border-line pt-5">
            <AlertDialogCancel type="button" disabled={pending} className="bg-paper">
              取消
            </AlertDialogCancel>
            <Button
              type="submit"
              variant="destructive"
              disabled={!matches || pending}
              className="text-ink-inverse disabled:border disabled:border-line disabled:bg-paper-hover disabled:text-ink-3 disabled:opacity-100"
            >
              {pending ? '正在删除…' : '删除全部数据'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
