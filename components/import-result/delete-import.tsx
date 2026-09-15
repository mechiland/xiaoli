'use client'
// "删除这次导入" (ARCHITECTURE §1.10): quiet foot button → AlertDialog → DELETE → invalidate → '/'.

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ApiClientError } from '@/lib/api-client'
import { queryKeys } from '@/lib/query'
import { deleteImportRequest } from './data'

export function DeleteImportControl({ importId, beforeDelete, onAbort }: { importId: number; beforeDelete?: () => Promise<void>; onAbort?: () => void }) {
  const qc = useQueryClient()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'stopping' | 'deleting'>('idle')
  const [error, setError] = useState<string | null>(null)

  const onOpenChange = (o: boolean) => {
    if (phase !== 'idle') return
    setOpen(o)
    if (!o) {
      setError(null)
      onAbort?.()
    }
  }

  const confirm = async () => {
    setError(null)
    setPhase('stopping')
    await beforeDelete?.()
    setPhase('deleting')
    try {
      await deleteImportRequest(importId)
    } catch (err) {
      setError(err instanceof ApiClientError && err.status > 0 && err.code !== 'internal' ? err.message : '服务器出错了')
      setPhase('idle')
      return
    }
    // this import's own queries would now 404: mark them stale without refetching while the page is still mounted
    const own = (key: readonly unknown[]) =>
      (key[0] === queryKeys.importDetail(importId)[0] || key[0] === queryKeys.importReview(importId)[0]) && key[1] === importId
    void qc.invalidateQueries({ predicate: (q) => own(q.queryKey), refetchType: 'none' })
    void qc.invalidateQueries({ predicate: (q) => !own(q.queryKey) })
    router.replace('/')
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        <button type="button" data-delete-import className="text-[13px] leading-6 text-ink-3 transition-colors hover:text-ink-2 hover:underline hover:decoration-line-strong hover:underline-offset-4">
          删除这次导入
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent data-delete-dialog className="gap-0 rounded-[2px] border-line bg-paper p-6 sm:max-w-[440px]">
        <AlertDialogHeader className="place-items-start gap-2 text-left">
          <AlertDialogTitle className="font-serif text-[19px] font-semibold leading-8 text-ink">删除这次导入？</AlertDialogTitle>
          <AlertDialogDescription className="text-[14px] leading-7 text-ink-2">
            这次导入首次带来的消息会被删除；只由这些消息支持的信息也会一起删除，还有其他证据的信息会保留。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="mt-4 border-l border-line-strong py-0.5 pl-3 text-[13px] leading-6 text-ink-2">
            没有删除成功：{error}
          </p>
        )}
        <AlertDialogFooter className="mt-6 flex-row justify-end gap-3">
          <AlertDialogCancel disabled={phase !== 'idle'} className="h-9 rounded-[2px] border-line bg-transparent px-4 text-[14px] font-normal text-ink-2 hover:bg-paper-hover hover:text-ink">
            取消
          </AlertDialogCancel>
          <button
            type="button"
            data-delete-confirm
            disabled={phase !== 'idle'}
            onClick={confirm}
            className="inline-flex h-9 items-center rounded-[2px] bg-danger px-4 text-[14px] text-ink-inverse transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {phase === 'stopping' ? '正在停止读取…' : phase === 'deleting' ? '正在删除…' : '删除'}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
