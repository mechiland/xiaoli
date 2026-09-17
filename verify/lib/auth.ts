// Login for verify runs: API sign-in inside the browser context, storageState cached per account (ARCHITECTURE §8).
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { BrowserContext } from 'playwright'
import { SEED_ACCOUNTS, SEED_PASSWORD } from '@/scripts/seed/accounts'
import type { AccountName } from './types'

export interface FreshCredentials {
  creds: { email: string; password: string } | null
}

export interface AuthResult {
  email: string | null
}

async function signIn(context: BrowserContext, base: string, email: string, password: string): Promise<number> {
  const res = await context.request.post(`${base}/api/auth/sign-in/email`, {
    data: { email, password },
    headers: { origin: base },
    failOnStatusCode: false,
  })
  return res.status()
}

async function currentEmail(context: BrowserContext, base: string): Promise<string | null> {
  const me = await context.request.get(`${base}/api/me`, { failOnStatusCode: false })
  if (me.status() !== 200) return null
  try {
    return ((await me.json()) as { user?: { email?: string } }).user?.email ?? null
  } catch {
    return null
  }
}

/**
 * seed / seed2 / empty: reuse `.dev/verify/auth-<account>.json` if its session still answers /api/me, else sign in again.
 * fresh: signs up `verify+<ts>@xiaoli.test` once per run (shared across widths). anonymous: no login.
 */
export async function ensureAuth(context: BrowserContext, base: string, account: AccountName, root: string, fresh: FreshCredentials): Promise<AuthResult> {
  if (account === 'anonymous') return { email: null }

  if (account === 'fresh') {
    if (!fresh.creds) {
      const email = `verify+${Date.now()}@xiaoli.test`
      const res = await context.request.post(`${base}/api/auth/sign-up/email`, {
        data: { email, password: SEED_PASSWORD, name: 'verify' },
        headers: { origin: base },
        failOnStatusCode: false,
      })
      if (res.status() !== 200) throw new Error(`sign-up of a fresh account failed (HTTP ${res.status()})`)
      fresh.creds = { email, password: SEED_PASSWORD }
      return { email }
    }
    const status = await signIn(context, base, fresh.creds.email, fresh.creds.password)
    if (status !== 200) throw new Error(`sign-in of the fresh account failed (HTTP ${status})`)
    return { email: fresh.creds.email }
  }

  const acc = SEED_ACCOUNTS[account]
  const file = path.join(root, '.dev', 'verify', `auth-${account}.json`)
  if (existsSync(file)) {
    try {
      const state = JSON.parse(readFileSync(file, 'utf8')) as { cookies?: Parameters<BrowserContext['addCookies']>[0] }
      await context.addCookies(state.cookies ?? [])
      if ((await currentEmail(context, base)) === acc.email) return { email: acc.email }
    } catch {
      // stale or corrupt cache → sign in again
    }
    await context.clearCookies()
  }
  const status = await signIn(context, base, acc.email, acc.password)
  if (status !== 200) throw new Error(`sign-in as ${acc.email} failed (HTTP ${status}) — run \`pnpm seed\` first`)
  mkdirSync(path.dirname(file), { recursive: true })
  await context.storageState({ path: file })
  return { email: acc.email }
}
