'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { EvidenceMark, EvidenceRow, type EvidenceTarget } from '@/components/evidence'
import { Meta, PageShell, SectionTitle } from '@/components/loam'
import type { EvidenceMessageDTO, EvidenceResponse, MessageKind, MessageMeta, SourceKind } from '@/contracts'
import { ApiClientError } from '@/lib/api-client'
import { cn } from '@/lib/cn'
import { queryKeys } from '@/lib/query'

export interface LiveClaim {
  id: number
  statement: string
  sourceKind: SourceKind
}

// ---- synthetic fixtures (fictional people and chats) ------------------------------------------------------------

const GROUP = { chatId: 910001, chatTitle: '大学同学群' }
const PRIVATE = { chatId: 910002, chatTitle: '林知夏' }
let nextId = 920000
const msg = (
  chat: { chatId: number },
  sentAt: string,
  sender: string,
  body: string,
  opts: { kind?: MessageKind; meta?: MessageMeta; ev?: boolean; senderLabel?: string } = {},
): EvidenceMessageDTO => ({
  id: nextId++,
  chatId: chat.chatId,
  seq: nextId * 1024,
  sentAt,
  kind: opts.kind ?? 'text',
  body,
  meta: opts.meta ?? null,
  senderHandleId: null,
  senderName: sender,
  senderPersonId: null,
  senderLabel: opts.senderLabel ?? sender,
  attachments: [],
  isEvidence: Boolean(opts.ev),
})
const segment = (chat: { chatId: number; chatTitle: string }, messages: EvidenceMessageDTO[]) => ({
  ...chat,
  messageId: messages.find((m) => m.isEvidence)!.id,
  messages,
})

const T = {
  multi: { type: 'claim', id: 990001 },
  relation: { type: 'relation', id: 990006 },
  proposed: { type: 'claim', id: 990007 },
  noEvidence: { type: 'claim', id: 990008 },
  manual: { type: 'claim', id: 990002 },
  loading: { type: 'claim', id: 990003 },
  error: { type: 'claim', id: 990004 },
  long: { type: 'claim', id: 990005 },
} satisfies Record<string, EvidenceTarget>

const FIXTURES: [EvidenceTarget, EvidenceResponse][] = [
  [
    T.multi,
    {
      target: T.multi,
      sourceKind: 'ai',
      manualAddedAt: null,
      items: [
        segment(GROUP, [
          msg(GROUP, '2026-08-21 20:14', '陈嘉树', '知夏最近还在苏州吗？好久没见她发朋友圈了'),
          msg(GROUP, '2026-08-21 20:15', '周以宁', '[语音] 9"', { kind: 'voice', meta: { durationSec: 9 } }),
          msg(GROUP, '2026-08-21 20:17', '林知夏', '早搬走啦，我现在在杭州一家动画工作室做制片', { ev: true }),
          msg(GROUP, '2026-08-21 20:18', '陈嘉树', '[微信红包] 恭喜恭喜', { kind: 'red_packet', meta: { greeting: '恭喜恭喜' } }),
          msg(GROUP, '2026-08-21 20:19', '林知夏', '[动画表情] 谢谢老板', { kind: 'animated_sticker', meta: { label: '谢谢老板' } }),
        ]),
        segment(PRIVATE, [
          msg(PRIVATE, '2026-09-02 12:30', '我是小丽', '[转账] 朋友已确认收款', { kind: 'transfer', meta: { transferState: '朋友已确认收款' }, senderLabel: '我' }),
          msg(PRIVATE, '2026-09-02 12:31', '林知夏', '收到啦，下个月的排期又提前了'),
          msg(PRIVATE, '2026-09-02 12:31', '林知夏', '工作室在赶一部动画短片，我负责制片', { ev: true }),
          msg(PRIVATE, '2026-09-02 12:33', '我是小丽', '[语音] 14"', { kind: 'voice', meta: { durationSec: 14 }, senderLabel: '我' }),
          msg(PRIVATE, '2026-09-02 12:40', '林知夏', '做制片就是天天盯进度，比在苏州做会计累多了', { ev: true }),
          msg(PRIVATE, '2026-09-02 12:41', '我是小丽', '[视频通话] 通话时长 03:12', { kind: 'video_call', senderLabel: '我' }),
          msg(PRIVATE, '2026-09-03 09:02', '林知夏', '[图片] 微信图片_202609030902_1.jpg', { kind: 'image' }),
        ]),
      ],
    },
  ],
  [
    T.relation,
    {
      target: T.relation,
      sourceKind: 'ai',
      manualAddedAt: null,
      items: [
        segment(GROUP, [
          msg(GROUP, '2026-07-12 10:02', '周以宁', '@林知夏 表姐，周末回外婆家吗', { ev: true }),
          msg(GROUP, '2026-07-12 10:05', '林知夏', '回的，你开车来接我'),
        ]),
      ],
    },
  ],
  [
    T.proposed,
    {
      target: T.proposed,
      sourceKind: 'ai',
      manualAddedAt: null,
      items: [
        segment(PRIVATE, [
          msg(PRIVATE, '2026-08-30 07:10', '林知夏', '刚沿着西湖跑完一圈，周末不跑浑身难受', { ev: true }),
          msg(PRIVATE, '2026-08-30 07:40', '我是小丽', '厉害', { senderLabel: '我' }),
        ]),
      ],
    },
  ],
  [T.manual, { target: T.manual, sourceKind: 'manual', manualAddedAt: '2026-09-01T02:00:00.000Z', items: [] }],
  [
    T.long,
    {
      target: T.long,
      sourceKind: 'ai',
      manualAddedAt: null,
      items: [
        segment(PRIVATE, [
          msg(PRIVATE, '2026-06-18 22:40', '我是小丽', '最近怎么样', { senderLabel: '我' }),
          msg(
            PRIVATE,
            '2026-06-18 22:52',
            '林知夏',
            '说来话长。去年年底从苏州的事务所辞职以后，先在家休息了两个月，把一直想学的剪辑和动画基础课都补了一遍。\n\n开春的时候大学室友介绍我去杭州面试，一开始只是做项目助理，帮忙对接外包、整理分镜和排期表；干了半年发现自己其实挺适合盯进度的，老板就让我转成了制片，现在手上同时有两个短片项目。\n\n累是真的累，但比对着报表开心多了。工作室的作品集链接在这里 https://example.com/studio/portfolio/2026/animated-short-films-and-commercials-collection',
            { ev: true },
          ),
          msg(PRIVATE, '2026-06-18 22:55', '我是小丽', '真好，替你高兴', { senderLabel: '我' }),
        ]),
      ],
    },
  ],
]

function makeFixtureClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false, retryOnMount: false, refetchOnMount: false, refetchOnWindowFocus: false } },
  })
  for (const [t, data] of FIXTURES) client.setQueryData(queryKeys.evidence(t.type, t.id), data)
  // loading: a fetch that never settles keeps the query pending without touching the network
  void client.prefetchQuery({ queryKey: queryKeys.evidence(T.loading.type, T.loading.id), queryFn: () => new Promise<EvidenceResponse>(() => {}) })
  // error: a query already in the error state (retryOnMount: false, so nothing is refetched on mount)
  const error = new ApiClientError(500, 'internal', '服务器出错了')
  client
    .getQueryCache()
    .build(client, { queryKey: queryKeys.evidence(T.error.type, T.error.id) })
    .setState({ status: 'error', fetchStatus: 'idle', error, errorUpdateCount: 1, errorUpdatedAt: Date.now(), fetchFailureCount: 1, fetchFailureReason: error })
  return client
}

// ---- layout helpers ---------------------------------------------------------------------------------------------

function Block({ title, note, children, id }: { title: string; note: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="mt-12 first:mt-0">
      <SectionTitle>{title}</SectionTitle>
      <Meta className="mb-4 mt-1">{note}</Meta>
      {children}
    </section>
  )
}

function DemoRow({
  target,
  index,
  children,
  initiallyOpen = false,
  sourceKind = 'ai',
  evidenceCount = 1,
  className,
  prefetchOnHover,
  id,
}: {
  target: EvidenceTarget
  index: number
  children: ReactNode
  initiallyOpen?: boolean
  sourceKind?: SourceKind
  evidenceCount?: number
  className?: string
  prefetchOnHover?: boolean
  id?: string
}) {
  const key = `${target.type}:${target.id}`
  const [open, setOpen] = useState<string | null>(initiallyOpen ? key : null)
  return (
    <EvidenceRow as="li" id={id} open={open} onOpenChange={setOpen} className={cn('loam-prose', className)}>
      {children}
      <EvidenceMark target={target} index={index} sourceKind={sourceKind} evidenceCount={evidenceCount} prefetchOnHover={prefetchOnHover} />
    </EvidenceRow>
  )
}

// ---- page -------------------------------------------------------------------------------------------------------

export function EvidenceShowcase({ live }: { live: LiveClaim[] }) {
  const [fixtureClient] = useState(makeFixtureClient)
  return (
    <PageShell width="reading" title="证据" subtitle="点上标序号，在这一行下面展开原话；再点一次收起。以下为合成数据的各种状态。">
      <QueryClientProvider client={fixtureClient}>
        <Block id="multi" title="三条证据，来自两个聊天" note="人物页正文里的写法：句末上标序号。语音、转账、红包等看不到内容的消息显示为灰色标签。">
          <ul className="space-y-1.5">
            <DemoRow target={T.multi} index={1} initiallyOpen id="row-multi" evidenceCount={3}>
              在杭州一家动画工作室做制片。
            </DemoRow>
            <DemoRow target={T.relation} index={2}>
              表妹 · <span className="loam-link">周以宁</span>
            </DemoRow>
            <DemoRow target={T.proposed} index={3} className="loam-proposed">
              周末常去西湖边跑步。
            </DemoRow>
            <DemoRow target={T.noEvidence} index={4} evidenceCount={0}>
              原话已随导入删除的信息，序号变灰、不能展开。
            </DemoRow>
          </ul>
        </Block>

        <Block id="manual" title="手动添加" note="没有原话的条目，展开后注明添加日期。">
          <ul>
            <DemoRow target={T.manual} index={5} sourceKind="manual" evidenceCount={0} initiallyOpen id="row-manual">
              养了一只叫年糕的橘猫。
            </DemoRow>
          </ul>
        </Block>

        <Block id="loading" title="加载中" note="只在证据块内部显示占位，这一行和页面其他部分不受影响。">
          <ul>
            <DemoRow target={T.loading} index={6} initiallyOpen prefetchOnHover={false} id="row-loading">
              在读在职研究生。
            </DemoRow>
          </ul>
        </Block>

        <Block id="error" title="没有加载出来" note="出错也只在证据块内部，带重试。">
          <ul>
            <DemoRow target={T.error} index={7} initiallyOpen prefetchOnHover={false} id="row-error">
              老家在江西景德镇。
            </DemoRow>
          </ul>
        </Block>

        <Block id="long" title="长消息" note="多段正文保留换行，长链接在窄屏里折行。">
          <ul>
            <DemoRow target={T.long} index={8} initiallyOpen id="row-long">
              从事务所辞职后转行做动画制片。
            </DemoRow>
          </ul>
        </Block>
      </QueryClientProvider>

      <Block id="live" title="种子账号里的真实数据" note={live.length ? '这一节走真实接口 GET /api/evidence。' : '在地址后加 ?claim=<信息 id> 查看种子账号里的真实证据。'}>
        {live.length > 0 && (
          <ul className="space-y-1.5">
            {live.map((c, i) => (
              <EvidenceRow as="li" key={c.id} id={`live-row-${i + 1}`} className="loam-prose">
                {c.statement}。
                <EvidenceMark target={{ type: 'claim', id: c.id }} index={9 + i} sourceKind={c.sourceKind} evidenceCount={1} />
              </EvidenceRow>
            ))}
          </ul>
        )}
      </Block>
    </PageShell>
  )
}
