'use client'

import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ChatKind, ChatsListResponse, MappingRequest, MappingSuggestions } from '@/contracts'
import { PersonPicker, type PersonPick } from '@/components/person-picker'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/cn'
import { requestJson } from './http'

export type ChatChoice = { kind: 'existing'; chatId: number } | { kind: 'new' }

export interface MappingDraft {
  chat: ChatChoice
  newTitle: string
  newKind: ChatKind
  picks: Record<string, PersonPick | null>
  touched: Record<string, boolean>
}

type ChatRow = ChatsListResponse['chats'][number]

function defaultPick(s: MappingSuggestions['senders'][number], kind: ChatKind | null): PersonPick | null {
  if (s.suggested && 'self' in s.suggested) return { kind: 'self' }
  if (s.suggested) return { kind: 'existing', person: { id: s.suggested.personId, label: s.suggested.label } }
  return kind === 'private' ? { kind: 'new', label: s.senderName } : null
}

export function initialDraft(suggestions: MappingSuggestions, preselectChatId: number | null): MappingDraft {
  const strong = suggestions.chats.find((c) => c.score >= 1)
  const chat: ChatChoice = preselectChatId
    ? { kind: 'existing', chatId: preselectChatId }
    : strong
      ? { kind: 'existing', chatId: strong.id }
      : { kind: 'new' }
  const kind = (chat.kind === 'existing' ? (suggestions.chats.find((c) => c.id === chat.chatId)?.kind ?? null) : null) ?? suggestions.preselectKind ?? 'group'
  const others = suggestions.senders.filter((s) => !(s.suggested && 'self' in s.suggested))
  return {
    chat,
    newTitle: kind === 'private' && others.length === 1 ? others[0].senderName : '',
    newKind: suggestions.preselectKind ?? 'group',
    picks: Object.fromEntries(suggestions.senders.map((s) => [s.senderName, defaultPick(s, kind)])),
    touched: {},
  }
}

export function effectiveKind(draft: MappingDraft, chats: ChatRow[]): ChatKind {
  if (draft.chat.kind === 'new') return draft.newKind
  const id = draft.chat.chatId
  return chats.find((c) => c.id === id)?.kind ?? draft.newKind
}

export function buildMappingRequest(draft: MappingDraft, suggestions: MappingSuggestions): MappingRequest | null {
  if (draft.chat.kind === 'new' && !draft.newTitle.trim()) return null
  const senders: MappingRequest['senders'] = []
  for (const s of suggestions.senders) {
    const p = draft.picks[s.senderName]
    if (!p) return null
    senders.push({
      senderName: s.senderName,
      target: p.kind === 'self' ? { self: true } : p.kind === 'existing' ? { personId: p.person.id } : { newPerson: { label: p.label.slice(0, 60) } },
    })
  }
  return {
    chat: draft.chat.kind === 'existing' ? { existingChatId: draft.chat.chatId } : { new: { title: draft.newTitle.trim().slice(0, 80), kind: draft.newKind } },
    senders,
  }
}

export function useChatList(senders: string[]) {
  const key = senders.join(',')
  return useQuery({
    queryKey: ['import', 'chats', key],
    queryFn: () => requestJson<ChatsListResponse>('GET', `/api/chats?senders=${encodeURIComponent(key)}`),
    staleTime: 30_000,
  })
}

export function StepMapping({
  suggestions,
  draft,
  onChange,
  disabled,
}: {
  suggestions: MappingSuggestions
  draft: MappingDraft
  onChange: (d: MappingDraft) => void
  disabled?: boolean
}) {
  const senderNames = useMemo(() => suggestions.senders.map((s) => s.senderName), [suggestions])
  const list = useChatList(senderNames)
  const allChats: ChatRow[] = list.data?.chats ?? suggestions.chats
  const recommended = allChats.filter((c) => c.score > 0)
  const selectedExisting = draft.chat.kind === 'existing' ? draft.chat.chatId : null
  const others = allChats.filter((c) => c.score === 0)
  const [showOthers, setShowOthers] = useState(() => others.some((c) => c.id === selectedExisting))
  const kind = effectiveKind(draft, allChats)

  const setChat = (chat: ChatChoice) => {
    const nextKind = chat.kind === 'new' ? draft.newKind : (allChats.find((c) => c.id === chat.chatId)?.kind ?? draft.newKind)
    onChange(withKindDefaults({ ...draft, chat }, nextKind))
  }
  const withKindDefaults = (d: MappingDraft, k: ChatKind): MappingDraft => ({
    ...d,
    picks: Object.fromEntries(suggestions.senders.map((s) => [s.senderName, d.touched[s.senderName] ? d.picks[s.senderName] : defaultPick(s, k)])),
  })

  const pinnedRows = [...recommended, ...(showOthers ? others : others.filter((c) => c.id === selectedExisting))]

  return (
    <div className="space-y-8">
      <section aria-labelledby="map-chat">
        <h3 id="map-chat" className="mb-1 font-serif text-[16px] font-semibold">
          聊天
        </h3>
        <p className="mb-3 text-[13px] leading-6 text-ink-3">这些消息属于哪个聊天？已有聊天会按消息内容合并，重复的消息不会再存一遍。</p>
        <div role="radiogroup" aria-label="聊天" className="divide-y divide-line border-y border-line">
          {pinnedRows.map((c) => (
            <ChoiceRow key={c.id} checked={selectedExisting === c.id} onSelect={() => setChat({ kind: 'existing', chatId: c.id })} disabled={disabled}>
              <span className="min-w-0">
                <span className="text-[15px]">{c.title}</span>
                <span className="ml-2 font-data text-[12px] tabular-nums text-ink-3">
                  {c.kind === 'private' ? '私聊' : '群聊'} · {c.messageCount} 条
                </span>
                {c.matchReason && <span className="block text-[12px] leading-5 text-ink-3">{c.matchReason}</span>}
              </span>
            </ChoiceRow>
          ))}
          {others.length > 0 && !showOthers && (
            <div className="py-2">
              <button type="button" onClick={() => setShowOthers(true)} className="flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink" disabled={disabled}>
                {recommended.length ? '选择其他已有聊天' : '选择已有聊天'}
                <span className="font-data tabular-nums">（{others.length}）</span>
                <ChevronDown className="size-3.5" strokeWidth={1.5} aria-hidden />
              </button>
            </div>
          )}
          <ChoiceRow checked={draft.chat.kind === 'new'} onSelect={() => setChat({ kind: 'new' })} disabled={disabled}>
            <span className="text-[15px]">新建聊天</span>
          </ChoiceRow>
          {draft.chat.kind === 'new' && (
            <div className="grid gap-3 pb-4 pl-7 pt-1 sm:grid-cols-[1fr_auto] sm:items-center">
              <Input
                aria-label="聊天名称"
                placeholder={draft.newKind === 'group' ? '聊天名称，例如：家长群' : '聊天名称'}
                value={draft.newTitle}
                maxLength={80}
                disabled={disabled}
                onChange={(e) => onChange({ ...draft, newTitle: e.target.value })}
                className="h-9 bg-paper text-[14px]"
              />
              <div role="radiogroup" aria-label="聊天类型" className="flex h-9 w-fit justify-self-start border border-line text-[13px]">
                {(['private', 'group'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={draft.newKind === k}
                    disabled={disabled}
                    onClick={() => onChange(withKindDefaults({ ...draft, newKind: k }, k))}
                    className={cn('px-4 transition-colors', draft.newKind === k ? 'bg-ink text-paper' : 'text-ink-2 hover:bg-paper-hover')}
                  >
                    {k === 'private' ? '私聊' : '群聊'}
                  </button>
                ))}
              </div>
              {suggestions.preselectKind === 'private' && (
                <p className="text-[12px] leading-5 text-ink-3 sm:col-span-2">只有两个发送者，已预选为私聊；如果是群聊请改一下。</p>
              )}
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="map-senders">
        <h3 id="map-senders" className="mb-1 font-serif text-[16px] font-semibold">
          发送者
        </h3>
        <p className="mb-3 text-[13px] leading-6 text-ink-3">
          每个显示名是谁？{kind === 'private' ? '私聊中的对方默认新建为人物。' : '选好之后，抽取出的信息会记在对应的人物名下。'}
        </p>
        <ul className="divide-y divide-line border-y border-line">
          {suggestions.senders.map((s) => {
            const pick = draft.picks[s.senderName]
            return (
              <li key={s.senderName} className="grid gap-2 py-3 sm:grid-cols-[1fr_300px] sm:items-center sm:gap-6" data-sender-row={s.senderName}>
                <div className="min-w-0">
                  <span className="break-all text-[15px]">{s.senderName}</span>
                  <span className="ml-2 font-data text-[12px] tabular-nums text-ink-3">{s.count} 条</span>
                  {pick?.kind === 'self' && s.suggested && 'self' in s.suggested && <span className="block text-[12px] leading-5 text-ink-3">设置里登记的我的显示名</span>}
                  {pick?.kind === 'existing' && s.suggested && 'personId' in s.suggested && s.suggested.personId === pick.person.id && (
                    <span className="block text-[12px] leading-5 text-ink-3">{s.suggested.reason}</span>
                  )}
                </div>
                <PersonPicker
                  variant="select"
                  value={pick}
                  allowSelf
                  candidates={s.candidates}
                  allowCreate={{ defaultLabel: s.senderName }}
                  placeholder="选择是谁"
                  disabled={disabled}
                  onPick={(p) =>
                    onChange({ ...draft, picks: { ...draft.picks, [s.senderName]: p }, touched: { ...draft.touched, [s.senderName]: true } })
                  }
                />
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

function ChoiceRow({ checked, onSelect, disabled, children }: { checked: boolean; onSelect: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className="flex w-full items-start gap-3 py-2.5 text-left disabled:cursor-not-allowed"
    >
      <span
        aria-hidden
        className={cn('mt-[7px] grid size-3.5 shrink-0 place-items-center border', checked ? 'border-ink' : 'border-line-strong')}
      >
        {checked && <span className="size-1.5 bg-ink" />}
      </span>
      {children}
    </button>
  )
}
