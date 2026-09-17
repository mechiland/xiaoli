'use client'

import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useImportOverlay } from '@/components/import-overlay'
import { SearchTrigger } from '@/components/search-overlay'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { signOut } from '@/lib/auth-client'
import { homeHref, settingsHref, signInHref } from '@/lib/links'

/**
 * Top bar, identical on every page (SPEC §9.2): product name → home (left), search entry (center),
 * "导入" + account menu (设置, 退出) (right). No sidebar, no badges, no counts (SPEC §9.3).
 */
export function TopBar({ email }: { email: string }) {
  const importOverlay = useImportOverlay()
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      router.replace(signInHref)
      router.refresh()
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ground/95 backdrop-blur-[2px]">
      <div className="mx-auto grid h-[var(--loam-topbar-height)] max-w-[1080px] grid-cols-[auto_1fr_auto] items-center gap-4 px-5 sm:gap-8 sm:px-8">
        <Link href={homeHref} className="font-serif text-[20px] font-semibold leading-none tracking-[0.08em] text-ink">
          小丽
        </Link>

        <div className="flex justify-end sm:justify-center">
          <SearchTrigger variant="topbar" />
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Button variant="outline" size="sm" onClick={() => importOverlay.open()}>
            导入
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="账户" className="gap-1 px-2 text-ink-2">
                <span className="hidden max-w-[160px] truncate font-data text-[13px] md:inline">{email}</span>
                <span className="font-data text-[13px] md:hidden">账户</span>
                <ChevronDown className="size-3.5" strokeWidth={1.5} aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuLabel className="truncate font-data text-[12px] font-normal text-ink-3">{email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={settingsHref}>设置</Link>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={signingOut} onSelect={() => void handleSignOut()}>
                退出
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
