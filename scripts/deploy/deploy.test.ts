import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  D1_ID_PLACEHOLDER,
  envFilesWithSecrets,
  FREE_LIMIT_GZ,
  PAID_LIMIT_GZ,
  parseArgs,
  parseJsonc,
  parseWranglerUpload,
  planFor,
  productionConfigProblems,
  readWranglerConfig,
  scanForSecrets,
  type WranglerConfig,
} from './lib'
import { guard, GuardError, runSteps, selectSteps, STEPS, writeAuthUrl, writeD1Id, type SetupContext } from './setup'

const ROOT = path.resolve(__dirname, '..', '..')
const tmps: string[] = []
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'xiaoli-deploy-'))
  tmps.push(d)
  return d
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('wrangler.jsonc', () => {
  const cfg = readWranglerConfig(ROOT)

  it('keeps local dev bindings at top level with the local placeholder id', () => {
    expect(cfg.main).toBe('.open-next/worker.js')
    expect(cfg.compatibility_flags).toEqual(expect.arrayContaining(['nodejs_compat', 'global_fetch_strictly_public']))
    expect(cfg.compatibility_date >= '2024-09-23').toBe(true)
    expect(cfg.d1_databases?.[0]).toMatchObject({ binding: 'DB', database_name: 'xiaoli', database_id: '00000000-0000-0000-0000-000000000000', migrations_dir: 'drizzle' })
    expect(cfg.r2_buckets?.[0]).toMatchObject({ binding: 'R2', bucket_name: 'xiaoli-files' })
  })

  it('has a production env whose placeholders are reported, and no secrets anywhere', () => {
    const problems = productionConfigProblems(cfg)
    expect(problems.some((p) => p.includes('database_id is still the placeholder'))).toBe(true)
    expect(problems.some((p) => p.includes('BETTER_AUTH_URL is still the placeholder'))).toBe(true)
    expect(problems.some((p) => p.includes('must be a secret'))).toBe(false)
    const text = readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8')
    expect(text).not.toMatch(/"(DEEPSEEK_API_KEY|BETTER_AUTH_SECRET)"\s*:/)
  })

  it('becomes deployable after setup writes the D1 id and URL (idempotent)', () => {
    const file = path.join(tmp(), 'wrangler.jsonc')
    copyFileSync(path.join(ROOT, 'wrangler.jsonc'), file)
    const id = '1b2c3d4e-0000-4000-8000-123456789abc'
    expect(writeD1Id(file, id)).toBe('written')
    expect(writeD1Id(file, id)).toBe('unchanged')
    expect(() => writeD1Id(file, '9b2c3d4e-0000-4000-8000-123456789abc')).toThrow(/not replacing/)
    expect(writeAuthUrl(file, 'https://xiaoli.example.workers.dev/')).toBe('written')
    const after = parseJsonc<WranglerConfig>(readFileSync(file, 'utf8'))
    expect(productionConfigProblems(after)).toEqual([])
    expect(after.d1_databases?.[0].database_id).toBe('00000000-0000-0000-0000-000000000000')
    expect(after.env?.production.vars?.BETTER_AUTH_URL).toBe('https://xiaoli.example.workers.dev')
    expect(() => writeAuthUrl(file, 'http://insecure.example')).toThrow(/https/)
  })

  it('flags a secret placed in vars', () => {
    const cfg2 = structuredClone(cfg)
    cfg2.env!.production.vars = { ...cfg2.env!.production.vars, DEEPSEEK_API_KEY: 'x' }
    expect(productionConfigProblems(cfg2)).toContain('DEEPSEEK_API_KEY must be a secret, not a var')
    expect(D1_ID_PLACEHOLDER).toMatch(/^REPLACE_WITH/)
  })
})

describe('setup guard', () => {
  const ctx = (apply: boolean, calls: string[][]): SetupContext => ({
    root: ROOT,
    buildDir: '/nonexistent-build-dir',
    apply,
    rotate: [],
    exec: (_cwd, args) => {
      calls.push(args)
      throw new Error('exec must not be called in plan mode')
    },
    promptSecret: async () => {
      throw new Error('no prompt in plan mode')
    },
    build: async () => {
      throw new Error('no build in plan mode')
    },
  })

  it('plan mode prints every step and executes nothing', async () => {
    const calls: string[][] = []
    const out: string[] = []
    await runSteps(STEPS, ctx(false, calls), (s) => out.push(s))
    expect(calls).toEqual([])
    const text = out.join('\n')
    for (const cmd of ['wrangler d1 create xiaoli', 'wrangler r2 bucket create xiaoli-files', 'wrangler d1 migrations apply xiaoli --remote --env production', 'opennextjs-cloudflare deploy --env production', 'wrangler secret put DEEPSEEK_API_KEY --env production']) {
      expect(text).toContain(cmd)
    }
    expect(text).toContain('nothing was executed')
  })

  it('every step except preflight is guarded, and guard throws without --apply', () => {
    expect(STEPS.filter((s) => !s.guarded).map((s) => s.id)).toEqual(['preflight'])
    for (const s of STEPS.filter((x) => x.guarded)) expect(() => guard(ctx(false, []), s)).toThrow(GuardError)
    expect(() => guard(ctx(true, []), STEPS[1])).not.toThrow()
  })

  it('selects steps and rejects unknown ids', () => {
    expect(selectSteps(['d1', 'r2']).map((s) => s.id)).toEqual(['d1', 'r2'])
    expect(selectSteps(undefined, ['smoke']).map((s) => s.id)).not.toContain('smoke')
    expect(() => selectSteps(['nope'])).toThrow(/unknown step/)
  })
})

describe('build safety helpers', () => {
  it('detects secret-named keys in env files OpenNext would inline (names only)', () => {
    const d = tmp()
    writeFileSync(path.join(d, '.env.local'), 'DEEPSEEK_API_KEY=sk-test-not-real-0000\nAPP_TZ=Asia/Shanghai\n')
    writeFileSync(path.join(d, '.env'), 'EMPTY_TOKEN=\n')
    expect(envFilesWithSecrets(d)).toEqual([{ file: '.env.local', keys: ['DEEPSEEK_API_KEY'] }])
  })

  it('finds a secret value in build output and reports only the name', () => {
    const repo = tmp()
    const out = tmp()
    const fake = 'sk-fake-value-for-scan-test-123456'
    writeFileSync(path.join(repo, '.env.local'), `DEEPSEEK_API_KEY=${fake}\n`)
    writeFileSync(path.join(out, 'clean.js'), 'export const a = 1\n')
    writeFileSync(path.join(out, 'leaky.mjs'), `export const production = {"DEEPSEEK_API_KEY":"${fake}"}\n`)
    const r = scanForSecrets([out], [repo], out)
    expect(r.scannedFiles).toBe(2)
    expect(r.hits).toEqual([{ name: 'DEEPSEEK_API_KEY', file: 'leaky.mjs' }])
    expect(JSON.stringify(r)).not.toContain(fake)
  })

  it('parses wrangler size output and picks the plan', () => {
    expect(parseWranglerUpload('Total Upload: 13712.63 KiB / gzip: 2951.93 KiB')).toEqual({ rawBytes: 14041733, gzipBytes: 3022776 })
    expect(parseWranglerUpload('nothing')).toBeNull()
    expect(planFor(FREE_LIMIT_GZ)).toBe('free')
    expect(planFor(FREE_LIMIT_GZ + 1)).toBe('paid')
    expect(planFor(PAID_LIMIT_GZ + 1)).toBe('too-large')
  })

  it('parses flags', () => {
    const { flags, positional } = parseArgs(['--apply', '--url', 'https://a.b', '--only=d1,r2', 'x'])
    expect(flags.get('apply')).toBe(true)
    expect(flags.get('url')).toBe('https://a.b')
    expect(flags.get('only')).toBe('d1,r2')
    expect(positional).toEqual(['x'])
  })
})
