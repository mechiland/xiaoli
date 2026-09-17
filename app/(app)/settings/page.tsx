import type { Metadata } from 'next'
import { PageShell } from '@/components/loam'
import { SettingsView } from '@/components/settings'

export const metadata: Metadata = { title: '设置 · 小丽' }

/** /settings (SPEC §9.11): single page, sections 我 / 抽取 / 数据 / 账户. Blocks fetch on the client. */
export default function SettingsPage() {
  return (
    <PageShell title="设置" width="reading">
      <SettingsView />
    </PageShell>
  )
}
