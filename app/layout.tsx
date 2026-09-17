import type { Metadata, Viewport } from 'next'
import { Inter, Noto_Serif_SC } from 'next/font/google'
import type { ReactNode } from 'react'
import './globals.css'

// Headings: Noto Serif SC. Data/labels/time: Inter. Body: system CJK sans (styles/tokens.css).
const notoSerifSC = Noto_Serif_SC({
  weight: ['500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-serif-sc',
})

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: { default: '小丽', template: '%s · 小丽' },
  description: '从聊天记录里长出来的人物档案',
}

export const viewport: Viewport = {
  themeColor: '#f2eee3',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className={`${notoSerifSC.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  )
}
