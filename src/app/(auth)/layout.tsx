import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { homeHref } from '@/lib/links'
import { getServerUser } from '@/server/session'

export const dynamic = 'force-dynamic'

/** Sign-in / sign-up frame: product name, one quiet paper panel on the warm ground. */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  if (await getServerUser()) redirect(homeHref)
  return (
    <div className="flex min-h-dvh flex-col px-5">
      <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-16">
        <Link href={homeHref} className="mb-2 block font-serif text-[34px] font-semibold leading-tight tracking-[0.12em] text-ink">
          小丽
        </Link>
        <p className="mb-10 text-[14px] leading-7 text-ink-2">从聊天记录里长出来的人物档案。每一条信息，都能点回原话。</p>
        {children}
      </div>
      <footer className="mx-auto w-full max-w-[400px] pb-8 font-data text-[12px] text-ink-3">自用部署 · 数据只属于你</footer>
    </div>
  )
}
