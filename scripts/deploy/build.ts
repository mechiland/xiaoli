// Production build for Cloudflare (ARCHITECTURE §1.13). Local only; never contacts Cloudflare.
//
// Why a separate git worktree by default:
// 1. OpenNext compiles `.env`, `.env.local`, `.env.production(.local)` into .open-next/cloudflare/next-env.mjs, i.e.
//    INTO THE DEPLOYED WORKER. The main checkout's .env.local holds DEEPSEEK_API_KEY for dev, so an in-place build
//    would ship the key inside the bundle. A fresh worktree has no .env files (they are gitignored).
// 2. `next build` writes .next, which the running dev server on :3000 also uses.
// 3. A whole-project file trace (Turbopack) copies project files into .open-next/server-functions; a clean worktree
//    contains only committed files, never fixtures/real, eval/gold/real or artifacts.
//
// Usage: pnpm tsx scripts/deploy/build.ts [--dir <worktree path>] [--in-place] [--skip-install] [--skip-build]
//                                         [--remove-worktree] [--json]
// The worktree gets HEAD plus the root's current wrangler.jsonc and open-next.config.ts (config written by setup.ts).
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { envFilesWithSecrets, fail, log, parseArgs, pnpmExec, scanForSecrets, SECRET_NAMES } from './lib'
import { checkWorkerSize, describeSize, type SizeCheckResult } from './size-check'

export interface BuildOptions {
  root: string
  dir: string
  inPlace?: boolean
  skipInstall?: boolean
  skipBuild?: boolean
}

export interface BuildReport {
  dir: string
  head: string
  uncommittedOutsideConfig: number
  secretScan: { scannedFiles: number; hits: { name: string; file: string }[] }
  size: SizeCheckResult
}

export function git(root: string, args: string[], allowFail = false): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (r.status !== 0 && !allowFail) fail(`git ${args.join(' ')} failed: ${r.stderr.trim()}`)
  return (r.stdout ?? '').trim()
}

export function repoRoot(from = process.cwd()): string {
  return git(from, ['rev-parse', '--show-toplevel'])
}

export function defaultBuildDir(root: string): string {
  return path.resolve(root, '..', `${path.basename(root)}-deploy-build`)
}

function isRegisteredWorktree(root: string, dir: string): boolean {
  const list = git(root, ['worktree', 'list', '--porcelain'])
  return list.split('\n').some((l) => l === `worktree ${dir}`)
}

export function removeWorktree(root: string, dir: string): void {
  if (!existsSync(dir) && !isRegisteredWorktree(root, dir)) return
  if (!isRegisteredWorktree(root, dir)) fail(`${dir} exists but is not a git worktree of ${root}; refusing to delete it`)
  git(root, ['worktree', 'remove', '--force', dir])
  log(`removed worktree ${dir}`)
}

async function devServerUp(): Promise<boolean> {
  try {
    const r = await fetch('http://localhost:3000/api/health', { signal: AbortSignal.timeout(2000) })
    return r.ok
  } catch {
    return false
  }
}

export async function buildForDeploy(o: BuildOptions): Promise<BuildReport> {
  const { root } = o
  const dir = o.inPlace ? root : o.dir
  const head = git(root, ['rev-parse', 'HEAD'])
  const configFiles = ['wrangler.jsonc', 'open-next.config.ts']
  const dirty = git(root, ['status', '--porcelain'])
    .split('\n')
    .filter((l) => l.trim() && !configFiles.includes(l.slice(3).trim()))
  if (o.inPlace) {
    const secrets = envFilesWithSecrets(root)
    if (secrets.length) {
      fail(`in-place build refused: OpenNext would compile ${secrets.map((s) => `${s.keys.join(', ')} from ${s.file}`).join('; ')} into the worker. Build in a worktree (omit --in-place).`)
    }
    if (await devServerUp()) fail('in-place build refused: the dev server on :3000 shares .next; build in a worktree (omit --in-place)')
  } else if (!o.skipBuild) {
    if (path.resolve(dir) === path.resolve(root)) fail('--dir must not be the repository itself (use --in-place deliberately)')
    removeWorktree(root, dir)
    git(root, ['worktree', 'add', '--detach', dir, head])
    for (const f of configFiles) copyFileSync(path.join(root, f), path.join(dir, f))
    log(`worktree ${dir} at ${head.slice(0, 12)} (+ current ${configFiles.join(', ')})`)
    if (dirty.length) log(`note: ${dirty.length} uncommitted change(s) in the repository are NOT part of this build (HEAD only)`)
    const leaked = envFilesWithSecrets(dir)
    if (leaked.length) fail(`worktree unexpectedly contains env files with secrets: ${leaked.map((s) => s.file).join(', ')}`)
  }

  if (!o.skipBuild) {
    if (!o.skipInstall) {
      log('pnpm install --frozen-lockfile')
      if (spawnSync('pnpm', ['install', '--frozen-lockfile'], { cwd: dir, stdio: 'inherit', env: { ...process.env, CI: '1' } }).status !== 0) fail('pnpm install failed')
    }
    log('opennextjs-cloudflare build')
    if (pnpmExec(dir, ['opennextjs-cloudflare', 'build'], { env: { NEXT_TELEMETRY_DISABLED: '1' } }).status !== 0) fail('opennextjs-cloudflare build failed')
  }

  // Secret scan: the values of DEEPSEEK_API_KEY / BETTER_AUTH_SECRET (from the environment, the repo's .env.local and
  // .dev.vars, and the build dir's) must not occur anywhere in .open-next. Only names and file paths are reported.
  const scan = scanForSecrets([path.join(dir, '.open-next')], [root, dir], dir)
  const envModule = path.join(dir, '.open-next', 'cloudflare', 'next-env.mjs')
  if (existsSync(envModule)) {
    const text = readFileSync(envModule, 'utf8')
    for (const n of SECRET_NAMES) if (text.includes(`"${n}"`)) scan.hits.push({ name: n, file: path.relative(dir, envModule) })
  }
  if (scan.hits.length) {
    fail(`secret found in build output (values not shown): ${scan.hits.map((h) => `${h.name} in ${h.file}`).join('; ')}. Do not deploy this build.`)
  }
  log(`secret scan: ${scan.scannedFiles} files, no secret values found`)

  const size = checkWorkerSize(dir)
  for (const l of describeSize(size)) log(l)
  if (size.plan === 'too-large') fail('worker too large to deploy')

  const report: BuildReport = { dir, head, uncommittedOutsideConfig: dirty.length, secretScan: { scannedFiles: scan.scannedFiles, hits: scan.hits }, size }
  mkdirSync(path.join(root, '.dev', 'deploy'), { recursive: true })
  writeFileSync(path.join(root, '.dev', 'deploy', 'build-report.json'), JSON.stringify(report, null, 2) + '\n')
  return report
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { flags } = parseArgs(process.argv.slice(2))
  const root = repoRoot()
  const dir = typeof flags.get('dir') === 'string' ? path.resolve(flags.get('dir') as string) : defaultBuildDir(root)
  if (flags.has('remove-worktree')) {
    removeWorktree(root, dir)
    process.exit(0)
  }
  buildForDeploy({ root, dir, inPlace: flags.has('in-place'), skipInstall: flags.has('skip-install'), skipBuild: flags.has('skip-build') })
    .then((r) => {
      if (flags.has('json')) console.log(JSON.stringify(r, null, 2))
      log(`build ready in ${r.dir} (report: .dev/deploy/build-report.json)`)
    })
    .catch((e) => fail((e as Error).message))
}
