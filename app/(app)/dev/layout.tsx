import { getCloudflareContext } from '@opennextjs/cloudflare'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

/** Hosts module showcase pages at /dev/<module>/<name>; 404 outside development (ARCHITECTURE §8). */
export default function DevLayout({ children }: { children: ReactNode }) {
  let nextjsEnv: string | undefined
  try {
    nextjsEnv = getCloudflareContext().env.NEXTJS_ENV
  } catch {
    nextjsEnv = undefined
  }
  if ((nextjsEnv ?? process.env.NEXTJS_ENV) !== 'development') notFound()
  return <>{children}</>
}
