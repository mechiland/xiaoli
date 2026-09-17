'use client'
// Public entry `@/components/person-picker` (ARCHITECTURE §2.8). Owner: search.
// Used by import overlay step 2 (variant 'select'), import-result "其实是……" and person "合并到其他人物" (variant 'inline').

import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { Check, ChevronDown, Search } from 'lucide-react'
import { useEffect, useId, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { PersonRefDTO } from '@/contracts'
import { BlockError } from '@/components/loam'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/cn'
import { queryKeys } from '@/lib/query'
import { normalize, normalizeQuery } from '@/server/search/text'
import { fetchSearch } from '@/components/search-overlay/lib/fetchers'
import { Highlight } from '@/components/search-overlay/lib/Highlight'
import { activeIndexOf, isComposingKey, moveIndex } from '@/components/search-overlay/lib/keys'
import { useDebouncedValue } from '@/components/search-overlay/lib/use-debounced-value'

export type PersonPick =
  | { kind: 'self' }
  | { kind: 'existing'; person: PersonRefDTO }
  | { kind: 'new'; label: string }

export interface PersonPickerCandidate {
  personId: number
  label: string
  /** e.g. "在『装修群』中也叫这个名字" */
  reason: string | null
}

export interface PersonPickerProps {
  value: PersonPick | null
  onPick: (pick: PersonPick) => void
  /** select: trigger button + popover (import mapping rows); inline: search box + list (dialogs) */
  variant: 'select' | 'inline'
  /** shown first, in order, with reason in small gray text */
  candidates?: PersonPickerCandidate[]
  /** default false; shows "我" as the first option */
  allowSelf?: boolean
  /** default false; last option "新建人物『<query || defaultLabel>』" */
  allowCreate?: false | { defaultLabel: string }
  /** e.g. the person being merged; self person and merged persons are always excluded from search results */
  excludeIds?: number[]
  /** default "搜索人物" */
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
}

type PeopleHit = { person: PersonRefDTO; matchedAlias: string | null }

/** GET /api/search?types=people, debounced 150 ms. */
export function usePersonSearch(q: string, opts?: { enabled?: boolean; limit?: number }): UseQueryResult<PeopleHit[]> {
  const limit = opts?.limit ?? 20
  const dq = useDebouncedValue(q.trim(), 150)
  return useQuery({
    queryKey: [...queryKeys.search(dq, 'people'), limit],
    queryFn: async ({ signal }) => (await fetchSearch(dq, 'people', limit, signal)).people,
    enabled: (opts?.enabled ?? true) && dq.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
}

function samePick(a: PersonPick | null, b: PersonPick | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'existing' && b.kind === 'existing') return a.person.id === b.person.id
  if (a.kind === 'new' && b.kind === 'new') return a.label === b.label
  return a.kind === 'self'
}

/** Trigger text for the select variant (ARCHITECTURE §2.8). */
export function pickLabel(value: PersonPick | null, placeholder = '搜索人物'): string {
  if (!value) return placeholder
  if (value.kind === 'self') return '我'
  if (value.kind === 'existing') return value.person.label
  return `新建：${value.label}`
}

export function PersonPicker(props: PersonPickerProps): React.JSX.Element {
  if (props.variant === 'select') return <SelectPicker {...props} />
  return <PickerPanel {...props} className={cn('border border-line bg-paper', props.className)} />
}

function SelectPicker(props: PersonPickerProps) {
  const [open, setOpen] = useState(false)
  const { value, placeholder, disabled, className, onPick } = props
  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          className={cn(
            'flex h-9 w-full min-w-0 items-center justify-between gap-2 border border-line bg-paper px-3 text-left text-[14px] transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-60',
            value ? 'text-ink' : 'text-ink-3',
            open && 'border-line-strong',
            className,
          )}
        >
          <span className="min-w-0 truncate">{pickLabel(value, placeholder)}</span>
          <ChevronDown className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-[max(var(--radix-popover-trigger-width),300px)] max-w-[calc(100vw-32px)] p-0">
        <PickerPanel
          {...props}
          autoFocus
          className=""
          onPick={(p) => {
            onPick(p)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

type Opt = { key: string; pick: PersonPick; label: string; reason: string | null; kind: 'self' | 'candidate' | 'result' | 'create' }

function PickerPanel({
  value,
  onPick,
  candidates = [],
  allowSelf = false,
  allowCreate = false,
  excludeIds = [],
  placeholder = '搜索人物',
  disabled,
  autoFocus,
  className,
}: PersonPickerProps) {
  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (key: string) => `${baseId}-opt-${key}`
  const [input, setInput] = useState('')
  const [committed, setCommitted] = useState('')
  const [composing, setComposing] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)

  const qTrim = committed.trim()
  const qn = normalizeQuery(qTrim)
  const search = usePersonSearch(qTrim, { enabled: !disabled })
  const exclude = new Set(excludeIds)
  const cands = candidates.filter((c) => !exclude.has(c.personId))

  const opts: Opt[] = []
  if (allowSelf && (!qn || '我自己'.includes(qn) || 'wo'.startsWith(qn))) opts.push({ key: 'self', pick: { kind: 'self' }, label: '我', reason: null, kind: 'self' })
  // A candidate matches by its label, or because the search found it (e.g. through an alias) — then the alias is its reason.
  // Results of a previous query (placeholder data) are never offered: in a picker a stale match is a wrong pick.
  const current = qn && search.data && !search.isPlaceholderData ? search.data : []
  const aliasOf = new Map(current.map((r) => [r.person.id, r.matchedAlias] as const))
  const candMatches = qn ? cands.filter((c) => normalize(c.label).includes(qn) || aliasOf.has(c.personId)) : cands
  for (const c of candMatches) {
    const alias = qn && !normalize(c.label).includes(qn) ? aliasOf.get(c.personId) : null
    opts.push({ key: `c${c.personId}`, pick: { kind: 'existing', person: { id: c.personId, label: c.label } }, label: c.label, reason: alias ? `又名 ${alias}` : c.reason, kind: 'candidate' })
  }
  const results = qn ? current.filter((r) => !exclude.has(r.person.id) && !cands.some((c) => c.personId === r.person.id)) : []
  for (const r of results)
    opts.push({ key: `p${r.person.id}`, pick: { kind: 'existing', person: r.person }, label: r.person.label, reason: r.matchedAlias ? `又名 ${r.matchedAlias}` : null, kind: 'result' })
  if (allowCreate) {
    const label = (qTrim || allowCreate.defaultLabel).slice(0, 60)
    if (label) opts.push({ key: 'create', pick: { kind: 'new', label }, label, reason: null, kind: 'create' })
  }

  const keys = opts.map((o) => o.key)
  const activeIndex = activeIndexOf(keys, activeKey)
  const active = activeIndex >= 0 ? opts[activeIndex] : null
  const searching = Boolean(qn) && !disabled
  const fresh = !search.isPlaceholderData && !search.isFetching
  const showEmpty = searching && search.isSuccess && fresh && results.length === 0 && candMatches.length === 0
  // the active row is only marked while the user is in the picker (keyboard focus or pointer)
  const [focused, setFocused] = useState(false)
  const [hovering, setHovering] = useState(false)
  const statusLines = (
    <>
      {searching && search.isError && !search.isFetching && (
        <div className="px-3 py-2">
          <BlockError message="没有查到" onRetry={() => void search.refetch()} />
        </div>
      )}
      {searching && (search.isPending || search.isPlaceholderData) && !search.isError && (
        <p className="px-3 py-2 text-[13px] text-ink-3" aria-busy="true">
          正在查找…
        </p>
      )}
    </>
  )

  useEffect(() => {
    if (activeKey) document.getElementById(optionId(activeKey))?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey])

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (isComposingKey(e.nativeEvent)) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!opts.length) return
      setActiveKey(opts[moveIndex(activeIndex, e.key === 'ArrowDown' ? 1 : -1, opts.length)].key)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (active && !disabled) onPick(active.pick)
    } else if (e.key === 'Escape' && input) {
      // first Esc clears the query; the next one closes the surrounding popover/dialog
      e.preventDefault()
      e.stopPropagation()
      setInput('')
      setCommitted('')
    }
  }

  return (
    <div className={cn('flex min-w-0 flex-col', disabled && 'opacity-60', className)}>
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
        <input
          autoFocus={autoFocus}
          disabled={disabled}
          role="combobox"
          aria-label={placeholder}
          aria-expanded={opts.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionId(active.key) : undefined}
          autoComplete="off"
          spellCheck={false}
          maxLength={60}
          placeholder={placeholder}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            if (!composing) setCommitted(e.target.value)
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(e) => {
            setComposing(false)
            setCommitted(e.currentTarget.value)
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="h-10 min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none disabled:cursor-not-allowed"
        />
      </div>
      <div id={listId} role="listbox" aria-label="人物" className="max-h-[min(320px,50vh)] overflow-y-auto overscroll-contain py-1" onMouseLeave={() => setHovering(false)}>
        {opts.map((o, i) => {
          const isActive = active?.key === o.key && (focused || hovering)
          const selected = samePick(o.pick, value)
          const divider = (o.kind === 'create' || o.kind === 'result') && i > 0 && opts[i - 1].kind !== o.kind && (o.kind === 'create' || opts[i - 1].kind !== 'result')
          return (
            <div key={o.key}>
              {o.kind === 'create' && statusLines}
              {divider && <div role="presentation" className="mx-3 my-1 border-t border-line" />}
              {o.kind === 'create' && showEmpty && <p className="px-3 pb-1 pt-1.5 text-[13px] text-ink-3">没有找到</p>}
              <div
                id={optionId(o.key)}
                role="option"
                aria-selected={selected}
                data-active={isActive || undefined}
                onMouseMove={() => {
                  if (!hovering) setHovering(true)
                  if (!isActive) setActiveKey(o.key)
                }}
                onClick={() => !disabled && onPick(o.pick)}
                className={cn(
                  'relative flex cursor-pointer items-baseline gap-2.5 px-3 py-[7px] text-[14px] leading-6',
                  isActive && 'bg-paper-hover before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-ink-2',
                )}
              >
                <span className={cn('min-w-0 truncate', o.kind === 'create' ? 'text-ink-2' : 'text-ink')}>
                  {o.kind === 'create' ? `新建人物『${o.label}』` : <Highlight text={o.label} terms={o.kind === 'self' || !qn ? [] : [qn]} />}
                </span>
                {o.reason && <span className="min-w-0 truncate text-[12px] text-ink-3">{o.reason}</span>}
                {selected && <Check className="ml-auto size-3.5 shrink-0 self-center text-ink-2" strokeWidth={1.75} aria-label="已选" />}
              </div>
            </div>
          )
        })}
        {!opts.some((o) => o.kind === 'create') && statusLines}
        {showEmpty && !allowCreate && <p className="px-3 py-2 text-[13px] text-ink-3">没有找到</p>}
        {!opts.length && !searching && <p className="px-3 py-2 text-[13px] text-ink-3">输入名字或别名查找</p>}
      </div>
    </div>
  )
}
