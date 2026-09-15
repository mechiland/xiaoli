'use client'

import { BlockBoundary } from '@/components/loam'
import { AccountBlock } from './AccountBlock'
import { DataBlock } from './DataBlock'
import { ExtractBlock } from './ExtractBlock'
import { SelfNamesBlock } from './SelfNamesBlock'
import { SettingsStyles } from './parts'

/** Section heading sits on a 1px rule; rows follow with the same rule between them. BlockError gets row padding. */
const SECTION = 'settings-block [&>h2]:mb-0 [&>h2]:border-b [&>h2]:border-line [&>h2]:pb-2.5 [&_[data-block-error]]:py-6'

/**
 * Settings page body (SPEC §9.11): four independent blocks 我 / 抽取 / 数据 / 账户.
 * 我 and 抽取 share GET /api/settings; if it fails, each shows its own BlockError while 数据 and 账户 keep working.
 */
export function SettingsView() {
  return (
    <div className="space-y-10 sm:space-y-12" data-settings>
      <SettingsStyles />
      <BlockBoundary title="我" className={SECTION}>
        <SelfNamesBlock />
      </BlockBoundary>
      <BlockBoundary title="抽取" className={SECTION}>
        <ExtractBlock />
      </BlockBoundary>
      <BlockBoundary title="数据" className={SECTION}>
        <DataBlock />
      </BlockBoundary>
      <BlockBoundary title="账户" className={SECTION}>
        <AccountBlock />
      </BlockBoundary>
    </div>
  )
}
