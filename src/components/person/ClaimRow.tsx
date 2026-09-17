'use client'

import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { EvidenceMark, EvidenceRow } from '@/components/evidence'
import type { ClaimDTO } from '@/contracts'
import { cn } from '@/lib/cn'
import { anchorId } from '@/lib/links'
import { personApi, useAction } from './api'
import { formatPartialDate, markClassFor, sentence } from './format'
import { Gap, InlineError, Statement, TextButton } from './Statement'

type Mode = 'view' | 'edit' | 'outdated' | 'delete'

const inputCls =
  'h-9 w-full min-w-0 rounded-[2px] border border-line-strong bg-paper px-3 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-3 focus-visible:border-ink-2 disabled:opacity-60'

/** Claim sentence in a body section: proposed (确认 / 不对) or confirmed (hover: 改写 / 已过时 / 删除). */
export function ClaimRow({ claim, mark, selfId }: { claim: ClaimDTO; mark: number; selfId: number | null }) {
  const [mode, setMode] = useState<Mode>('view')
  const [active, setActive] = useState(false)
  const act = useAction()
  const proposed = claim.status === 'proposed'
  const ev = [{ type: 'claim' as const, id: claim.id }]

  const review = (body: Parameters<typeof personApi.review>[2]) => act.run(() => personApi.review('claim', claim.id, body), { evidence: ev })

  const toggleActive = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a,button,input,form,[role=region]')) return
    setActive((v) => !v)
  }

  return (
    <EvidenceRow
      as="li"
      id={anchorId('claim', claim.id)}
      className={cn(
        'group relative border-l py-[3px] pl-[11px] pr-1 transition-colors duration-700 [overflow-wrap:anywhere]',
        proposed ? 'border-proposed text-ink-2' : 'border-transparent text-ink',
        act.pending && 'opacity-60',
      )}
    >
      <div data-active={active || undefined} onClick={toggleActive} className="loam-prose text-inherit" style={{ color: 'inherit' }}>
        {mode === 'edit' ? (
          <EditForm
            initial={claim.statement}
            pending={act.pending}
            onCancel={() => {
              act.reset()
              setMode('view')
            }}
            onSave={async (statement) => {
              if (statement === claim.statement) return setMode('view')
              const r = await review({ action: 'edit', patch: { statement } })
              if (r) setMode('view')
            }}
          />
        ) : (
          <>
            <Statement text={claim.statement} mentions={claim.mentions} selfId={selfId} />
            <EvidenceMark target={{ type: 'claim', id: claim.id }} index={mark} sourceKind={claim.sourceKind} evidenceCount={claim.evidenceCount} className={markClassFor(sentence(claim.statement))} />
            {claim.validFrom && (
              <>
                <Gap size="sm" />
                <span className="whitespace-nowrap font-data text-[12px] tabular-nums text-ink-3">{formatPartialDate(claim.validFrom)}</span>
              </>
            )}
            {proposed ? (
              <>
              <Gap />
              <span className="inline-flex items-baseline gap-2 whitespace-nowrap align-baseline">
                <TextButton disabled={act.pending} onClick={() => void review({ action: 'accept' })}>
                  确认
                </TextButton>
                <span className="text-[12px] text-ink-3" aria-hidden>
                  /
                </span>
                <TextButton disabled={act.pending} onClick={() => void review({ action: 'reject' })}>
                  不对
                </TextButton>
              </span>
              </>
            ) : (
              mode === 'view' && (
                <>
                <Gap />
                <span
                  data-claim-actions
                  className={cn(
                    'inline-flex items-baseline gap-2.5 whitespace-nowrap align-baseline',
                    // hover, or keyboard focus inside the row; a mouse click on the evidence mark does not keep them up
                    'invisible group-hover:visible group-has-[:focus-visible]:visible max-sm:hidden',
                    active && 'visible max-sm:inline-flex',
                  )}
                >
                  <TextButton tone="quiet" onClick={() => setMode('edit')}>
                    改写
                  </TextButton>
                  <TextButton tone="quiet" onClick={() => setMode('outdated')}>
                    已过时
                  </TextButton>
                  <TextButton tone="quiet" onClick={() => setMode('delete')}>
                    删除
                  </TextButton>
                </span>
                </>
              )
            )}
          </>
        )}
      </div>

      {mode === 'outdated' && (
        <OutdatedForm
          pending={act.pending}
          onCancel={() => {
            act.reset()
            setMode('view')
          }}
          onSubmit={async (now) => {
            const r = await review({ action: 'supersede', ...(now ? { replacement: { statement: now } } : {}) })
            if (r) setMode('view')
          }}
        />
      )}
      {mode === 'delete' && (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] leading-6 text-ink-2">
          <span>删除这条信息？删除后不会留在历史里。</span>
          <span className="inline-flex items-baseline gap-3">
            <TextButton tone="danger" disabled={act.pending} onClick={() => void review({ action: 'delete' })}>
              删除
            </TextButton>
            <TextButton
              tone="quiet"
              disabled={act.pending}
              onClick={() => {
                act.reset()
                setMode('view')
              }}
            >
              取消
            </TextButton>
          </span>
        </div>
      )}
      {act.error && <InlineError message={act.error} />}
    </EvidenceRow>
  )
}

function EditForm({ initial, pending, onSave, onCancel }: { initial: string; pending: boolean; onSave: (s: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    if (v) onSave(v)
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 py-0.5 sm:flex-row sm:items-center">
      <input
        aria-label="改写这条信息"
        autoFocus
        maxLength={500}
        value={value}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e: KeyboardEvent) => e.key === 'Escape' && onCancel()}
        className={inputCls}
      />
      <span className="flex shrink-0 items-baseline gap-3">
        <TextButton type="submit" disabled={pending || !value.trim()}>
          {pending ? '正在保存…' : '保存'}
        </TextButton>
        <TextButton tone="quiet" disabled={pending} onClick={onCancel}>
          取消
        </TextButton>
      </span>
    </form>
  )
}

function OutdatedForm({ pending, onSubmit, onCancel }: { pending: boolean; onSubmit: (now: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(value.trim())
      }}
      className="mt-1.5 mb-1 border-l border-line-strong pl-3"
    >
      <label className="block text-[13px] leading-6 text-ink-3" htmlFor="outdated-now">
        这条会移到历史里。现在的情况是？（可以不填）
      </label>
      <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          id="outdated-now"
          autoFocus
          maxLength={500}
          value={value}
          disabled={pending}
          placeholder="比如：去年搬回了成都"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onCancel()}
          className={inputCls}
        />
        <span className="flex shrink-0 items-baseline gap-3">
          <TextButton type="submit" disabled={pending}>
            {pending ? '正在保存…' : '标记为已过时'}
          </TextButton>
          <TextButton tone="quiet" disabled={pending} onClick={onCancel}>
            取消
          </TextButton>
        </span>
      </div>
    </form>
  )
}

export { inputCls }
