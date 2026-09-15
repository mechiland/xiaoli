import { redirect } from 'next/navigation'
import { HomeView } from '@/components/home'
import { signInHref } from '@/lib/links'
import { getDb } from '@/server/db'
import { getHomeBlocks } from '@/server/home'
import { getServerUser } from '@/server/session'
import { devFailBlocks, homeEnv } from './_home/load'

// Home (SPEC §9.4): Server Component first paint, every block loaded independently (ARCHITECTURE §1.9, §3).
export const dynamic = 'force-dynamic'

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getServerUser()
  if (!user) redirect(signInHref)
  const env = homeEnv()
  const fail = devFailBlocks(env, (await searchParams).devFail)
  const initial = await getHomeBlocks(getDb(), user.id, { tz: env.APP_TZ, fail })
  return <HomeView initial={initial} tz={env.APP_TZ} />
}
