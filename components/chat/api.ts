'use client'
// Client fetchers for the chat page (owner: chat).
import type { ChatDetailResponse, ChatMessagesResponse } from '@/contracts'
import { api, unwrap } from '@/lib/api-client'
import { queryKeys } from '@/lib/query'

export interface MessagesParam {
  around?: number
  before?: number
  after?: number
  cursor?: number
  dir?: 'older' | 'newer'
  limit?: number
}

const s = (v: number | undefined) => (v === undefined ? undefined : String(v))

export async function fetchChatDetail(chatId: number): Promise<ChatDetailResponse> {
  return unwrap(await api.chats[':id'].$get({ param: { id: String(chatId) } })) as Promise<ChatDetailResponse>
}

export async function fetchChatMessages(chatId: number, p: MessagesParam): Promise<ChatMessagesResponse> {
  const res = await api.chats[':id'].messages.$get({
    param: { id: String(chatId) },
    query: { around: s(p.around), before: s(p.before), after: s(p.after), cursor: s(p.cursor), dir: p.dir, limit: s(p.limit) },
  })
  return unwrap(res) as Promise<ChatMessagesResponse>
}

export function chatDetailQuery(chatId: number) {
  return { queryKey: queryKeys.chat(chatId), queryFn: () => fetchChatDetail(chatId) }
}
