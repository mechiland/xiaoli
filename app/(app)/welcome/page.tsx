import { redirect } from 'next/navigation'
import { WelcomeForm } from '@/components/home'
import { signInHref } from '@/lib/links'
import { getDb, getUserSettings } from '@/server/db'
import { getServerUser } from '@/server/session'

// First-run onboarding (SPEC §9.12, DECISIONS A5 #21). Reachable any time; not forced by the layout.
export const dynamic = 'force-dynamic'

export default async function WelcomePage() {
  const user = await getServerUser()
  if (!user) redirect(signInHref)
  let names: string[] = []
  try {
    names = (await getUserSettings(getDb(), user.id)).selfDisplayNames
  } catch {
    // prefill only; the form still works
  }
  return (
    <div className="mx-auto w-full max-w-[560px] px-5 pb-24 pt-12 sm:px-8 sm:pt-24">
      <p className="font-data text-[12px] tracking-[0.08em] text-ink-3">开始之前</p>
      <h1 className="loam-page-title mt-3">你在微信里叫什么？</h1>
      <p className="mt-5 text-[16px] leading-[1.9] text-ink-2">
        导入聊天记录时，小丽要分清哪些消息是你发的。填上你在微信里的显示名，导入时就能自动认出你。
      </p>
      <WelcomeForm initialNames={names} />
    </div>
  )
}
