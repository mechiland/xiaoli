// `pnpm dev:ensure`: make sure exactly ONE Next dev server is running on :3000 (ARCHITECTURE §0).
// - ensures .dev.vars (NEXTJS_ENV, BETTER_AUTH_SECRET generated once, DEEPSEEK_API_KEY mirrored from .env.local)
// - applies pending local D1 migrations
// - if http://localhost:3000/api/health does not answer, starts `pnpm dev` detached, logs to .dev/server.log
// - waits until ready (≤ 120 s). Never kills a running server. Never prints secret values.
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 3000
const BASE = `http://localhost:${PORT}`
const DEV_DIR = path.join(ROOT, '.dev')
const LOG = path.join(DEV_DIR, 'server.log')
const PIDFILE = path.join(DEV_DIR, 'server.pid')

function parseDotenv(file: string): Map<string, string> {
  const out = new Map<string, string>()
  if (!existsSync(file)) return out
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out.set(line.slice(0, eq).trim(), v)
  }
  return out
}

/** Keeps existing values; adds missing required ones; mirrors secrets from .env.local. */
export function ensureDevVars(root = ROOT): { changed: string[] } {
  const file = path.join(root, '.dev.vars')
  const vars = parseDotenv(file)
  const local = parseDotenv(path.join(root, '.env.local'))
  const changed: string[] = []
  const set = (k: string, v: string) => {
    if (vars.get(k) !== v) {
      vars.set(k, v)
      changed.push(k)
    }
  }
  if (!vars.get('NEXTJS_ENV')) set('NEXTJS_ENV', 'development')
  if (!vars.get('BETTER_AUTH_SECRET')) set('BETTER_AUTH_SECRET', Array.from(randomBytes(32), (b) => b.toString(16).padStart(2, '0')).join(''))
  if (!vars.get('BETTER_AUTH_URL')) set('BETTER_AUTH_URL', BASE)
  for (const k of ['DEEPSEEK_API_KEY', 'EXTRACT_MODEL', 'DEEPSEEK_BASE_URL', 'LLM_MODE', 'LLM_THINKING']) {
    const v = local.get(k)
    if (v) set(k, v)
  }
  if (changed.length) {
    const body = [...vars.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
    writeFileSync(file, body, { mode: 0o600 })
  }
  return { changed }
}

async function healthy(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) })
    return res.status === 200
  } catch {
    return false
  }
}

async function portInUse(): Promise<boolean> {
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(3000) })
    return true
  } catch {
    return false
  }
}

async function main() {
  mkdirSync(DEV_DIR, { recursive: true })
  const { changed } = ensureDevVars()
  if (changed.length) console.log(`[dev:ensure] .dev.vars updated: ${changed.join(', ')} (values not shown)`)

  if (await healthy()) {
    console.log(`[dev:ensure] dev server already running at ${BASE}`)
    return
  }

  console.log('[dev:ensure] applying local D1 migrations')
  execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'xiaoli', '--local'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, CI: '1' },
  })

  if (await portInUse()) {
    console.log(`[dev:ensure] something already answers on :${PORT} but /api/health is not 200 yet; waiting (not starting a second server)`)
  } else {
    const out = openSync(LOG, 'a')
    const child = spawn('pnpm', ['dev'], { cwd: ROOT, detached: true, stdio: ['ignore', out, out], env: { ...process.env } })
    child.unref()
    writeFileSync(PIDFILE, String(child.pid))
    console.log(`[dev:ensure] started pnpm dev (pid ${child.pid}), log: .dev/server.log`)
  }

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (await healthy()) {
      // Warm the main routes so the first screenshot doesn't pay the compile cost.
      await Promise.allSettled(['/sign-in', '/'].map((p) => fetch(`${BASE}${p}`, { redirect: 'manual', signal: AbortSignal.timeout(60_000) })))
      console.log(`[dev:ensure] ready at ${BASE}`)
      return
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  console.error('[dev:ensure] dev server did not become ready within 120 s; see .dev/server.log')
  process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[dev:ensure] failed:', (err as Error).message)
    process.exit(1)
  })
}
