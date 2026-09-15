import { getCloudflareContext } from '@opennextjs/cloudflare'
import { headers } from 'next/headers'
import { cache } from 'react'
import { getAuth } from '@/server/auth'
import type { SessionUser } from '@/server/context'
import { getDb } from '@/server/db'
import { parseServerEnv } from '@/server/env'

/** Session for Server Components / layouts (one lookup per render). null when signed out. */
export const getServerUser = cache(async (): Promise<SessionUser | null> => {
  const env = parseServerEnv(getCloudflareContext().env as unknown as Record<string, unknown>)
  const session = await getAuth(env, getDb()).api.getSession({ headers: await headers() })
  if (!session) return null
  return { id: session.user.id, email: session.user.email, name: session.user.name }
})
