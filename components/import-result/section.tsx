'use client'
// One person's section: title link (+ "新"), "本节全部确认", groups 新人物 / 新信息 / 变化 / 别名与关系 / 日期 / 事件.

import Link from 'next/link'
import { useEffect, useId, useState, type ReactNode } from 'react'
import type { PersonRefDTO, ReviewItem } from '@/contracts'
import { PersonPicker } from '@/components/person-picker'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/cn'
import { personHref } from '@/lib/links'
import { useBulkAccept, useMergePerson, useRenamePerson } from './data'
import { byCategory, CATEGORY_LABEL, dateKindLabel, formatPartialDate, GROUP_TITLE, GROUPS, proposedItems, reviewItemKey, type GroupName, type ReviewSection } from './format'
import { ItemRow } from './rows'

export interface SectionProps {
  importId: number
  section: ReviewSection
  marks: Map<string, number>
  isFresh: (key: string) => boolean
}

type Chunk = { label: string; items: ReviewItem[] }

function chunksOf(g: GroupName, items: ReviewItem[]): Chunk[] {
  if (g === 'newClaims' || g === 'changes') return byCategory(items).map((c) => ({ label: CATEGORY_LABEL[c.category], items: c.items }))
  if (g === 'aliasesAndRelations') {
    const out: Chunk[] = []
    for (const it of items) {
      const label = it.type === 'handle' ? '别名' : '关系'
      const last = out[out.length - 1]
      if (last?.label === label) last.items.push(it)
      else out.push({ label, items: [it] })
    }
    return out
  }
  if (g === 'dates') return items.map((it) => ({ label: it.type === 'date' ? dateKindLabel(it.item) : '', items: [it] }))
  return items.map((it) => ({ label: it.type === 'event' ? formatPartialDate(it.item.happenedAt) || '时间不详' : '', items: [it] }))
}

export function PersonSection({ importId, section, marks, isFresh }: SectionProps) {
  const { person } = section
  const bulk = useBulkAccept(importId)
  const proposed = proposedItems(section)
  const titleId = useId()

  return (
    <section
      aria-labelledby={titleId}
      data-person-section={person.id}
      className={cn('pt-12 first:pt-9', isFresh(`section:${person.id}`) && 'animate-in fade-in-0 duration-700')}
    >
      <header className="flex items-baseline justify-between gap-4 border-b border-line pb-2.5">
        <h2 id={titleId} className="loam-section-title min-w-0 [overflow-wrap:anywhere]">
          <Link href={personHref(person.id)} className="decoration-line-strong decoration-1 underline-offset-[5px] hover:underline">
            {person.label}
          </Link>
          {person.isNew && (
            <span className="ml-2.5 inline-block -translate-y-[2px] rounded-[2px] border border-line-strong px-[5px] align-middle font-sans text-[12px] font-normal leading-[18px] tracking-normal text-ink-2">
              新
            </span>
          )}
        </h2>
        {proposed.length > 0 && (
          <button
            type="button"
            data-section-accept
            disabled={bulk.isPending}
            onClick={() => bulk.mutate({ items: proposed })}
            className="shrink-0 text-[13px] leading-6 text-ink-2 transition-colors hover:text-ink hover:underline hover:decoration-line-strong hover:underline-offset-4 disabled:text-ink-3"
          >
            {bulk.isPending ? '正在确认…' : '本节全部确认'}
          </button>
        )}
      </header>
      {bulk.isError && (
        <p role="alert" className="mt-2 text-[13px] text-ink-2">
          没有全部确认上 · <button type="button" className="loam-text-button" onClick={() => bulk.mutate({ items: proposed })}>重试</button>
        </p>
      )}

      {person.isNew && <NewPersonGroup importId={importId} person={person} />}

      {GROUPS.filter((g) => section[g].length > 0).map((g) => (
        <Group key={g} name={g} title={GROUP_TITLE[g]}>
          {chunksOf(g, section[g]).map((chunk, ci) => (
            <div key={ci} className="grid sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-x-5">
              <div className="pl-3 pt-2.5 text-[12px] leading-5 text-ink-3 sm:pl-0 sm:pt-[9px] sm:text-right">{chunk.label}</div>
              <ul>
                {chunk.items.map((it) => {
                  const key = reviewItemKey(it)
                  return (
                    <ItemRow
                      key={key}
                      importId={importId}
                      sectionPersonId={person.id}
                      it={it}
                      index={marks.get(`${person.id}:${key}`) ?? 0}
                      oldIndex={it.type === 'claim' && it.replaces ? marks.get(`old:${person.id}:${it.replaces.id}`) : undefined}
                      fresh={isFresh(key)}
                    />
                  )
                })}
              </ul>
            </div>
          ))}
        </Group>
      ))}
    </section>
  )
}

function Group({ name, title, children }: { name: string; title: string; children: ReactNode }) {
  return (
    <div data-group={name} className="mt-5">
      <h3 className="mb-0.5 font-sans text-[13px] font-medium leading-6 tracking-[0.08em] text-ink-2">{title}</h3>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

// ---- 新人物 -----------------------------------------------------------------------------------------------------

function NewPersonGroup({ importId, person }: { importId: number; person: PersonRefDTO }) {
  const rename = useRenamePerson(importId)
  const [value, setValue] = useState(person.label)
  const [saved, setSaved] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const inputId = useId()

  useEffect(() => setValue(person.label), [person.label])

  const commit = () => {
    const label = value.trim()
    if (!label || label === person.label) {
      setValue(person.label)
      return
    }
    setSaved(false)
    rename.mutate({ personId: person.id, label }, { onSuccess: () => setSaved(true) })
  }

  return (
    <Group name="newPerson" title="新人物">
      <div className="grid sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-x-5">
        <label htmlFor={inputId} className="pb-0.5 pl-3 pt-2 text-[12px] leading-5 text-ink-3 sm:pl-0 sm:pt-[9px] sm:text-right">
          名字
        </label>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-l border-transparent py-[5px] pl-3">
          <input
            id={inputId}
            data-person-label-input
            value={value}
            maxLength={60}
            disabled={rename.isPending}
            onChange={(e) => {
              setValue(e.target.value)
              setSaved(false)
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setValue(person.label)
                e.currentTarget.blur()
              }
            }}
            className="h-8 w-full min-w-0 border-0 border-b border-line-strong bg-transparent px-0 text-[15px] leading-7 text-ink outline-none transition-colors focus:border-ink-2 focus-visible:outline-none disabled:opacity-60 sm:w-60"
          />
          <span className="text-[13px] leading-6 text-ink-3" aria-live="polite">
            {rename.isPending ? '正在保存…' : rename.isError ? (rename.error.status === 501 ? '名字暂时改不了' : '没有保存上') : saved ? '已保存' : ''}
          </span>
          <button
            type="button"
            data-merge-open
            onClick={() => setMergeOpen(true)}
            className="ml-auto text-[13px] leading-6 text-ink-2 transition-colors hover:text-ink hover:underline hover:decoration-line-strong hover:underline-offset-4"
          >
            其实是……
          </button>
        </div>
      </div>
      <MergeDialog importId={importId} person={person} open={mergeOpen} onOpenChange={setMergeOpen} />
    </Group>
  )
}

function MergeDialog({ importId, person, open, onOpenChange }: { importId: number; person: PersonRefDTO; open: boolean; onOpenChange: (o: boolean) => void }) {
  const merge = useMergePerson(importId)
  const [target, setTarget] = useState<PersonRefDTO | null>(null)

  const close = (o: boolean) => {
    if (merge.isPending) return
    onOpenChange(o)
    if (!o) {
      setTarget(null)
      merge.reset()
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-merge-dialog showCloseButton={false} className="gap-0 rounded-[2px] border-line bg-paper p-0 sm:max-w-[440px]">
        <div className="px-5 pb-3 pt-5">
          <DialogTitle className="font-serif text-[19px] font-semibold leading-8 text-ink">{person.label}其实是……</DialogTitle>
          <DialogDescription className="mt-1 text-[14px] leading-6 text-ink-2">
            {target ? '合并后，这一节的条目都会归到对方名下。' : '选一个已有的人物，把这个新人物合并过去。'}
          </DialogDescription>
        </div>
        {target ? (
          <div className="border-t border-line px-5 pb-5 pt-4">
            <p className="text-[15px] leading-7 text-ink">
              把「{person.label}」合并到「{target.label}」？
            </p>
            {merge.isError && (
              <p role="alert" className="mt-2 border-l border-line-strong pl-3 text-[13px] leading-6 text-ink-2">
                没有合并成功{merge.error.message && merge.error.message !== '服务器出错了' ? `：${merge.error.message}` : ''}
              </p>
            )}
            <div className="mt-5 flex items-center justify-end gap-4 text-[14px]">
              <button type="button" disabled={merge.isPending} onClick={() => setTarget(null)} className="text-ink-2 hover:text-ink disabled:opacity-50">
                换一个
              </button>
              <button
                type="button"
                data-merge-confirm
                disabled={merge.isPending}
                onClick={() => merge.mutate({ fromId: person.id, intoId: target.id }, { onSuccess: () => close(false) })}
                className="h-8 rounded-[2px] bg-ink px-4 text-ink-inverse transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {merge.isPending ? '正在合并…' : '合并'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <PersonPicker
              variant="inline"
              value={null}
              autoFocus
              excludeIds={[person.id]}
              placeholder="搜索人物"
              onPick={(p) => p.kind === 'existing' && setTarget(p.person)}
              className="border-x-0 border-b-0"
            />
            <div className="flex justify-end border-t border-line px-5 py-3">
              <button type="button" onClick={() => close(false)} className="text-[14px] text-ink-2 hover:text-ink">
                取消
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
