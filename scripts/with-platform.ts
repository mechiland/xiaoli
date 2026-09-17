// CLI access to local D1/R2 (ARCHITECTURE §4.3). Node only.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { createDb, type Db } from '@/server/db'

/** Loads .env.local into process.env (without overriding) so CLI scripts see DEEPSEEK_API_KEY etc. Values never printed. */
export function loadEnvLocal(root = process.cwd()): void {
  const file = path.join(root, '.env.local')
  if (!existsSync(file)) return
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[key] === undefined) process.env[key] = v
  }
}

export async function withPlatform<T>(fn: (p: { env: CloudflareEnv; db: Db; r2: R2Bucket }) => Promise<T>): Promise<T> {
  loadEnvLocal()
  const proxy = await getPlatformProxy<CloudflareEnv>({ configPath: 'wrangler.jsonc', persist: true })
  try {
    return await fn({ env: proxy.env, db: createDb(proxy.env.DB), r2: proxy.env.R2 })
  } finally {
    await proxy.dispose()
  }
}
