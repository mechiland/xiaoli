'use client'

import { useQueryClient } from '@tanstack/react-query'
import { Check, Ellipsis } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { EvidenceMark, EvidenceRow } from '@/components/evidence'
import { PageTitle } from '@/components/loam'
import { PersonPicker, type PersonPick } from '@/components/person-picker'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { HandleDTO, ProfileResponse } from '@/contracts'
import { cn } from '@/lib/cn'
import { anchorId, homeHref, personHref } from '@/lib/links'
import { queryKeys } from '@/lib/query'
import { errorText, personApi, useAction, useRefreshAfterChange, type ProfileResult } from './api'
import { ALIAS_GROUPS } from './format'
import { InlineError, TextButton } from './Statement'

type MarkOf = (type: 'claim' | 'relation' | 'date' | 'event' | 'handle', id: number) => number

/** Confirmed alias values for the "又名" line, de-duplicated, without the label itself. */
export function confirmedAliasValues(p: ProfileResponse): string[] {
  const seen = new Set<string>([p.person.label])
  const out: string[] = []
  for (const g of ALIAS_GROUPS)
    for (const kind of g.kinds)
      for (const h of p.aliases.find((a) => a.kind === kind)?.items ?? [])
        if (h.status === 'confirmed' && !seen.has(h.value)) {
          seen.add(h.value)
          out.push(h.value)
        }
  return out
}

export function PersonHeader({
  profile,
  markOf,
  aliasesOpen,
  onAliasesOpenChange,
}: {
  profile: ProfileResponse
  markOf: MarkOf
  aliasesOpen: boolean
  onAliasesOpenChange: (v: boolean) => void
}) {
  const values = confirmedAliasValues(profile)
  const hasAny = profile.aliases.some((g) => g.items.length > 0)
  const p = profile.person
  return (
    <header className="mb-8 border-b border-line pb-5 lg:mb-10" data-block="title">
      <div className="flex items-start justify-between gap-4">
        <PageTitle className="min-w-0 [overflow-wrap:anywhere] [text-wrap:pretty]">{p.label}</PageTitle>
        <div className="flex shrink-0 items-center gap-1 pt-1.5 sm:pt-2.5">
          {!p.isSelf && <PinToggle profile={profile} />}
          <PageTools profile={profile} />
        </div>
      </div>
      {hasAny && (
        <p className="mt-1.5 text-[13px] leading-6 text-ink-3">
          <button
            type="button"
            aria-expanded={aliasesOpen}
            aria-controls="alias-panel"
            onClick={() => onAliasesOpenChange(!aliasesOpen)}
            className="text-left underline decoration-transparent underline-offset-[3px] hover:text-ink-2 hover:decoration-line-strong [overflow-wrap:anywhere]"
          >
            {values.length > 0 ? `又名：${values.join('、')}` : '查看别名'}
          </button>
        </p>
      )}
      {aliasesOpen && hasAny && <AliasPanel profile={profile} markOf={markOf} />}
    </header>
  )
}

function AliasPanel({ profile, markOf }: { profile: ProfileResponse; markOf: MarkOf }) {
  const groups = ALIAS_GROUPS.map((g) => ({
    label: g.label,
    items: g.kinds.flatMap((k) => profile.aliases.find((a) => a.kind === k)?.items ?? []),
  })).filter((g) => g.items.length > 0)
  return (
    <div id="alias-panel" className="mt-3 border-t border-line pt-3">
      <dl className="grid grid-cols-1 gap-y-3 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-x-4">
        {groups.map((g) => (
          <div key={g.label} className="contents">
            <dt className="text-[13px] leading-7 text-ink-3">{g.label}</dt>
            <dd className="min-w-0">
              <ul className="space-y-0.5">
                {g.items.map((h) => (
                  <HandleRow key={h.id} h={h} mark={markOf('handle', h.id)} />
                ))}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function HandleRow({ h, mark }: { h: HandleDTO; mark: number }) {
  const act = useAction()
  const proposed = h.status === 'proposed'
  const review = (action: 'accept' | 'reject') => act.run(() => personApi.review('handle', h.id, { action }), { evidence: [{ type: 'handle', id: h.id }] })
  return (
    <EvidenceRow
      as="li"
      id={anchorId('handle', h.id)}
      className={cn('border-l pl-[10px] text-[14px] leading-7 transition-colors duration-700 [overflow-wrap:anywhere]', proposed ? 'border-proposed text-ink-2' : 'border-transparent text-ink', act.pending && 'opacity-60')}
    >
      <span>{h.value}</span>
      <EvidenceMark target={{ type: 'handle', id: h.id }} index={mark} sourceKind={h.sourceKind} evidenceCount={h.evidenceCount} />
      <span className="ml-2 text-[12px] text-ink-3">{h.chatTitle ? `『${h.chatTitle}』` : '所有聊天'}</span>
      {proposed && (
        <span className="ml-3 inline-flex items-baseline gap-2 whitespace-nowrap">
          <TextButton disabled={act.pending} onClick={() => void review('accept')}>
            确认
          </TextButton>
          <span className="text-[12px] text-ink-3">/</span>
          <TextButton disabled={act.pending} onClick={() => void review('reject')}>
            不对
          </TextButton>
        </span>
      )}
      {act.error && <InlineError message={act.error} />}
    </EvidenceRow>
  )
}

function PinToggle({ profile }: { profile: ProfileResponse }) {
  const qc = useQueryClient()
  const refresh = useRefreshAfterChange()
  const [error, setError] = useState(false)
  const p = profile.person
  const key = queryKeys.person(p.id)
  const toggle = async () => {
    const next = !p.pinned
    setError(false)
    qc.setQueryData<ProfileResult>(key, (old) => (old && 'person' in old ? { ...old, person: { ...old.person, pinned: next } } : old))
    try {
      await personApi.patch(p.id, { pinned: next })
      await refresh()
    } catch {
      qc.setQueryData<ProfileResult>(key, (old) => (old && 'person' in old ? { ...old, person: { ...old.person, pinned: !next } } : old))
      setError(true)
    }
  }
  return (
    <button
      type="button"
      aria-pressed={p.pinned}
      onClick={() => void toggle()}
      title={error ? '没有保存成功，再点一次' : undefined}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-[2px] border px-3 text-[13px] transition-colors',
        p.pinned ? 'border-line-strong bg-paper-hover text-ink' : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
        error && 'border-danger/50',
      )}
    >
      {p.pinned && <Check className="size-3.5" strokeWidth={1.75} aria-hidden />}
      {p.pinned ? '已关注' : '关注'}
    </button>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// "⋯" page tools: merge, split alias, delete

type Tool = 'merge' | 'split' | 'delete' | null

function PageTools({ profile }: { profile: ProfileResponse }) {
  const [tool, setTool] = useState<Tool>(null)
  const p = profile.person
  const handles = profile.aliases.flatMap((g) => g.items)
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="页面工具" className="inline-flex size-8 items-center justify-center rounded-[2px] text-ink-2 transition-colors hover:bg-paper-hover hover:text-ink data-[state=open]:bg-paper-hover">
            <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[168px] rounded-[2px] border-line bg-paper p-1 text-[14px]">
          <DropdownMenuItem disabled={p.isSelf} onSelect={() => setTool('merge')}>
            合并到其他人物
          </DropdownMenuItem>
          <DropdownMenuItem disabled={handles.length === 0} onSelect={() => setTool('split')}>
            拆出别名
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-line" />
          <DropdownMenuItem disabled={p.isSelf} onSelect={() => setTool('delete')} className="text-danger focus:text-danger">
            删除此人
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {tool === 'merge' && <MergeDialog profile={profile} onClose={() => setTool(null)} />}
      {tool === 'split' && <SplitDialog profile={profile} onClose={() => setTool(null)} />}
      {tool === 'delete' && <DeleteDialog profile={profile} onClose={() => setTool(null)} />}
    </>
  )
}

const dialogCls = 'gap-0 rounded-[2px] border-line bg-paper p-0 sm:max-w-[500px]'
const primaryBtn =
  'inline-flex h-8 items-center rounded-[2px] bg-ink px-3.5 text-[13px] text-ink-inverse transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40'
const dangerBtn =
  'inline-flex h-8 items-center rounded-[2px] bg-danger px-3.5 text-[13px] text-ink-inverse transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40'
const secondaryBtn = 'inline-flex h-8 items-center rounded-[2px] border border-line px-3.5 text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40'

function DialogHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="px-5 pt-5 pb-4">
      <DialogTitle className="font-serif text-[18px] font-semibold leading-7 text-ink">{title}</DialogTitle>
      {children && <DialogDescription className="mt-1.5 text-[13px] leading-6 text-ink-3">{children}</DialogDescription>}
    </div>
  )
}

function MergeDialog({ profile, onClose }: { profile: ProfileResponse; onClose: () => void }) {
  const router = useRouter()
  const refresh = useRefreshAfterChange()
  const [pick, setPick] = useState<PersonPick | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const p = profile.person
  const into = pick?.kind === 'existing' ? pick.person : null

  const submit = async () => {
    if (!into) return
    setPending(true)
    setError(null)
    try {
      await personApi.merge(p.id, into.id)
      await refresh()
      router.replace(personHref(into.id))
    } catch (e) {
      setPending(false)
      setError(errorText(e, '没有合并成功'))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className={dialogCls} showCloseButton={false} aria-describedby={undefined}>
        <DialogHead title="合并到其他人物">
          {into ? (
            <>
              『{p.label}』的别名、信息、关系和证据都会归到『{into.label}』名下，『{p.label}』这一页之后会打开『{into.label}』。
            </>
          ) : (
            <>选一个人，『{p.label}』会并入 TA 的档案。</>
          )}
        </DialogHead>
        {into ? (
          <div className="border-t border-line px-5 py-3 text-[14px] leading-7 text-ink">
            {p.label}
            <span className="px-2 text-ink-3">→</span>
            {into.label}
            <button type="button" onClick={() => setPick(null)} disabled={pending} className="ml-3 text-[13px] text-ink-3 underline decoration-line underline-offset-[3px] hover:text-ink-2">
              换一个
            </button>
          </div>
        ) : (
          <div data-merge-picker className="border-t border-line">
            <PersonPicker variant="inline" value={pick} onPick={setPick} excludeIds={[p.id]} autoFocus placeholder="搜索人物或别名" className="border-x-0 border-b-0" />
          </div>
        )}
        {error && (
          <div className="px-5">
            <InlineError message={error} />
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={pending}>
            取消
          </button>
          <button type="button" className={primaryBtn} disabled={!into || pending} onClick={() => void submit()}>
            {pending ? '正在合并…' : '合并'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SplitDialog({ profile, onClose }: { profile: ProfileResponse; onClose: () => void }) {
  const refresh = useRefreshAfterChange()
  const router = useRouter()
  const [handleId, setHandleId] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ id: number; label: string; candidates: number } | null>(null)
  const p = profile.person
  const groups = ALIAS_GROUPS.map((g) => ({ label: g.label, items: g.kinds.flatMap((k) => profile.aliases.find((a) => a.kind === k)?.items ?? []) })).filter((g) => g.items.length > 0)

  const submit = async () => {
    if (handleId == null) return
    setPending(true)
    setError(null)
    try {
      const r = await personApi.split(p.id, { handleId })
      await refresh()
      setResult({ id: r.person.id, label: r.person.label, candidates: r.movedEvidenceCandidates.length })
    } catch (e) {
      setError(errorText(e, '没有拆出来'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className={dialogCls} showCloseButton={false} aria-describedby={undefined}>
        {result ? (
          <>
            <DialogHead title="已经拆出来了">
              『{result.label}』现在是一个单独的人物。
              {result.candidates > 0 ? `只由这个名字的发言支持的信息变回了未确认，留在『${p.label}』这一页等你确认。` : ''}
            </DialogHead>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
              <button type="button" className={secondaryBtn} onClick={() => router.push(personHref(result.id))}>
                打开『{result.label}』
              </button>
              <button type="button" className={primaryBtn} onClick={onClose}>
                完成
              </button>
            </div>
          </>
        ) : (
          <>
            <DialogHead title="拆出别名">选一个其实属于另一个人的名字，它会成为一个新的人物。</DialogHead>
            <div role="radiogroup" aria-label="别名" className="max-h-[min(360px,55vh)] overflow-y-auto border-t border-line px-5 py-3">
              {groups.map((g) => (
                <fieldset key={g.label} className="mb-3 last:mb-0">
                  <legend className="mb-1 text-[12px] leading-5 text-ink-3">{g.label}</legend>
                  {g.items.map((h) => (
                    <label key={h.id} className="flex cursor-pointer items-baseline gap-2.5 py-1 text-[14px] leading-6 text-ink">
                      <input type="radio" name="split-handle" checked={handleId === h.id} onChange={() => setHandleId(h.id)} className="translate-y-[1px] accent-[var(--loam-ink)]" />
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {h.value}
                        <span className="ml-2 text-[12px] text-ink-3">{h.chatTitle ? `『${h.chatTitle}』` : '所有聊天'}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            {error && (
              <div className="px-5">
                <InlineError message={error} />
              </div>
            )}
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
              <button type="button" className={secondaryBtn} onClick={onClose} disabled={pending}>
                取消
              </button>
              <button type="button" className={primaryBtn} disabled={handleId == null || pending} onClick={() => void submit()}>
                {pending ? '正在拆出…' : '拆出为新人物'}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DeleteDialog({ profile, onClose }: { profile: ProfileResponse; onClose: () => void }) {
  const router = useRouter()
  const qc = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const p = profile.person
  const submit = async () => {
    setPending(true)
    setError(null)
    try {
      await personApi.remove(p.id)
      qc.removeQueries({ queryKey: queryKeys.person(p.id) })
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['person'] }),
        qc.invalidateQueries({ queryKey: queryKeys.home() }),
        qc.invalidateQueries({ queryKey: queryKeys.peopleIndex() }),
        qc.invalidateQueries({ queryKey: ['search'] }),
      ])
      router.replace(homeHref)
    } catch (e) {
      setPending(false)
      setError(errorText(e, '没有删除成功'))
    }
  }
  return (
    <AlertDialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <AlertDialogContent className="gap-0 rounded-[2px] border-line bg-paper p-0 sm:max-w-[460px]">
        <div className="px-5 pt-5 pb-4">
          <AlertDialogTitle className="font-serif text-[18px] font-semibold leading-7 text-ink">删除『{p.label}』？</AlertDialogTitle>
          <AlertDialogDescription className="mt-1.5 text-[13px] leading-6 text-ink-3">
            TA 的别名、信息、日期、关系和对应的证据会一起删除，不能恢复。聊天记录会保留，发送者显示为原来的名字。
          </AlertDialogDescription>
          {error && <InlineError message={error} />}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={pending}>
            取消
          </button>
          <button type="button" className={dangerBtn} onClick={() => void submit()} disabled={pending}>
            {pending ? '正在删除…' : '删除'}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
