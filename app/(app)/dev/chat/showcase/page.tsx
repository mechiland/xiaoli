'use client'
// Fixture states of the chat page pieces (ARCHITECTURE §12 `chat/showcase`). Real-page states (at= highlight, paging,
// loading, error, not found, 5,000 messages) are exercised on /chats/:id by the scenario. Dev only (dev/layout.tsx).
import { useState } from 'react'
import { ChatHeaderError, ChatHeaderSkeleton, ChatHeaderView, ImageViewer, TranscriptList, TranscriptSkeleton, type OpenImage } from '@/components/chat'
import { Label, PageShell } from '@/components/loam'
import { Button } from '@/components/ui/button'
import { GROUP_DETAIL, GROUP_MESSAGES, HIGHLIGHT_ID, PRIVATE_DETAIL } from './fixtures'

const action = (
  <Button variant="outline" size="sm" className="shrink-0">
    导入新的记录
  </Button>
)

function Frame({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-16">
      <Label as="p" className="mb-4 border-b border-dashed border-line pb-1">
        {label}
      </Label>
      {children}
    </section>
  )
}

export default function ChatShowcasePage() {
  const [image, setImage] = useState<OpenImage | null>(null)
  return (
    <PageShell width="reading" className="pt-8 sm:pt-12">
      <Frame id="group" label="群聊 · 各种消息 · 目标消息加底色 · 未关联发送者 · 长消息">
        <ChatHeaderView detail={GROUP_DETAIL} action={action} />
        <TranscriptList messages={GROUP_MESSAGES} highlightId={HIGHLIGHT_ID} onOpenImage={(att, message) => setImage({ att, message })} />
      </Frame>
      <Frame id="private" label="私聊头部">
        <ChatHeaderView detail={PRIVATE_DETAIL} action={action} />
      </Frame>
      <Frame id="loading" label="加载中">
        <ChatHeaderSkeleton action={action} />
        <TranscriptSkeleton />
      </Frame>
      <Frame id="error" label="出错（头部与消息各自独立）">
        <ChatHeaderError action={action} onRetry={() => undefined} />
        <TranscriptList messages={GROUP_MESSAGES.slice(0, 4)} onOpenImage={() => undefined} />
      </Frame>
      <ImageViewer image={image} onClose={() => setImage(null)} />
    </PageShell>
  )
}
