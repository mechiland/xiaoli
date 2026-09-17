'use client'

import { CalendarDays, Home, Menu, Settings, Users, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Dialog } from 'radix-ui'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { homeHref, peopleHref, settingsHref, tasksHref } from '@/lib/links'

const destinations = [
  { href: homeHref, label: '主页', icon: Home },
  { href: peopleHref, label: '人物', icon: Users },
  { href: tasksHref, label: '事项', icon: CalendarDays },
]

export function NavigationMenu() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="打开导航菜单" className="size-9 text-ink-2">
          <Menu className="size-5" strokeWidth={1.5} aria-hidden />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--loam-scrim)] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col border-r border-line bg-ground px-5 pb-6 outline-none">
          <div className="flex h-[var(--loam-topbar-height)] items-center gap-4 border-b border-line">
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="关闭导航菜单" className="size-9 text-ink-2">
                <X className="size-5" strokeWidth={1.5} aria-hidden />
              </Button>
            </Dialog.Close>
            <Dialog.Title className="font-serif text-[22px] font-semibold tracking-[0.08em]">小丽</Dialog.Title>
          </div>
          <nav aria-label="主导航" className="mt-6 space-y-1">
            {destinations.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href === peopleHref && pathname.startsWith('/p/'))
              return (
                <Dialog.Close asChild key={href}>
                  <Link href={href} aria-current={active ? 'page' : undefined} className={cn('flex items-center gap-4 border-l-2 px-4 py-3 text-[15px] transition-colors hover:bg-paper-hover', active ? 'border-ink bg-paper font-medium text-ink' : 'border-transparent text-ink-2')}>
                    <Icon className="size-[18px]" strokeWidth={1.5} aria-hidden />
                    {label}
                  </Link>
                </Dialog.Close>
              )
            })}
          </nav>
          <div className="mt-auto border-t border-line pt-4">
            <Dialog.Close asChild>
              <Link href={settingsHref} aria-current={pathname === settingsHref ? 'page' : undefined} className="flex items-center gap-4 px-4 py-3 text-[14px] text-ink-2 hover:bg-paper-hover">
                <Settings className="size-[18px]" strokeWidth={1.5} aria-hidden />设置
              </Link>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
