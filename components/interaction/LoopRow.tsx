'use client'
// One 未结事项 row (SPEC §9.5). Expired rows are dimmer and say how long it has been — never a warning colour, never
// reordered, never counted.
import { EvidenceMark, EvidenceRow } from '@/components/evidence'
import type { LoopDTO } from '@/contracts'
import { cn } from '@/lib/cn'
import { anchorId } from '@/lib/links'
import { loopSentence } from '@/lib/loop-text'
import { interactionApi, useAction } from './api'
import { markClassFor, openedLabel, pastLabel, planDueLabel, sentence } from './format'
import { ButtonPair, Gap, InlineError } from './ui'

export function LoopRow({ loop, mark, today, personLabel }: { loop: LoopDTO; mark: number; today: string; personLabel: string }) {
  const act = useAction()
  const proposed = loop.status === 'proposed'
  // `loops.text` is a bare fragment; direction and kind turn it into a sentence. Shared with the import result
  // page so the same loop never reads two different ways (core-request import-result#4).
  const text = sentence(loopSentence(loop, personLabel))
  const due = planDueLabel(loop, today)

  return (
    <EvidenceRow
      as="li"
      id={anchorId('loop', loop.id)}
      className={cn(
        'group relative border-l py-[3px] pl-[11px] pr-1 transition-colors duration-700 [overflow-wrap:anywhere]',
        // unconfirmed: one shade down and a thin left rule, exactly like an unconfirmed claim
        proposed ? 'border-proposed' : 'border-transparent',
        proposed ? (loop.expired ? 'text-ink-3' : 'text-ink-2') : loop.expired ? 'text-ink-2' : 'text-ink',
        act.pending && 'opacity-60',
      )}
    >
      {/* the data attributes live on the inner element: EvidenceRow renders only its declared props */}
      <div className="loam-prose" style={{ color: 'inherit' }} data-loop-expired={loop.expired || undefined} data-loop-status={loop.status}>
        <span>{text}</span>
        <EvidenceMark
          target={{ type: 'loop', id: loop.id }}
          index={mark}
          sourceKind={loop.sourceKind}
          evidenceCount={loop.evidenceCount}
          className={markClassFor(text)}
        />
        <Gap size="sm" />
        <span className="whitespace-nowrap font-data text-[12px] tabular-nums text-ink-3">{due ?? openedLabel(loop, today)}</span>
        {loop.expired && (
          <>
            <Gap size="sm" />
            <span data-loop-past className="whitespace-nowrap font-data text-[12px] tabular-nums text-ink-3">
              {pastLabel(loop, today)}
            </span>
          </>
        )}
        <Gap />
        {proposed ? (
          <ButtonPair
            first="确认"
            second="不对"
            disabled={act.pending}
            onFirst={() => void act.run(() => interactionApi.reviewLoop(loop.id, 'accept'))}
            onSecond={() => void act.run(() => interactionApi.reviewLoop(loop.id, 'reject'))}
          />
        ) : (
          <ButtonPair
            first="已完成"
            second="不用管"
            disabled={act.pending}
            onFirst={() => void act.run(() => interactionApi.closeLoop(loop.id, 'done'))}
            onSecond={() => void act.run(() => interactionApi.closeLoop(loop.id, 'dropped'))}
          />
        )}
      </div>
      {act.error && <InlineError message={act.error} />}
    </EvidenceRow>
  )
}
