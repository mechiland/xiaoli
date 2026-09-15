import { redirect } from 'next/navigation'
import type { HomeResponse } from '@/contracts'
import { HomeView } from '@/components/home'
import { indexLetter, sortKey } from '@/lib/pinyin'
import { signInHref } from '@/lib/links'
import { getDb } from '@/server/db'
import { computeUpcoming, getHomeBlocks, type HomeBlocksResult, type UpcomingDateRow } from '@/server/home'
import { getServerUser } from '@/server/session'
import { homeEnv } from '../../../_home/load'

// Home showcase variants on top of the signed-in account's real home data (dev only, dev/layout.tsx).
// ?variant=collapsed | lunar | no-upcoming | long | empty-onboarding
export const dynamic = 'force-dynamic'

const SURNAMES = [...'安白蔡曹陈程戴丁杜范方冯付高葛龚顾郭韩何洪胡贾江姜金康孔赖梁廖刘龙卢陆罗吕马毛莫倪潘彭钱秦邱任邵沈石史宋苏孙谭汤陶田万汪魏温文伍夏萧谢熊严颜杨叶易殷尹于余俞袁岳章赵郑钟朱庄邹']
const GIVEN = ['子涵', '思远', '雨桥', '明哲', '若溪', '一诺', '嘉树', '清和', '书言', '语桐', '亦舒', '怀瑾']
const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#']

function regroup(people: { id: number; label: string; pinned: boolean }[]): HomeResponse['index'] {
  const groups = new Map<string, typeof people>()
  for (const p of people) {
    const l = indexLetter(p.label)
    groups.set(l, [...(groups.get(l) ?? []), p])
  }
  return {
    groups: LETTERS.filter((l) => groups.has(l)).map((letter) => ({
      letter,
      people: groups.get(letter)!.sort((a, b) => sortKey(a.label).localeCompare(sortKey(b.label)) || a.id - b.id),
    })),
    total: people.length,
  }
}

function collapsed(r: HomeBlocksResult): HomeBlocksResult {
  const people = r.blocks.index?.groups.flatMap((g) => g.people) ?? []
  if (people.length === 0) return r
  const extra = Array.from({ length: 64 }, (_, i) => ({
    id: people[i % people.length].id, // links resolve to real people; labels are showcase-only
    label: `${SURNAMES[(i * 7) % SURNAMES.length]}${GIVEN[i % GIVEN.length]}`,
    pinned: false,
  }))
  return { ...r, blocks: { ...r.blocks, index: regroup([...people, ...extra]) } }
}

function lunar(r: HomeBlocksResult): HomeBlocksResult {
  const people = r.blocks.index?.groups.flatMap((g) => g.people) ?? []
  const p = (i: number) => people[i % Math.max(1, people.length)] ?? { id: 1, label: '林知夏' }
  const today = r.today
  const [, m, d] = today.split('-').map(Number)
  const rows: UpcomingDateRow[] = [
    { dateId: 900001, personId: p(0).id, personLabel: p(0).label, kind: 'birthday', label: null, calendar: 'solar', month: m, day: d, isLeapMonth: false },
  ]
  // lunar dates 1, ~9 and ~27 days away (found by scanning the lunar calendar), one of them in a leap month when possible
  const wanted = [1, 9, 27]
  for (let month = 1; month <= 12 && wanted.length; month++) {
    for (let day = 1; day <= 29 && wanted.length; day++) {
      for (const leap of [false, true]) {
        const [u] = computeUpcoming([{ dateId: 0, personId: 0, personLabel: '', kind: 'birthday', label: null, calendar: 'lunar', month, day, isLeapMonth: leap }], today)
        const hit = u && wanted.indexOf(u.days)
        if (u && hit !== undefined && hit >= 0 && (leap ? u.lunarLabel?.includes('闰') : true)) {
          const i = rows.length
          rows.push({ dateId: 900000 + i + 1, personId: p(i * 5).id, personLabel: p(i * 5).label, kind: i === 2 ? 'anniversary' : 'birthday', label: null, calendar: 'lunar', month, day, isLeapMonth: leap })
          wanted.splice(hit, 1)
        }
      }
    }
  }
  rows.push({ dateId: 900010, personId: p(11).id, personLabel: p(11).label, kind: 'memorial', label: '外婆的忌日', calendar: 'solar', month: m === 12 ? 1 : m + 1, day: Math.min(d, 28), isLeapMonth: false })
  return { ...r, blocks: { ...r.blocks, upcoming: computeUpcoming(rows, today, 31) } }
}

function long(r: HomeBlocksResult): HomeBlocksResult {
  const longLabel = '大学室友阿宁（杭州独立设计工作室合伙人兼周末陶艺课代课老师）'
  const first = r.blocks.index?.groups[0]?.people[0] ?? { id: 1, label: '林知夏' }
  return {
    ...r,
    blocks: {
      ...r.blocks,
      upcoming: [
        { person: { id: first.id, label: longLabel }, dateId: 900101, label: '第一次一起去景德镇做陶瓷的纪念日', solar: r.today, lunarLabel: null, days: 0 },
        ...(r.blocks.upcoming ?? []).slice(0, 3),
      ],
      recentlyUpdated: [
        {
          person: { id: first.id, label: longLabel },
          latest: { id: 1, statement: '今年春天从杭州搬去了景德镇，在陶溪川附近租了一个带院子的工作室，打算和两位朋友一起做日用陶瓷品牌，周末还在社区教小朋友拉坯', category: 'life_event' },
        },
        ...(r.blocks.recentlyUpdated ?? []).filter((x) => x.person.id !== first.id).slice(0, 3),
      ],
      pinned: [{ id: first.id, label: longLabel }, ...(r.blocks.pinned ?? []).filter((x) => x.id !== first.id).slice(0, 6)],
      // titles of several lengths so that at 390 and 1440 some line fills up right before a " ·" separator
      recentImports: [
        '2016 级建筑系研究生毕业十周年返校聚会筹备群（暂定名，欢迎大家提建议）',
        '周末一起去西溪湿地骑车的朋友们',
        '小区三期业主装修交流群',
        '外婆八十大寿家宴筹备小组（请大家确认到场人数）',
        '羽毛球搭子',
      ].map((chatTitle, i) => ({
        id: r.blocks.recentImports?.[i]?.id ?? r.blocks.recentImports?.[0]?.id ?? 1,
        chatTitle,
        dateFrom: i === 1 ? '2026-09-14 08:00' : '2025-11-02 09:12',
        dateTo: i === 1 ? '2026-09-15 21:30' : '2026-09-14 22:40',
        createdAt: new Date(Date.now() - i * 3_600_000).toISOString(),
        status: 'done' as const,
      })),
    },
  }
}

export default async function HomeShowcasePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getServerUser()
  if (!user) redirect(signInHref)
  const env = homeEnv()
  const variant = (await searchParams).variant
  let r = await getHomeBlocks(getDb(), user.id, { tz: env.APP_TZ })
  if (variant === 'collapsed') r = collapsed(r)
  else if (variant === 'lunar') r = lunar(r)
  else if (variant === 'no-upcoming') r = { ...r, blocks: { ...r.blocks, upcoming: [] } }
  else if (variant === 'long') r = long(r)
  else if (variant === 'empty-onboarding') r = { ...r, isEmpty: true, needsOnboarding: true }
  return <HomeView initial={r} tz={env.APP_TZ} />
}
