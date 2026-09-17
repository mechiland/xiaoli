'use client'
// Showcase for the shared PersonPicker (search module): /dev/search/person-picker (development only).

import { useState } from 'react'
import { Meta, PageShell, SectionTitle } from '@/components/loam'
import { PersonPicker, usePersonSearch, type PersonPick, type PersonPickerCandidate } from '@/components/person-picker'

function describe(p: PersonPick | null): string {
  if (!p) return '未选择'
  if (p.kind === 'self') return '我'
  if (p.kind === 'existing') return `已有人物 · ${p.person.label}（#${p.person.id}）`
  return `新建人物 · ${p.label}`
}

export default function PersonPickerShowcase() {
  const lin = usePersonSearch('林知夏', { limit: 1 })
  const deng = usePersonSearch('邓一帆', { limit: 1 })
  const linRef = lin.data?.[0]?.person
  const dengRef = deng.data?.[0]?.person

  const candidates: PersonPickerCandidate[] = [
    ...(linRef ? [{ personId: linRef.id, label: linRef.label, reason: '在『大学同学群』中也叫这个名字' }] : []),
    ...(dengRef ? [{ personId: dengRef.id, label: dengRef.label, reason: '在『羽毛球群』中出现过' }] : []),
  ]

  const [senders, setSenders] = useState<Record<string, PersonPick | null>>({
    我是小丽: { kind: 'self' },
    知夏: null,
    远方来客: { kind: 'new', label: '远方来客' },
  })
  const [actually, setActually] = useState<PersonPick | null>(null)
  const [mergeInto, setMergeInto] = useState<PersonPick | null>(null)

  return (
    <PageShell title="人物选择器" subtitle="PersonPicker · 导入第二步、其实是……、合并到其他人物" width="reading">
      <section className="mb-12">
        <SectionTitle className="mb-1">发送者是谁</SectionTitle>
        <Meta className="mb-4">select 形态：推荐项带理由，可选“我”，可新建。</Meta>
        <div className="border-t border-line">
          {[
            { name: '我是小丽', count: 126 },
            { name: '知夏', count: 88 },
            { name: '远方来客', count: 12 },
          ].map((s) => (
            <div key={s.name} data-sender={s.name} className="grid grid-cols-1 gap-2 border-b border-line py-3 sm:grid-cols-[1fr_280px] sm:items-center sm:gap-6">
              <div className="min-w-0">
                <span className="text-[15px] text-ink">{s.name}</span>
                <span className="ml-3 font-data text-[12px] text-ink-3">{s.count} 条</span>
              </div>
              <PersonPicker
                variant="select"
                value={senders[s.name]}
                onPick={(p) => setSenders((prev) => ({ ...prev, [s.name]: p }))}
                allowSelf
                allowCreate={{ defaultLabel: s.name }}
                candidates={s.name === '知夏' ? candidates : []}
                placeholder="选择人物"
              />
            </div>
          ))}
          <div className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[1fr_280px] sm:items-center sm:gap-6">
            <div className="text-[15px] text-ink-3">（不可用）</div>
            <PersonPicker variant="select" value={null} onPick={() => {}} disabled placeholder="选择人物" />
          </div>
        </div>
      </section>

      <section className="mb-12" data-demo="actually">
        <SectionTitle className="mb-1">其实是……</SectionTitle>
        <Meta className="mb-4">inline 形态：搜索已有人物，排除当前这个人。</Meta>
        <PersonPicker variant="inline" value={actually} onPick={setActually} excludeIds={dengRef ? [dengRef.id] : []} candidates={candidates.slice(0, 1)} placeholder="搜索人物或别名" />
        <Meta className="mt-2" data-testid="actually-value">
          {describe(actually)}
        </Meta>
      </section>

      <section data-demo="merge">
        <SectionTitle className="mb-1">合并到其他人物</SectionTitle>
        <Meta className="mb-4">inline 形态：没有推荐项。</Meta>
        <PersonPicker variant="inline" value={mergeInto} onPick={setMergeInto} placeholder="合并到……" />
        <Meta className="mt-2">{describe(mergeInto)}</Meta>
      </section>
    </PageShell>
  )
}
