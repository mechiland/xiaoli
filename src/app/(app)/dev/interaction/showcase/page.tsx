'use client'
// Fixture states of the interaction layer's four mounted components (ARCHITECTURE §12 `interaction/showcase`).
// Dev only (dev/layout.tsx). Everything here is synthetic; nothing is written.
import { useState } from 'react'
import { ImportConversationsView, InteractionSectionSkeleton, InteractionSectionView, LastContactView, PlanRow } from '@/components/interaction'
import { BlockError, Label, PageShell } from '@/components/loam'
import {
  EMPTY,
  EXPIRED,
  FULL,
  IMPORT_CONVERSATIONS,
  LAST_CONTACT_AT,
  LONG,
  LOOPS_ONLY,
  NEWEST_CONVERSATION,
  PLANS,
  RHYTHM_ONLY,
  TODAY,
  UNCONFIRMED,
} from './fixtures'

/** The person page's left column is ~652px wide inside the 1080px shell; the section is shown at that width. */
function Frame({ id, label, children, width = 'body' }: { id: string; label: string; children: React.ReactNode; width?: 'body' | 'infobox' }) {
  return (
    <section id={id} data-frame={id} className="mb-16">
      <Label as="p" className="mb-4 border-b border-dashed border-line pb-1">
        {label}
      </Label>
      <div className={width === 'infobox' ? 'w-full sm:max-w-[308px]' : 'w-full lg:max-w-[652px]'}>{children}</div>
    </section>
  )
}

export default function InteractionShowcasePage() {
  const [timeline, setTimeline] = useState(5)
  const long = { ...LONG, conversations: LONG.conversations.slice(0, timeline), hasMore: timeline < LONG.conversations.length }

  return (
    <PageShell className="pt-8 sm:pt-12">
      <Frame id="full" label="来往 · 三块齐全（节奏 / 未结事项 / 时间线）">
        <InteractionSectionView personLabel="林知夏" data={FULL} today={TODAY} markStart={7} hasMore onMore={() => undefined} />
      </Frame>

      <Frame id="rhythm-only" label="只有节奏（段落都被隐藏了）">
        <InteractionSectionView personLabel="林知夏" data={RHYTHM_ONLY} today={TODAY} markStart={1} />
      </Frame>

      <Frame id="loops-only" label="只有未结事项（还没有段落摘要）">
        <InteractionSectionView personLabel="林知夏" data={LOOPS_ONLY} today={TODAY} markStart={1} />
      </Frame>

      <Frame id="expired" label="过期的未结事项：降一档、注明已过去多久，不移走、不排后、不加警示色">
        <InteractionSectionView personLabel="林知夏" data={EXPIRED} today={TODAY} markStart={1} />
      </Frame>

      <Frame id="unconfirmed" label="未确认的未结事项：降一档、左侧细竖线、句末 确认 / 不对">
        <InteractionSectionView personLabel="林知夏" data={UNCONFIRMED} today={TODAY} markStart={1} />
      </Frame>

      <Frame id="empty" label="三块都空：整节不显示（下面应当什么都没有）">
        <div data-empty-probe className="border border-dashed border-line px-3 py-2 text-[13px] text-ink-3">
          <InteractionSectionView personLabel="林知夏" data={EMPTY} today={TODAY} />
          这一格里没有「来往」这一节。
        </div>
      </Frame>

      <Frame id="long" label="很长的时间线（更早 展开）">
        <InteractionSectionView
          personLabel="林知夏"
          data={long}
          today={TODAY}
          markStart={1}
          hasMore={long.hasMore}
          onMore={() => setTimeline((n) => n + 10)}
        />
      </Frame>

      <Frame id="loading" label="加载中">
        <InteractionSectionSkeleton />
      </Frame>

      <Frame id="error" label="这一块没有加载出来">
        <div className="mt-3">
          <BlockError onRetry={() => undefined} message="来往没有加载出来" />
        </div>
      </Frame>

      <Frame id="last-contact" label="信息框 · 最后一次聊天（时间 + 那次的摘要）" width="infobox">
        <div className="border border-line bg-paper px-4 py-3">
          <dl className="divide-y divide-line">
            <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-3 py-2 text-[14px] leading-7">
              <dt className="font-data text-[12px] tracking-wide text-ink-3">最后一次聊天</dt>
              <dd className="min-w-0 text-ink">
                <LastContactView lastContactAt={LAST_CONTACT_AT} conversation={NEWEST_CONVERSATION} today={TODAY} />
              </dd>
            </div>
            <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-3 py-2 text-[14px] leading-7">
              <dt className="font-data text-[12px] tracking-wide text-ink-3">最后一次聊天</dt>
              <dd className="min-w-0 text-ink">
                <LastContactView lastContactAt={LAST_CONTACT_AT} conversation={null} today={TODAY} />
              </dd>
            </div>
          </dl>
        </div>
      </Frame>

      <Frame id="plans" label="首页「即将到来」里的约定行">
        <ul>
          {PLANS.map((p) => (
            <PlanRow key={p.loopId} person={p.person} loopId={p.loopId} label={p.label} solar={p.solar} days={p.days} today={TODAY} />
          ))}
        </ul>
      </Frame>

      <Frame id="import-conversations" label="导入结果页「这次聊了什么」：没有确认按钮，只能改写和隐藏">
        <ImportConversationsView conversations={IMPORT_CONVERSATIONS} today={TODAY} />
      </Frame>
    </PageShell>
  )
}
