// One-shot, idempotent Cloudflare setup + deploy (ARCHITECTURE §1.13, SPEC §11 M6). See docs/DEPLOY.md.
//
// SAFE BY DEFAULT: without --apply it only prints the plan (every command it would run) and checks wrangler.jsonc.
// Nothing touches Cloudflare, the config file or the build dir unless --apply is given.
//
// Usage:
//   pnpm tsx scripts/deploy/setup.ts                                  # plan only
//   pnpm tsx scripts/deploy/setup.ts --apply --url https://xiaoli.<subdomain>.workers.dev
//   options: --only d1,r2,... | --skip smoke,... | --yes | --d1-location apac | --r2-location apac
//            --rotate-secrets DEEPSEEK_API_KEY[,BETTER_AUTH_SECRET] | --dir <build worktree>
// Steps (in order): preflight, whoami, d1, r2, url, migrate, build, deploy, secrets, smoke.
// Re-running is safe: existing D1/R2/secrets are detected and kept.
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildForDeploy, defaultBuildDir, repoRoot } from './build'
import {
  D1_ID_PLACEHOLDER,
  D1_NAME,
  log,
  parseArgs,
  parseJsonc,
  pnpmExec,
  productionConfigProblems,
  R2_BUCKET,
  readWranglerConfig,
  REMOTE_ENV,
  REQUIRED_SECRETS,
  type RunResult,
  type WranglerConfig,
} from './lib'

export const STEP_IDS = ['preflight', 'whoami', 'd1', 'r2', 'url', 'migrate', 'build', 'deploy', 'secrets', 'smoke'] as const
export type StepId = (typeof STEP_IDS)[number]

export type Exec = (cwd: string, args: string[], opts?: { capture?: boolean; input?: string; env?: Record<string, string> }) => RunResult

export interface SetupContext {
  root: string
  buildDir: string
  apply: boolean
  url?: string
  d1Location?: string
  r2Location?: string
  rotate: string[]
  exec: Exec
  promptSecret: (question: string) => Promise<string>
  build: typeof buildForDeploy
}

export interface Step {
  id: StepId
  title: string
  /** true = talks to Cloudflare or changes local files; only runs with --apply */
  guarded: boolean
  plan: (ctx: SetupContext) => string[]
  run: (ctx: SetupContext) => Promise<void>
}

const W = (...a: string[]) => ['wrangler', ...a]
const WENV: Record<string, string> = { WRANGLER_SEND_METRICS: 'false' }

export class GuardError extends Error {}

/** The one gate every guarded step passes through. */
export function guard(ctx: SetupContext, step: Step): void {
  if (step.guarded && !ctx.apply) throw new GuardError(`step "${step.id}" needs --apply (plan-only run)`)
}

function wranglerPath(root: string) {
  return path.join(root, 'wrangler.jsonc')
}

/** Writes the remote D1 id into env.production. Idempotent; refuses to overwrite a different real id. */
export function writeD1Id(file: string, id: string): 'written' | 'unchanged' {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('D1 id is not a UUID')
  const text = readFileSync(file, 'utf8')
  const cfg = parseJsonc<WranglerConfig>(text)
  const current = cfg.env?.[REMOTE_ENV]?.d1_databases?.find((d) => d.binding === 'DB')?.database_id
  if (current === id) return 'unchanged'
  if (current !== D1_ID_PLACEHOLDER) throw new Error(`env.${REMOTE_ENV} already has D1 id ${current}; not replacing it with ${id}`)
  const next = text.replace(`"database_id": "${D1_ID_PLACEHOLDER}"`, `"database_id": "${id}"`)
  if (next === text) throw new Error('placeholder not found verbatim in wrangler.jsonc')
  writeFileSync(file, next)
  return 'written'
}

/** Sets env.production.vars.BETTER_AUTH_URL (the only occurrence in the file). */
export function writeAuthUrl(file: string, url: string): 'written' | 'unchanged' {
  const origin = new URL(url).origin
  if (!origin.startsWith('https://')) throw new Error('--url must be https')
  const text = readFileSync(file, 'utf8')
  const matches = text.match(/"BETTER_AUTH_URL":\s*"[^"]*"/g) ?? []
  if (matches.length !== 1) throw new Error(`expected exactly one BETTER_AUTH_URL in wrangler.jsonc, found ${matches.length}`)
  const next = text.replace(/"BETTER_AUTH_URL":\s*"[^"]*"/, `"BETTER_AUTH_URL": "${origin}"`)
  if (next === text) return 'unchanged'
  writeFileSync(file, next)
  return 'written'
}

function extractJson<T>(out: string): T {
  const start = out.search(/[[{]/)
  if (start < 0) throw new Error('no JSON in wrangler output')
  return JSON.parse(out.slice(start)) as T
}

/** `wrangler d1 create` / `r2 bucket create` may offer to edit the config; keep our file exactly as it was. */
function withConfigSnapshot<T>(root: string, fn: () => T): T {
  const file = wranglerPath(root)
  const before = readFileSync(file, 'utf8')
  try {
    return fn()
  } finally {
    if (readFileSync(file, 'utf8') !== before) {
      writeFileSync(file, before)
      log('wrangler modified wrangler.jsonc; restored it (bindings are managed by setup.ts)')
    }
  }
}

function must(r: RunResult, what: string): RunResult {
  if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status})${r.stderr ? `: ${r.stderr.trim().split('\n').slice(-3).join(' | ')}` : ''}`)
  return r
}

export const STEPS: Step[] = [
  {
    id: 'preflight',
    title: 'Check wrangler.jsonc (local, read-only)',
    guarded: false,
    plan: () => ['read wrangler.jsonc and report placeholders / secrets in vars'],
    run: async (ctx) => {
      const problems = productionConfigProblems(readWranglerConfig(ctx.root))
      if (problems.length) for (const p of problems) log(`  pending: ${p}`)
      else log('  env.production config complete')
    },
  },
  {
    id: 'whoami',
    title: 'Cloudflare login',
    guarded: true,
    plan: () => ['wrangler whoami   (if not logged in: pnpm exec wrangler login)'],
    run: async (ctx) => {
      must(ctx.exec(ctx.root, W('whoami'), { env: WENV }), 'wrangler whoami (run `pnpm exec wrangler login` first)')
    },
  },
  {
    id: 'd1',
    title: `D1 database "${D1_NAME}"`,
    guarded: true,
    plan: (ctx) => [`wrangler d1 list --json`, `wrangler d1 create ${D1_NAME}${ctx.d1Location ? ` --location ${ctx.d1Location}` : ''}   (only if missing)`, `write its id into wrangler.jsonc env.${REMOTE_ENV}.d1_databases[DB].database_id`],
    run: async (ctx) => {
      const list = () => extractJson<{ uuid: string; name: string }[]>(must(ctx.exec(ctx.root, W('d1', 'list', '--json'), { capture: true, env: WENV }), 'wrangler d1 list').stdout)
      let db = list().find((d) => d.name === D1_NAME)
      if (!db) {
        withConfigSnapshot(ctx.root, () => must(ctx.exec(ctx.root, W('d1', 'create', D1_NAME, ...(ctx.d1Location ? ['--location', ctx.d1Location] : [])), { capture: true, env: WENV }), 'wrangler d1 create'))
        db = list().find((d) => d.name === D1_NAME)
        if (!db) throw new Error('D1 database not listed after create')
        log(`  created D1 ${D1_NAME}`)
      } else log(`  D1 ${D1_NAME} exists`)
      log(`  wrangler.jsonc: database_id ${writeD1Id(wranglerPath(ctx.root), db.uuid)}`)
    },
  },
  {
    id: 'r2',
    title: `R2 bucket "${R2_BUCKET}"`,
    guarded: true,
    plan: (ctx) => ['wrangler r2 bucket list', `wrangler r2 bucket create ${R2_BUCKET}${ctx.r2Location ? ` --location ${ctx.r2Location}` : ''}   (only if missing)`],
    run: async (ctx) => {
      const out = must(ctx.exec(ctx.root, W('r2', 'bucket', 'list'), { capture: true, env: WENV }), 'wrangler r2 bucket list').stdout
      const names = [...out.matchAll(/^name:\s+(\S+)/gm)].map((m) => m[1])
      if (names.includes(R2_BUCKET)) return log(`  R2 ${R2_BUCKET} exists`)
      withConfigSnapshot(ctx.root, () => must(ctx.exec(ctx.root, W('r2', 'bucket', 'create', R2_BUCKET, ...(ctx.r2Location ? ['--location', ctx.r2Location] : [])), { capture: true, env: WENV }), 'wrangler r2 bucket create'))
      log(`  created R2 ${R2_BUCKET}`)
    },
  },
  {
    id: 'url',
    title: 'Public origin (BETTER_AUTH_URL)',
    guarded: true,
    plan: (ctx) => [`write ${ctx.url ?? '<--url>'} into wrangler.jsonc env.${REMOTE_ENV}.vars.BETTER_AUTH_URL`],
    run: async (ctx) => {
      const problems = productionConfigProblems(readWranglerConfig(ctx.root))
      if (!ctx.url) {
        if (problems.some((p) => p.includes('BETTER_AUTH_URL'))) throw new Error('pass --url https://xiaoli.<your-subdomain>.workers.dev (or your custom domain)')
        return log('  BETTER_AUTH_URL already set')
      }
      log(`  wrangler.jsonc: BETTER_AUTH_URL ${writeAuthUrl(wranglerPath(ctx.root), ctx.url)}`)
    },
  },
  {
    id: 'migrate',
    title: 'Remote D1 migrations',
    guarded: true,
    plan: () => [`wrangler d1 migrations apply ${D1_NAME} --remote --env ${REMOTE_ENV}`],
    run: async (ctx) => {
      must(ctx.exec(ctx.root, W('d1', 'migrations', 'apply', D1_NAME, '--remote', '--env', REMOTE_ENV), { env: WENV }), 'remote migrations')
    },
  },
  {
    id: 'build',
    title: 'Production build in a clean worktree (+ secret scan, size check)',
    guarded: true,
    plan: (ctx) => [`git worktree add --detach ${ctx.buildDir} HEAD; copy wrangler.jsonc, open-next.config.ts`, 'pnpm install --frozen-lockfile; opennextjs-cloudflare build', 'scan .open-next for secret values; wrangler deploy --dry-run --env production (size)'],
    run: async (ctx) => {
      const problems = productionConfigProblems(readWranglerConfig(ctx.root))
      if (problems.length) throw new Error(`wrangler.jsonc not ready: ${problems.join('; ')}`)
      await ctx.build({ root: ctx.root, dir: ctx.buildDir })
    },
  },
  {
    id: 'deploy',
    title: 'Deploy worker',
    guarded: true,
    plan: (ctx) => [`(in ${ctx.buildDir}) opennextjs-cloudflare deploy --env ${REMOTE_ENV}`],
    run: async (ctx) => {
      must(ctx.exec(ctx.buildDir, ['opennextjs-cloudflare', 'deploy', '--env', REMOTE_ENV], { env: WENV }), 'opennextjs-cloudflare deploy')
    },
  },
  {
    id: 'secrets',
    title: 'Worker secrets',
    guarded: true,
    plan: (ctx) => [
      `wrangler secret list --env ${REMOTE_ENV} --format json`,
      ...REQUIRED_SECRETS.map((s) => `wrangler secret put ${s} --env ${REMOTE_ENV}   (${ctx.rotate.includes(s) ? 'rotate' : 'only if missing'}; ${s === 'BETTER_AUTH_SECRET' ? 'random 32 bytes' : 'prompted, or $DEEPSEEK_API_KEY'}; value via stdin, never echoed)`),
    ],
    run: async (ctx) => {
      const listed = extractJson<{ name: string }[]>(must(ctx.exec(ctx.root, W('secret', 'list', '--env', REMOTE_ENV, '--format', 'json'), { capture: true, env: WENV }), 'wrangler secret list').stdout).map((s) => s.name)
      for (const name of REQUIRED_SECRETS) {
        if (listed.includes(name) && !ctx.rotate.includes(name)) {
          log(`  ${name} already set`)
          continue
        }
        let value: string
        if (name === 'BETTER_AUTH_SECRET') value = Array.from(randomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('')
        else if (process.env.DEEPSEEK_API_KEY) {
          value = process.env.DEEPSEEK_API_KEY
          log(`  ${name}: using the value from the environment`)
        } else value = (await ctx.promptSecret(`${name} (input hidden): `)).trim()
        if (!value) throw new Error(`${name} is empty`)
        must(ctx.exec(ctx.root, W('secret', 'put', name, '--env', REMOTE_ENV), { input: value, capture: true, env: WENV }), `wrangler secret put ${name}`)
        log(`  ${name} set`)
      }
    },
  },
  {
    id: 'smoke',
    title: 'Smoke test against the deployment',
    guarded: true,
    plan: (ctx) => [`tsx scripts/deploy/smoke.ts --base ${ctx.url ?? '<BETTER_AUTH_URL>'}`],
    run: async (ctx) => {
      const base = ctx.url ?? readWranglerConfig(ctx.root).env?.[REMOTE_ENV]?.vars?.BETTER_AUTH_URL
      if (!base || productionConfigProblems(readWranglerConfig(ctx.root)).some((p) => p.includes('BETTER_AUTH_URL'))) throw new Error('no public URL for smoke')
      must(ctx.exec(ctx.root, ['tsx', 'scripts/deploy/smoke.ts', '--base', base]), 'smoke test')
    },
  },
]

export function selectSteps(only?: string[], skip?: string[]): Step[] {
  for (const id of [...(only ?? []), ...(skip ?? [])]) if (!(STEP_IDS as readonly string[]).includes(id)) throw new Error(`unknown step "${id}" (steps: ${STEP_IDS.join(', ')})`)
  return STEPS.filter((s) => (!only?.length || only.includes(s.id)) && !skip?.includes(s.id))
}

/** Plan-only runs execute only unguarded steps; guarded steps are printed, and guard() is the hard stop. */
export async function runSteps(steps: Step[], ctx: SetupContext, print: (s: string) => void = log): Promise<void> {
  for (const [i, step] of steps.entries()) {
    print(`${i + 1}. ${step.title}${step.guarded && !ctx.apply ? '   [plan only]' : ''}`)
    for (const c of step.plan(ctx)) print(`     $ ${c}`)
    if (step.guarded && !ctx.apply) continue
    guard(ctx, step)
    await step.run(ctx)
  }
  if (!ctx.apply) print('Plan only: nothing was executed against Cloudflare and no file was changed. Re-run with --apply.')
}

export function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    process.stdout.write(question)
    if (!stdin.isTTY) {
      let buf = ''
      stdin.setEncoding('utf8')
      stdin.on('data', (d) => (buf += d))
      stdin.on('end', () => resolve(buf.split('\n')[0] ?? ''))
      stdin.on('error', reject)
      return
    }
    let value = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n' || ch === '') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.off('data', onData)
        process.stdout.write('\n')
        resolve(value)
      } else if (ch === '') {
        stdin.setRawMode(false)
        process.exit(130)
      } else if (ch === '') value = value.slice(0, -1)
      else value += ch
    }
    stdin.on('data', onData)
  })
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2))
  const list = (k: string) => (typeof flags.get(k) === 'string' ? (flags.get(k) as string).split(',').map((s) => s.trim()).filter(Boolean) : undefined)
  const root = repoRoot()
  const apply = flags.has('apply')
  const ctx: SetupContext = {
    root,
    buildDir: typeof flags.get('dir') === 'string' ? path.resolve(flags.get('dir') as string) : defaultBuildDir(root),
    apply,
    url: typeof flags.get('url') === 'string' ? (flags.get('url') as string) : undefined,
    d1Location: typeof flags.get('d1-location') === 'string' ? (flags.get('d1-location') as string) : undefined,
    r2Location: typeof flags.get('r2-location') === 'string' ? (flags.get('r2-location') as string) : undefined,
    rotate: list('rotate-secrets') ?? [],
    exec: (cwd, args, opts) => pnpmExec(cwd, args, opts),
    promptSecret: promptHidden,
    build: buildForDeploy,
  }
  const steps = selectSteps(list('only'), list('skip'))
  if (apply && !flags.has('yes') && process.stdin.isTTY) {
    process.stdout.write(`About to run ${steps.map((s) => s.id).join(', ')} against your Cloudflare account. Type "yes": `)
    const answer = await new Promise<string>((r) => process.stdin.once('data', (d) => r(String(d).trim())))
    process.stdin.pause()
    if (answer !== 'yes') {
      log('aborted')
      process.exit(1)
    }
  }
  await runSteps(steps, ctx)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`[deploy] ERROR: ${(e as Error).message}`)
    process.exit(1)
  })
}
