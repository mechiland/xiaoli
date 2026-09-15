// `pnpm db:reset` (integrator only): delete local D1 state for `xiaoli` and re-apply migrations.
// Stop the dev server first if it holds the database; this script refuses to run while :3000 answers.
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'

async function main() {
  try {
    await fetch('http://localhost:3000/api/health', { signal: AbortSignal.timeout(2000) })
    if (!process.argv.includes('--force')) {
      console.error('[db:reset] dev server is running on :3000; stop it first (or pass --force)')
      process.exit(1)
    }
  } catch {
    // not running
  }
  const d1Dir = path.join(process.cwd(), '.wrangler', 'state', 'v3', 'd1')
  if (existsSync(d1Dir)) {
    rmSync(d1Dir, { recursive: true, force: true })
    console.log('[db:reset] removed .wrangler/state/v3/d1')
  }
  execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'xiaoli', '--local'], {
    stdio: 'inherit',
    env: { ...process.env, CI: '1' },
  })
}

main()
