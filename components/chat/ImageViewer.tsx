'use client'
// Enlarged image (SPEC §9.10 "点击放大"). Below sm the viewer fills the screen so the image is always far larger than
// its 180 px thumbnail; from sm up it is a framed dialog up to 880 px wide. DECISIONS chat C8. Owner: chat.
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { AttachmentDTO, MessageDTO } from '@/contracts'
import { formatMsgTime } from '@/lib/time'

export interface OpenImage {
  att: AttachmentDTO
  message: MessageDTO
}

export function ImageViewer({ image, onClose }: { image: OpenImage | null; onClose: () => void }) {
  return (
    <Dialog open={image !== null} onOpenChange={(open) => !open && onClose()}>
      {image && (
        <DialogContent
          aria-describedby={undefined}
          data-chat-image-viewer
          className={[
            // phone: full screen, header / image / file name
            'h-dvh w-screen max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 rounded-none border-0 bg-paper p-0',
            'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]',
            // sm+: framed dialog sized by the image
            'sm:h-auto sm:w-auto sm:max-w-[min(92vw,1040px)] sm:grid-rows-none sm:gap-2.5 sm:rounded-[2px] sm:border sm:border-line sm:p-4',
          ].join(' ')}
        >
          <DialogTitle className="border-b border-line px-4 py-3 pr-12 font-sans text-[13px] leading-6 font-normal tracking-normal text-ink-2 sm:border-0 sm:p-0 sm:pr-8">
            <span className="font-data whitespace-nowrap tabular-nums text-ink-3">{formatMsgTime(image.message.sentAt, 'full')}</span>
            <span className="px-1.5 text-ink-3" aria-hidden>
              ·
            </span>
            <span className="whitespace-nowrap">{image.message.senderLabel ?? image.message.senderName}</span>
          </DialogTitle>
          <div className="flex min-h-0 items-center justify-center sm:block">
            {/* eslint-disable-next-line @next/next/no-img-element -- owner-checked stream */}
            <img
              src={image.att.url!}
              alt={image.att.fileName ?? '图片'}
              className="block max-h-full w-full object-contain sm:mx-auto sm:h-auto sm:max-h-[calc(100dvh-9rem)] sm:w-[min(880px,calc(92vw-2rem))] sm:max-w-full"
            />
          </div>
          {image.att.fileName ? (
            <p className="truncate border-t border-line px-4 py-3 font-data text-[12px] leading-5 text-ink-3 sm:border-0 sm:p-0">{image.att.fileName}</p>
          ) : (
            <span aria-hidden />
          )}
        </DialogContent>
      )}
    </Dialog>
  )
}
