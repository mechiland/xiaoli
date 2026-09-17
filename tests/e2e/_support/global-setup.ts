// Playwright test global setup: the single dev server must answer and the seed manifest must exist.
// Never starts a second server; `pnpm dev:ensure` is the only launcher.
import { spawnSync } from 'node:child_process'
import { readManifest } from '~/scripts/seed/manifest'

export default async function globalSetup(): Promise<void> {
  const base = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'
  const ok = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) })
    .then((r) => r.status === 200)
    .catch(() => false)
  if (!ok) {
    if (base !== 'http://localhost:3000') throw new Error(`${base}/api/health does not answer`)
    const r = spawnSync('pnpm', ['dev:ensure'], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error('pnpm dev:ensure failed')
  }
  if (!readManifest()?.accounts.seed) throw new Error('seed manifest missing — run `pnpm seed` first')
}
