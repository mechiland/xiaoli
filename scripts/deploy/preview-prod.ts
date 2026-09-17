// `pnpm preview:prod` (ARCHITECTURE §8): the production OpenNext build served locally by workerd (`wrangler dev`)
// with LOCAL D1/R2. Never contacts Cloudflare, never uses port 3000, never touches the dev server's .next.
//
// Usage: pnpm tsx scripts/deploy/preview-prod.ts [--port 8787] [--dir <build worktree>] [--skip-build]
//          [--share-dev-state] [--force-memory]
// - Builds in a clean git worktree (scripts/deploy/build.ts) unless --skip-build.
// - Writes <dir>/.dev.vars: NEXTJS_ENV=production, a throwaway BETTER_AUTH_SECRET, BETTER_AUTH_URL=http://localhost:<port>.
//   No DEEPSEEK_API_KEY: extraction requests answer with an LLM error; nothing is spent.
// - D1/R2 state: <dir>/.wrangler/state (empty; migrations applied here). --share-dev-state uses the repo's
//   .wrangler/state instead (seed data for `pnpm verify _smoke/perf-budgets --base http://localhost:8787`).
// - Runs in the foreground until Ctrl+C. It is the one allowed second server (integrator/deploy only; check memory).
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildForDeploy, defaultBuildDir, repoRoot } from './build'
import { D1_NAME, fail, log, parseArgs, pnpmExec } from './lib'

function availableMemMiB(): number | null {
  try {
    const m = /MemAvailable:\s+(\d+) kB/.exec(readFileSync('/proc/meminfo', 'utf8'))
    return m ? Math.round(Number(m[1]) / 1024) : null
  } catch {
    return null
  }
}

async function portAnswers(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) })
    return true
  } catch {
    return false
  }
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2))
  const port = Number(flags.get('port') ?? 8787)
  if (!Number.isInteger(port) || port <= 0 || port === 3000) fail('--port must be a free port other than 3000')
  const root = repoRoot()
  const dir = typeof flags.get('dir') === 'string' ? path.resolve(flags.get('dir') as string) : defaultBuildDir(root)
  if (path.resolve(dir) === path.resolve(root)) fail('preview must run from a build worktree, not the repository (it would overwrite .dev.vars and .next)')

  const mem = availableMemMiB()
  if (mem !== null && mem < 3000 && !flags.has('force-memory')) fail(`only ${mem} MiB memory available (need ≥ 3000); pass --force-memory to override`)
  if (await portAnswers(port)) fail(`port ${port} is already in use`)

  if (!flags.has('skip-build')) await buildForDeploy({ root, dir })
  else if (!existsSync(path.join(dir, '.open-next', 'worker.js'))) fail(`${dir} has no build; run without --skip-build`)

  const origin = `http://localhost:${port}`
  writeFileSync(
    path.join(dir, '.dev.vars'),
    [`NEXTJS_ENV=production`, `BETTER_AUTH_SECRET=${Array.from(randomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('')}`, `BETTER_AUTH_URL=${origin}`, `APP_TZ=Asia/Shanghai`, ''].join('\n'),
    { mode: 0o600 },
  )
  const persist = flags.has('share-dev-state') ? ['--persist-to', path.join(root, '.wrangler', 'state')] : []
  log(`applying local D1 migrations (${persist.length ? 'shared dev state' : 'build dir state'})`)
  if (pnpmExec(dir, ['wrangler', 'd1', 'migrations', 'apply', D1_NAME, '--local', ...persist], { env: { CI: '1' } }).status !== 0) fail('local migrations failed')

  log(`starting production preview on ${origin} (Ctrl+C to stop)`)
  // pnpm → opennextjs-cloudflare → wrangler → workerd: signalling only `pnpm` leaves wrangler/workerd running on the
  // port (seen in round 1). Run the chain in its own process group and always signal the whole group.
  const child = spawn('pnpm', ['exec', 'opennextjs-cloudflare', 'preview', '--port', String(port), '--ip', '127.0.0.1', ...persist], {
    cwd: dir,
    stdio: 'inherit',
    detached: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  })
  const killGroup = (signal: NodeJS.Signals) => {
    if (child.pid === undefined || child.exitCode !== null) return
    try {
      process.kill(-child.pid, signal)
    } catch {
      // group already gone
    }
  }
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    killGroup('SIGINT')
    setTimeout(() => killGroup('SIGTERM'), 5000).unref()
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  process.on('SIGHUP', stop)
  process.on('exit', () => killGroup('SIGTERM'))
  // An interrupted wrangler exits non-zero (OpenNext then logs "Wrangler dev command failed"); a requested stop is success.
  child.on('exit', (code) => process.exit(stopping ? 0 : (code ?? 0)))
}

main().catch((e) => fail((e as Error).message))
