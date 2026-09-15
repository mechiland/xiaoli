'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { BlockError, SkeletonLines } from '@/components/loam'
import { cn } from '@/lib/cn'
import { personHref } from '@/lib/links'
import { queryKeys } from '@/lib/query'
import { splitTerms } from '@/server/search/text'
import { createPerson, fetchSearch } from './lib/fetchers'
import { Highlight } from './lib/Highlight'
import { activeIndexOf, hotkeyAction, isComposingKey, moveIndex, type TargetLike } from './lib/keys'
import { useDebouncedValue } from './lib/use-debounced-value'
import { closeSearch, getSearchOverlayState, openSearch, useSearchOverlayState } from './store'

const RESULT_LIMIT = 20

type Item =
  | { key: string; kind: 'person'; personId: number; label: string; alias: string | null }
  | { key: string; kind: 'claim'; personId: number; label: string; claimId: number; statement: string; highlights: [number, number][] }
  | { key: string; kind: 'create'; label: string }

/** Navigates in-app; a hash change on the current path goes through location.hash so `hashchange` fires for the person page. */
function go(router: ReturnType<typeof useRouter>, href: string) {
  closeSearch()
  const [path, hash] = href.split('#')
  if (hash && typeof window !== 'undefined' && window.location.pathname === path) {
    window.location.hash = hash
    return
  }
  router.push(href)
}

/** Mounted once by core in app/(app)/layout.tsx. Registers ⌘K / Ctrl K / "/" and renders the overlay (SPEC §9.8). */
export function SearchOverlayHost(): React.JSX.Element {
  const s = useSearchOverlayState()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const action = hotkeyAction(e, e.target as TargetLike | null)
      if (!action) return
      const open = getSearchOverlayState().isOpen
      if (action === 'toggle') {
        e.preventDefault()
        if (open) closeSearch()
        else openSearch()
      } else if (!open) {
        e.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <DialogPrimitive.Root open={s.isOpen} onOpenChange={(o) => (o ? openSearch() : closeSearch())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--loam-scrim)] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'fixed inset-0 z-50 flex flex-col bg-paper outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'sm:inset-auto sm:left-1/2 sm:top-[12vh] sm:max-h-[min(640px,76vh)] sm:w-[640px] sm:max-w-[calc(100vw-48px)] sm:-translate-x-1/2 sm:border sm:border-line',
          )}
        >
          <DialogPrimitive.Title className="sr-only">搜索</DialogPrimitive.Title>
          {s.isOpen && <SearchPanel key={s.openCount} initialQ={s.q} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function SearchPanel({ initialQ }: { initialQ: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (key: string) => `${baseId}-opt-${key}`

  const [input, setInput] = useState(initialQ)
  const [committed, setCommitted] = useState(initialQ) // input value outside IME composition
  const composing = useRef(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [pendingEnter, setPendingEnter] = useState(false)

  const trimmed = committed.trim()
  const debounced = useDebouncedValue(trimmed, 120)
  const enabled = trimmed.length > 0 && debounced.length > 0

  const search = useQuery({
    queryKey: queryKeys.search(debounced, 'all'),
    queryFn: ({ signal }) => fetchSearch(debounced, 'all', RESULT_LIMIT, signal),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
  const data = enabled ? search.data : undefined
  const fresh = Boolean(data) && data!.q === trimmed && !search.isPlaceholderData

  const create = useMutation({
    mutationFn: (label: string) => createPerson(label),
    onSuccess: ({ person }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.peopleIndex() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.home() })
      void queryClient.invalidateQueries({ queryKey: ['person'] })
      void queryClient.invalidateQueries({ queryKey: ['search'] })
      go(router, personHref(person.id))
    },
  })

  const items: Item[] = useMemo(() => {
    if (!data) return []
    const list: Item[] = [
      ...data.people.map((p) => ({ key: `p${p.person.id}`, kind: 'person' as const, personId: p.person.id, label: p.person.label, alias: p.matchedAlias })),
      ...data.claims.map((c) => ({
        key: `c${c.claimId}`,
        kind: 'claim' as const,
        personId: c.person.id,
        label: c.person.label,
        claimId: c.claimId,
        statement: c.statement,
        highlights: c.highlights,
      })),
    ]
    if (!list.length) list.push({ key: 'create', kind: 'create', label: data.q.trim().slice(0, 60) })
    return list
  }, [data])

  const keys = items.map((i) => i.key)
  const activeIndex = activeIndexOf(keys, activeKey)
  const active = activeIndex >= 0 ? items[activeIndex] : null
  const terms = data ? splitTerms(data.q) : []
  const people = items.filter((i): i is Extract<Item, { kind: 'person' }> => i.kind === 'person')
  const claimItems = items.filter((i): i is Extract<Item, { kind: 'claim' }> => i.kind === 'claim')
  const createItem = items.find((i): i is Extract<Item, { kind: 'create' }> => i.kind === 'create')

  function choose(item: Item) {
    if (item.kind === 'person') go(router, personHref(item.personId))
    else if (item.kind === 'claim') go(router, personHref(item.personId, { type: 'claim', id: item.claimId }))
    else if (!create.isPending) create.mutate(item.label)
  }

  // Enter pressed before the results for the latest keystroke arrived: act once they do.
  useEffect(() => {
    if (!pendingEnter || !fresh) return
    setPendingEnter(false)
    if (active) choose(active)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEnter, fresh])

  useEffect(() => {
    if (activeKey) document.getElementById(optionId(activeKey))?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey])

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (isComposingKey(e.nativeEvent)) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!items.length) return
      const next = moveIndex(activeIndex, e.key === 'ArrowDown' ? 1 : -1, items.length)
      setActiveKey(items[next].key)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!trimmed) return
      if (!fresh) setPendingEnter(true)
      else if (active) choose(active)
    }
  }

  const row = (item: Item, children: React.ReactNode, className?: string) => {
    const isActive = active?.key === item.key
    return (
      <div
        key={item.key}
        id={optionId(item.key)}
        role="option"
        aria-selected={isActive}
        data-active={isActive || undefined}
        onMouseMove={() => !isActive && setActiveKey(item.key)}
        onClick={() => choose(item)}
        className={cn(
          'relative cursor-pointer px-5 py-2.5 sm:py-2',
          isActive && 'bg-paper-hover before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-ink-2',
          className,
        )}
      >
        {children}
      </div>
    )
  }

  let body: React.ReactNode
  if (!trimmed) {
    body = <p className="px-5 py-8 text-[14px] leading-7 text-ink-3">输入人名、别名，或者记得的一句话。</p>
  } else if (search.isError && !search.isFetching) {
    body = (
      <div className="px-5 py-6">
        <BlockError message="搜索没有完成" onRetry={() => void search.refetch()} />
      </div>
    )
  } else if (!data) {
    body = (
      <div className="px-5 py-6" aria-label="正在搜索">
        <SkeletonLines lines={4} />
      </div>
    )
  } else if (createItem) {
    body = search.isPlaceholderData ? (
      <p className="px-5 py-8 text-[14px] text-ink-3">正在搜索…</p>
    ) : (
      <div role="listbox" id={listId} aria-label="搜索结果" className="pb-3">
        <p className="px-5 pb-3 pt-7 font-serif text-[17px] text-ink-2">没有找到</p>
        {row(
          createItem,
          <span className="text-[15px] text-ink">
            {create.isPending ? '正在新建…' : <>新建人物『{createItem.label}』</>}
          </span>,
        )}
        {create.isError && (
          <div className="px-5 pt-2">
            <BlockError message={`没有建成：${create.error.message}`} onRetry={() => create.mutate(createItem.label)} />
          </div>
        )}
      </div>
    )
  } else {
    body = (
      <div role="listbox" id={listId} aria-label="搜索结果" className={cn('pb-3', search.isPlaceholderData && 'opacity-70')}>
        {people.length > 0 && (
          <div role="group" aria-label="人物">
            <GroupTitle>人物</GroupTitle>
            {people.map((p) =>
              row(
                p,
                <div className="flex min-w-0 items-baseline gap-3">
                  <span className="min-w-0 truncate font-serif text-[16px] leading-7 text-ink">
                    <Highlight text={p.label} terms={terms} />
                  </span>
                  {p.alias && (
                    <span className="min-w-0 max-w-[45%] shrink-0 truncate text-[13px] text-ink-3">
                      又名 <Highlight text={p.alias} terms={terms} />
                    </span>
                  )}
                </div>,
              ),
            )}
          </div>
        )}
        {claimItems.length > 0 && (
          <div role="group" aria-label="信息">
            <GroupTitle>信息</GroupTitle>
            {claimItems.map((c) =>
              row(
                c,
                <p className="line-clamp-2 text-[15px] leading-7 text-ink">
                  <span className="text-[14px] text-ink-2">{c.label}</span>
                  <span className="px-1.5 text-ink-3">·</span>
                  <Highlight text={c.statement} ranges={c.highlights} />
                </p>,
              ),
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 sm:px-5">
        <Search className="size-[18px] shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
        <input
          autoFocus
          role="combobox"
          aria-label="搜索人物、别名或信息"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionId(active.key) : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={100}
          placeholder="搜索人物、别名或信息"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            if (!composing.current) setCommitted(e.target.value)
          }}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={(e) => {
            composing.current = false
            setCommitted(e.currentTarget.value)
          }}
          onKeyDown={onKeyDown}
          className="h-14 min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
        />
        <DialogPrimitive.Close className="loam-text-button shrink-0 text-[14px] sm:hidden">取消</DialogPrimitive.Close>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{body}</div>
      <div className="hidden shrink-0 items-center justify-between border-t border-line px-5 py-2 font-data text-[12px] text-ink-3 sm:flex">
        <span>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> 选择<span className="px-2" />
          <Kbd>Enter</Kbd> 打开<span className="px-2" />
          <Kbd>Esc</Kbd> 关闭
        </span>
        <span aria-live="polite">{enabled && search.isFetching ? '正在搜索…' : ''}</span>
      </div>
    </>
  )
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return <div className="px-5 pb-1 pt-4 font-serif text-[13px] tracking-[0.16em] text-ink-3">{children}</div>
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="mr-1 inline-block min-w-[18px] border border-line px-1 text-center font-data text-[11px] leading-[16px] text-ink-2">{children}</kbd>
}
