'use client'
// /imports/:id — "这份聊天记录带来的变化" (SPEC §9.9, ARCHITECTURE §1.10).
// Blocks: header (detail query, falls back to the review query), progress loop, body (review query, BlockBoundary),
// foot (delete). Each block fails on its own.

import Link from 'next/link'
import { useRef, useState } from 'react'
import { AttachmentUploadStatus } from '@/components/import-overlay'
import { BlockBoundary, BlockError, Data, PageTitle, Skeleton } from '@/components/loam'
import type { ImportDetailResponse, ImportReviewResponse, Progress } from '@/contracts'
import { cn } from '@/lib/cn'
import { personHref } from '@/lib/links'
import { useBulkAccept, useImportDetail, useImportReview, useRetryFailed, useSettings } from './data'
import { DeleteImportControl } from './delete-import'
import { deriveReview, formatDateRange, markIndexes, readingProgress, reviewItemKey, sectionItems } from './format'
import { useExtractionLoop } from './loop'
import { PersonSection } from './section'

const shell = 'mx-auto w-full max-w-[760px] px-5 pb-24 pt-10 sm:px-8 sm:pt-14'

export function ImportResult({ importId }: { importId: number }) {
  const detail = useImportDetail(importId)
  const detailMissing = detail.error?.status === 404
  const status = detail.data?.import.status
  // review runs once the page knows this is not an unfinished (mapping) import — or when the detail block failed
  const reviewEnabled = !detailMissing && ((detail.isSuccess && status !== 'mapping') || (detail.isError && !detailMissing))
  const review = useImportReview(importId, reviewEnabled)

  if (detailMissing || review.error?.status === 404) return <NotFound />
  if (status === 'mapping' || (!detail.data && review.data?.import.status === 'mapping')) return <Unfinished importId={importId} />
  return (
    <ResultPage
      importId={importId}
      detail={detail.data}
      detailError={detail.isError}
      retryDetail={() => void detail.refetch()}
      review={review.data}
      reviewError={review.isError && !review.data && !review.isFetching}
      retryReview={() => void review.refetch()}
    />
  )
}

// ---------------------------------------------------------------------------------------------------------------

function ResultPage({
  importId,
  detail,
  detailError,
  retryDetail,
  review,
  reviewError,
  retryReview,
}: {
  importId: number
  detail: ImportDetailResponse | undefined
  detailError: boolean
  retryDetail: () => void
  review: ImportReviewResponse | undefined
  reviewError: boolean
  retryReview: () => void
}) {
  const imp = detail?.import ?? review?.import
  const chat = detail?.chat ?? review?.chat ?? null
  const progress: Progress | undefined = detail?.progress ?? review?.progress
  const extracting = imp?.status === 'extracting'
  const loop = useExtractionLoop(importId, extracting && !!progress)

  return (
    <div className={shell} data-import-result={importId} data-import-status={imp?.status}>
      <header className="border-b border-line pb-5">
        <PageTitle>这份聊天记录带来的变化</PageTitle>
        <div className="mt-2 text-[13px] leading-6 text-ink-3" data-import-subtitle>
          {imp ? (
            <p className="[overflow-wrap:anywhere]">
              {[chat?.title, formatDateRange(imp.dateFrom, imp.dateTo)]
                .filter((t): t is string => Boolean(t))
                .map((t, i) => (
                  <span key={i}>
                    <span className="whitespace-nowrap">{t}</span>
                    <span className="px-1.5" aria-hidden>
                      ·
                    </span>
                  </span>
                ))}
              <span className="whitespace-nowrap">
                新增 <Data>{imp.newMessageCount}</Data> 条消息
              </span>
            </p>
          ) : detailError ? (
            <BlockError message="这次导入的信息没有加载出来" onRetry={retryDetail} className="text-[13px]" />
          ) : (
            <Skeleton className="mt-1.5 h-3.5 w-72 max-w-full" />
          )}
        </div>
        <AttachmentUploadStatus importId={importId} />
        {extracting && progress && <ProgressLine progress={progress} loop={loop} />}
      </header>

      {review && imp && !extracting && <FailedWindows importId={importId} progress={progress ?? review.progress} />}
      {review && <BulkHighConfidence importId={importId} review={review} />}

      <BlockBoundary className="min-h-[40vh]">
        {reviewError ? (
          <div className="pt-9" data-review-error>
            <BlockError message="这次导入的结果没有加载出来" onRetry={retryReview} />
          </div>
        ) : (
          <Body importId={importId} review={review} extracting={extracting} />
        )}
      </BlockBoundary>

      <footer className="mt-20">
        <DeleteImportControl importId={importId} beforeDelete={loop.halt} onAbort={loop.unhalt} />
      </footer>
    </div>
  )
}

// ---- progress ---------------------------------------------------------------------------------------------------

function ProgressLine({ progress, loop }: { progress: Progress; loop: ReturnType<typeof useExtractionLoop> }) {
  const { current, total, ratio } = readingProgress(progress)
  return (
    <div className="mt-5" data-extraction-progress>
      <div
        role="progressbar"
        aria-label="读取进度"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={progress.done + progress.failed}
        className="h-[2px] w-full overflow-hidden bg-line"
      >
        <div className="h-full bg-ink-2 transition-[width] duration-700 ease-out" style={{ width: `${Math.max(ratio * 100, total ? 2 : 0)}%` }} />
      </div>
      <p className="mt-2.5 text-[13px] leading-6 text-ink-3" aria-live="polite">
        {loop.phase === 'error' ? (
          <>
            <span className="text-ink-2">{loop.error}</span>
            <span className="px-1.5">·</span>
            <button type="button" className="loam-text-button" onClick={loop.resume}>
              继续读取
            </button>
          </>
        ) : total > 0 ? (
          <span className="text-ink-2">
            正在读取 <Data>{current} / {total}</Data> 段对话
          </span>
        ) : (
          <span className="text-ink-2">正在准备读取</span>
        )}
        {progress.failed > 0 && (
          <>
            <span className="px-1.5">·</span>
            <Data>{progress.failed}</Data> 段没有读取成功
          </>
        )}
        <span className="px-1.5">·</span>
        离开页面后会暂停
      </p>
    </div>
  )
}

function FailedWindows({ importId, progress }: { importId: number; progress: Progress }) {
  const retry = useRetryFailed(importId)
  if (progress.failed === 0) return null
  return (
    <p data-failed-windows className="mt-4 border-l border-line-strong pl-3 text-[13px] leading-6 text-ink-2" role="status">
      有 <Data>{progress.failed}</Data> 段对话没有读取成功
      <span className="px-1.5 text-ink-3">·</span>
      <button type="button" className="loam-text-button" disabled={retry.isPending} onClick={() => retry.mutate()}>
        {retry.isPending ? '正在重新读取…' : '重试'}
      </button>
      {retry.isError && <span className="ml-2 text-ink-3">没有成功，稍后再试</span>}
    </p>
  )
}

// ---- bulk -------------------------------------------------------------------------------------------------------

function BulkHighConfidence({ importId, review }: { importId: number; review: ImportReviewResponse }) {
  const bulk = useBulkAccept(importId)
  const settings = useSettings()
  const [armed, setArmed] = useState<{ type: 'claim'; id: number }[] | null>(null)
  const pending = deriveReview(review).highConfidence
  if (pending.length === 0 && !armed && !bulk.isPending) return null
  const threshold = settings.data?.settings.highConfidenceThreshold
  const count = armed?.length ?? pending.length

  return (
    <div data-bulk-high-confidence data-armed={armed ? 'true' : undefined} className="mt-4 flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1 text-[13px] leading-6">
      {armed && !bulk.isPending && (
        <span className="text-ink-2">
          将确认 <Data>{count}</Data> 条{threshold ? `可信度在 ${Math.round(threshold * 100)}% 以上的` : '可信度高的'}信息，不含敏感内容
        </span>
      )}
      {bulk.isError && <span className="text-ink-2">没有全部确认上</span>}
      <button
        type="button"
        data-bulk-button
        disabled={bulk.isPending}
        onClick={() => {
          if (!armed) return setArmed(pending)
          bulk.mutate({ items: armed }, { onSettled: () => setArmed(null) })
        }}
        className={cn(
          'transition-colors disabled:text-ink-3',
          armed ? 'h-7 rounded-[2px] bg-ink px-3 text-ink-inverse hover:opacity-90' : 'text-ink-2 hover:text-ink hover:underline hover:decoration-line-strong hover:underline-offset-4',
        )}
      >
        {bulk.isPending ? '正在确认…' : armed ? `确认这 ${count} 条` : '确认所有可信度高的条目'}
      </button>
      {armed && !bulk.isPending && (
        <button type="button" onClick={() => setArmed(null)} className="text-ink-2 hover:text-ink">
          取消
        </button>
      )}
    </div>
  )
}

// ---- body -------------------------------------------------------------------------------------------------------

/** Items that appear after the first paint fade in once (SPEC §9.9). */
function useFresh(review: ImportReviewResponse | undefined) {
  const seen = useRef<Map<string, number> | null>(null)
  if (!review) return () => false
  const now = Date.now()
  const keys = review.sections.flatMap((s) => [`section:${s.person.id}`, ...sectionItems(s).map(reviewItemKey)])
  if (seen.current === null) {
    seen.current = new Map(keys.map((k) => [k, 0]))
  } else {
    for (const k of keys) if (!seen.current.has(k)) seen.current.set(k, now)
  }
  const map = seen.current
  return (key: string) => {
    const t = map.get(key) ?? 0
    return t > 0 && now - t < 1200
  }
}

function Body({ importId, review, extracting }: { importId: number; review: ImportReviewResponse | undefined; extracting: boolean }) {
  const isFresh = useFresh(review)
  if (!review) return <BodySkeleton />

  if (review.sections.length === 0) {
    if (extracting) return null
    return (
      <div data-empty-result className="pt-14">
        <p className="font-serif text-[18px] leading-8 text-ink-2">这段聊天里没有找到需要记下来的信息</p>
      </div>
    )
  }

  const marks = markIndexes(review)
  const derived = deriveReview(review)
  return (
    <div data-review-body>
      {review.sections.map((s) => (
        <PersonSection key={s.person.id} importId={importId} section={s} marks={marks} isFresh={isFresh} />
      ))}
      {derived.allHandled && !extracting && (
        <div data-all-handled className="mt-16 border-t border-line pt-6">
          <p className="font-serif text-[18px] font-semibold leading-8 text-ink">已全部处理</p>
          <p className="mt-1.5 text-[14px] leading-7 text-ink-2">
            这次涉及的人物：
            {derived.persons.map((p, i) => (
              <span key={p.id}>
                {i > 0 && '、'}
                <Link href={personHref(p.id)} className="loam-link">
                  {p.label}
                </Link>
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  )
}

function BodySkeleton() {
  return (
    <div aria-busy="true" data-review-loading className="pt-9">
      <span className="sr-only">正在加载这次导入的结果</span>
      {[0, 1].map((i) => (
        <div key={i} className={cn(i > 0 && 'pt-12')}>
          <div className="border-b border-line pb-3">
            <Skeleton className="h-5 w-28" />
          </div>
          <Skeleton className="mt-6 h-3 w-14" />
          <div className="mt-3 grid gap-x-5 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
            <Skeleton className="hidden h-3 w-10 justify-self-end sm:block" />
            <div className="space-y-3.5">
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- other page states ------------------------------------------------------------------------------------------

function Unfinished({ importId }: { importId: number }) {
  return (
    <div className={shell} data-import-result={importId} data-import-status="mapping">
      <header className="border-b border-line pb-5">
        <PageTitle>这次导入没有完成</PageTitle>
      </header>
      <p className="mt-6 text-[15px] leading-7 text-ink-2">可以重新导入这份文件。</p>
      <footer className="mt-20">
        <DeleteImportControl importId={importId} />
      </footer>
    </div>
  )
}

function NotFound() {
  return (
    <div className={shell} data-import-result-missing>
      <header className="border-b border-line pb-5">
        <PageTitle>没有找到这次导入</PageTitle>
      </header>
      <p className="mt-6 text-[15px] leading-7 text-ink-2">
        它可能已经被删除了。
        <Link href="/" className="loam-link ml-1">
          回到首页
        </Link>
      </p>
    </div>
  )
}
