import { ChatNotFound, ChatPage } from '@/components/chat'

// /chats/:id?at=:msgId — read-only transcript (SPEC §9.10). Data loads per block on the client (DECISIONS chat C1).
export default async function ChatRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const chatId = /^[1-9]\d{0,15}$/.test(id) ? Number(id) : null
  const at = typeof sp.at === 'string' && /^[1-9]\d{0,15}$/.test(sp.at) ? Number(sp.at) : null
  if (chatId == null) return <ChatNotFound />
  // keyed by chat only: ChatPage re-windows itself when ?at= names a new message, and ignores ?at= disappearing
  // (跳到最早/最新 drop it from the address, which Next syncs back into these props)
  return <ChatPage key={chatId} chatId={chatId} at={at} />
}
