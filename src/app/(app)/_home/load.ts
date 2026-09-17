import { getCloudflareContext } from '@opennextjs/cloudflare'
import { HOME_BLOCK_KEYS, type HomeBlockKey } from '@/server/home'
import { parseServerEnv, type ServerEnv } from '@/server/env'

export function homeEnv(): ServerEnv {
  return parseServerEnv(getCloudflareContext().env as unknown as Record<string, unknown>)
}

/**
 * Development-only failure injection for the home showcase: `/?devFail=upcoming,index` (or `all`) makes those blocks'
 * server fetch fail so the page shows the client fallback (loading → data, or BlockError when /api/home fails).
 */
export function devFailBlocks(env: ServerEnv, raw: string | string[] | undefined): HomeBlockKey[] {
  const isDev = (env.NEXTJS_ENV ?? process.env.NEXTJS_ENV) === 'development'
  if (!isDev || typeof raw !== 'string' || !raw) return []
  if (raw === 'all') return HOME_BLOCK_KEYS.filter((k) => k !== 'onboarding')
  const wanted = new Set(raw.split(','))
  return HOME_BLOCK_KEYS.filter((k) => wanted.has(k))
}
