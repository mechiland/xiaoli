'use client'

import { useSyncExternalStore } from 'react'
import { AttachmentUploadStatus } from '@/components/import-overlay'
import { subscribeUploads, uploadIdsKey } from '@/components/import-overlay/upload-store'

/** `?id=` samples plus every import this tab's upload runner knows (so a client-side navigation back shows live progress). */
export function UploadStatusSamples({ ids }: { ids: number[] }) {
  const key = useSyncExternalStore(subscribeUploads, uploadIdsKey, () => '')
  const running = key ? key.split(',').map(Number) : []
  const all = [...new Set([...ids, ...running])]
  if (all.length === 0) return <p className="text-[14px] text-ink-3">在地址后加上 ?id=导入编号，或在这一页导入一份聊天记录。</p>
  return (
    <div className="space-y-6">
      {all.map((id) => (
        <div key={id} data-upload-sample={id} className="border-b border-line pb-4">
          <p className="mb-1 font-data text-[12px] tracking-wide text-ink-3">导入 #{id}</p>
          <AttachmentUploadStatus importId={id} />
        </div>
      ))}
    </div>
  )
}
