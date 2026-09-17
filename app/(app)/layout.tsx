import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { QueryProvider } from '@/app/providers'
import { ImportOverlayHost } from '@/components/import-overlay'
import { SearchOverlayHost } from '@/components/search-overlay'
import { TopBar } from '@/components/topbar'
import { signInHref } from '@/lib/links'
import { getServerUser } from '@/server/session'

// Auth gate for every app route (no proxy.ts/middleware on OpenNext, DECISIONS A3).
export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getServerUser()
  if (!user) redirect(signInHref)
  return (
    <QueryProvider>
      <TopBar email={user.email} />
      <main>{children}</main>
      <ImportOverlayHost />
      <SearchOverlayHost />
    </QueryProvider>
  )
}
