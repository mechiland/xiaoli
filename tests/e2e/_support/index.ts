// Shared helpers for Playwright specs in tests/e2e/** (module-owned specs import from here).
import type { BrowserContext } from '@playwright/test'
import { readManifest, type AccountManifest } from '~/scripts/seed/manifest'
import type { SeedAccountName } from '~/scripts/seed/accounts'
import { ensureAuth } from '~/verify/lib/auth'

export { SEED_ACCOUNTS, SEED_PASSWORD } from '~/scripts/seed/accounts'

/** Signs the context in as a seed account via the auth API (storageState cached in .dev/verify/). */
export async function signInAs(context: BrowserContext, account: SeedAccountName, base = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000') {
  return ensureAuth(context as never, base, account, process.cwd(), { creds: null })
}

/** The seed manifest entry for an account; throws when seed has not run. */
export function seedManifest(account: SeedAccountName = 'seed'): AccountManifest {
  const m = readManifest()?.accounts[account]
  if (!m) throw new Error(`seed manifest for "${account}" missing — run \`pnpm seed\``)
  return m
}
