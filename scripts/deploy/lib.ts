// Shared helpers for scripts/deploy/* (ARCHITECTURE §1.13). Node only. Never prints secret values.
import { spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

export const WORKER_NAME = 'xiaoli'
export const D1_NAME = 'xiaoli'
export const R2_BUCKET = 'xiaoli-files'
export const REMOTE_ENV = 'production'
export const D1_ID_PLACEHOLDER = 'REPLACE_WITH_D1_DATABASE_ID'
export const URL_PLACEHOLDER = 'https://REPLACE_WITH_PUBLIC_ORIGIN'
/** Secrets the deployed worker needs; set with `wrangler secret put <name> --env production`. */
export const REQUIRED_SECRETS = ['DEEPSEEK_API_KEY', 'BETTER_AUTH_SECRET'] as const
/** Env names whose values must never appear in build output. */
export const SECRET_NAMES = ['DEEPSEEK_API_KEY', 'BETTER_AUTH_SECRET', 'CLOUDFLARE_API_TOKEN'] as const

export const MiB = 1024 * 1024
export const FREE_LIMIT_GZ = 3 * MiB
export const PAID_LIMIT_GZ = 10 * MiB

export function log(msg: string): void {
  console.log(`[deploy] ${msg}`)
}

export function fail(msg: string): never {
  console.error(`[deploy] ERROR: ${msg}`)
  process.exit(1)
}

/** Minimal JSONC → JSON: strips // and /* *\/ comments outside strings and trailing commas. */
export function parseJsonc<T = unknown>(text: string): T {
  let out = ''
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (inStr) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i++
      } else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      out += ch
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (ch === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
    } else out += ch
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1')) as T
}

export interface WranglerConfig {
  name: string
  main?: string
  compatibility_date: string
  compatibility_flags?: string[]
  d1_databases?: { binding: string; database_name: string; database_id: string; migrations_dir?: string }[]
  r2_buckets?: { binding: string; bucket_name: string }[]
  vars?: Record<string, string>
  env?: Record<string, Omit<WranglerConfig, 'env' | 'compatibility_date'> & { compatibility_date?: string }>
}

export function readWranglerConfig(root: string): WranglerConfig {
  return parseJsonc<WranglerConfig>(readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8'))
}

/** Problems that make the production env undeployable (placeholders left, missing bindings, secrets in vars). */
export function productionConfigProblems(cfg: WranglerConfig): string[] {
  const p: string[] = []
  const prod = cfg.env?.[REMOTE_ENV]
  if (!prod) return [`wrangler.jsonc has no env.${REMOTE_ENV}`]
  const db = prod.d1_databases?.find((d) => d.binding === 'DB')
  if (!db) p.push(`env.${REMOTE_ENV}.d1_databases has no DB binding`)
  else if (db.database_id === D1_ID_PLACEHOLDER) p.push(`env.${REMOTE_ENV} D1 database_id is still the placeholder`)
  else if (!/^[0-9a-f-]{36}$/i.test(db.database_id)) p.push(`env.${REMOTE_ENV} D1 database_id is not a UUID`)
  if (!prod.r2_buckets?.some((b) => b.binding === 'R2')) p.push(`env.${REMOTE_ENV}.r2_buckets has no R2 binding`)
  const url = prod.vars?.BETTER_AUTH_URL
  if (!url || url === URL_PLACEHOLDER) p.push(`env.${REMOTE_ENV}.vars.BETTER_AUTH_URL is still the placeholder`)
  else if (!/^https:\/\/[^/]+$/.test(url)) p.push(`env.${REMOTE_ENV}.vars.BETTER_AUTH_URL must be an https origin without a path`)
  for (const name of SECRET_NAMES) {
    if (prod.vars?.[name] !== undefined || cfg.vars?.[name] !== undefined) p.push(`${name} must be a secret, not a var`)
  }
  return p
}

export interface RunResult {
  status: number
  stdout: string
  stderr: string
}

/** Runs `pnpm exec <args>` in root. `capture` pipes output (returned), otherwise inherits the terminal. */
export function pnpmExec(root: string, args: string[], opts: { capture?: boolean; input?: string; env?: Record<string, string> } = {}): RunResult {
  const so: SpawnSyncOptions = {
    cwd: root,
    env: { ...process.env, ...opts.env },
    input: opts.input,
    stdio: opts.input !== undefined ? ['pipe', opts.capture ? 'pipe' : 'inherit', opts.capture ? 'pipe' : 'inherit'] : opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    maxBuffer: 64 * MiB,
  }
  const r = spawnSync('pnpm', ['exec', ...args], so)
  return { status: r.status ?? 1, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') }
}

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(p)
    else if (entry.isFile()) yield p
  }
}

export interface SecretScanResult {
  scannedFiles: number
  /** secret NAMES (never values) whose value was found, with relative file paths */
  hits: { name: string; file: string }[]
  /** env files whose keys would be inlined into the worker by OpenNext (compile-env-files) */
  inlinedEnvFileKeys: { file: string; keys: string[] }[]
}

/** Parses KEY=VALUE lines (dotenv subset). */
export function parseDotenv(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out.set(line.slice(0, eq).trim().replace(/^export\s+/, ''), v)
  }
  return out
}

/** Env files OpenNext compiles into .open-next/cloudflare/next-env.mjs (for every mode). */
export const OPENNEXT_ENV_FILES = ['.env', '.env.production', '.env.development', '.env.local', '.env.production.local', '.env.development.local']

/** Secret-named keys present in the env files OpenNext would inline. Names only. */
export function envFilesWithSecrets(root: string): { file: string; keys: string[] }[] {
  const out: { file: string; keys: string[] }[] = []
  for (const f of OPENNEXT_ENV_FILES) {
    const p = path.join(root, f)
    if (!existsSync(p)) continue
    const keys = [...parseDotenv(readFileSync(p, 'utf8')).entries()].filter(([k, v]) => v && ((SECRET_NAMES as readonly string[]).includes(k) || /SECRET|API_KEY|TOKEN|PASSWORD/i.test(k))).map(([k]) => k)
    if (keys.length) out.push({ file: f, keys })
  }
  return out
}

/**
 * Collects secret values from the given sources (process.env, .env.local, .dev.vars of `valueRoots`) and searches
 * every file under `dirs` for them. Values of length < 12 are ignored (too likely to be ordinary text).
 */
export function scanForSecrets(dirs: string[], valueRoots: string[], relTo: string): SecretScanResult {
  const values = new Map<string, string>()
  const add = (name: string, v: string | undefined) => {
    if (v && v.length >= 12 && !/^generated-locally|^REPLACE_WITH/.test(v)) values.set(v, name)
  }
  for (const n of SECRET_NAMES) add(n, process.env[n])
  for (const r of valueRoots) {
    for (const f of ['.env', '.env.local', '.env.production', '.env.production.local', '.dev.vars']) {
      const p = path.join(r, f)
      if (!existsSync(p)) continue
      for (const [k, v] of parseDotenv(readFileSync(p, 'utf8'))) if ((SECRET_NAMES as readonly string[]).includes(k)) add(k, v)
    }
  }
  const needles = [...values.entries()].map(([v, name]) => ({ name, buf: Buffer.from(v, 'utf8') }))
  const hits: SecretScanResult['hits'] = []
  let scannedFiles = 0
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      scannedFiles++
      if (!needles.length) continue
      const st = statSync(file)
      if (st.size > 256 * MiB) continue
      const buf = readFileSync(file)
      for (const n of needles) if (buf.includes(n.buf)) hits.push({ name: n.name, file: path.relative(relTo, file) })
    }
  }
  return { scannedFiles, hits, inlinedEnvFileKeys: [] }
}

export interface SizeReport {
  files: number
  rawBytes: number
  gzipBytes: number
  plan: 'free' | 'paid' | 'too-large'
  source: 'wrangler-dry-run' | 'computed'
}

/** Parses wrangler's "Total Upload: 1234.56 KiB / gzip: 345.67 KiB". */
export function parseWranglerUpload(out: string): { rawBytes: number; gzipBytes: number } | null {
  const m = /Total Upload:\s*([\d.]+)\s*KiB\s*\/\s*gzip:\s*([\d.]+)\s*KiB/.exec(out)
  if (!m) return null
  return { rawBytes: Math.round(Number(m[1]) * 1024), gzipBytes: Math.round(Number(m[2]) * 1024) }
}

export function planFor(gzipBytes: number): SizeReport['plan'] {
  if (gzipBytes <= FREE_LIMIT_GZ) return 'free'
  if (gzipBytes <= PAID_LIMIT_GZ) return 'paid'
  return 'too-large'
}

/** Upper bound: gzip of each module file in a `wrangler deploy --dry-run --outdir` directory, summed. */
export function computeGzipSize(outdir: string): { files: number; rawBytes: number; gzipBytes: number } {
  let files = 0
  let rawBytes = 0
  let gzipBytes = 0
  for (const f of walk(outdir)) {
    if (f.endsWith('.map') || f.endsWith('README.md')) continue
    const buf = readFileSync(f)
    files++
    rawBytes += buf.length
    gzipBytes += gzipSync(buf, { level: 9 }).length
  }
  return { files, rawBytes, gzipBytes }
}

export function fmtMiB(bytes: number): string {
  return `${(bytes / MiB).toFixed(2)} MiB`
}

/** Flags: `--name value` / `--name=value` / boolean `--name`. */
export function parseArgs(argv: string[]): { flags: Map<string, string | true>; positional: string[] } {
  const flags = new Map<string, string | true>()
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') continue
    if (!a.startsWith('--')) {
      positional.push(a)
      continue
    }
    const eq = a.indexOf('=')
    if (eq > 0) flags.set(a.slice(2, eq), a.slice(eq + 1))
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags.set(a.slice(2), argv[++i])
    else flags.set(a.slice(2), true)
  }
  return { flags, positional }
}
