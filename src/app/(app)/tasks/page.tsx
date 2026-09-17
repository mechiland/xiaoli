import { redirect } from 'next/navigation'
import { HomeView } from '@/components/home'
import { signInHref } from '@/lib/links'
import { getDb } from '@/server/db'
import { getHomeBlocks } from '@/server/home'
import { getServerUser } from '@/server/session'
import { homeEnv } from '../_home/load'

export const dynamic = 'force-dynamic'

export default async function Page({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await getServerUser()
  if (!user) redirect(signInHref)
  const env = homeEnv()
  const initial = await getHomeBlocks(getDb(), user.id, { tz: env.APP_TZ })
  const taskRange = (await searchParams).range === '30' ? 30 : 7
  return <HomeView initial={initial} tz={env.APP_TZ} view="tasks" taskRange={taskRange} />
}
