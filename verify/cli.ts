// `pnpm verify <scenario>[,<scenario>...] [--widths 1440,390] [--base http://localhost:3000] [--account seed|seed2|empty|fresh|anonymous] [--headed] [--no-trace]`
// `pnpm verify:list`. Scenario id = <dir>/<name>; a <dir> runs all its scenarios; aliases: smoke, perf. (ARCHITECTURE §8)
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { SCENARIO_ALIASES, selectScenarios } from './lib/log-utils'
import { runScenario } from './lib/runner'
import type { AccountName, ScenarioDefinition } from './lib/types'

const ROOT = process.cwd()
const SCENARIO_DIR = path.join(ROOT, 'verify', 'scenarios')
const ACCOUNTS: AccountName[] = ['seed', 'seed2', 'empty', 'fresh', 'anonymous']

interface Args {
  selectors: string[]
  widths?: number[]
  base: string
  account?: AccountName
  headed: boolean
  list: boolean
  trace?: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = { selectors: [], base: 'http://localhost:3000', headed: false, list: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = () => {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i]
      if (v === undefined) throw new Error(`missing value for ${a}`)
      return v
    }
    if (a === '--list') out.list = true
    else if (a === '--headed') out.headed = true
    else if (a === '--no-trace') out.trace = false
    else if (a.startsWith('--widths')) out.widths = val().split(',').map((w) => Number(w.trim()))
    else if (a.startsWith('--base')) out.base = val().replace(/\/$/, '')
    else if (a.startsWith('--account')) {
      const v = val() as AccountName
      if (!ACCOUNTS.includes(v)) throw new Error(`--account must be one of ${ACCOUNTS.join(', ')}`)
      out.account = v
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`)
    else out.selectors.push(a)
  }
  if (out.widths?.some((w) => !Number.isInteger(w) || w < 320)) throw new Error('--widths must be integers ≥ 320')
  return out
}

function discover(dir = SCENARIO_DIR): { id: string; file: string }[] {
  if (!existsSync(dir)) return []
  const out: { id: string; file: string }[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.endsWith('.scenario.ts')) out.push({ id: path.relative(SCENARIO_DIR, p).replace(/\\/g, '/').replace(/\.scenario\.ts$/, ''), file: p })
    }
  }
  walk(dir)
  return out
}

async function load(file: string): Promise<ScenarioDefinition> {
  const mod = (await import(pathToFileURL(file).href)) as { default?: ScenarioDefinition | { default?: ScenarioDefinition } }
  const def = (mod.default && 'run' in mod.default ? mod.default : (mod.default as { default?: ScenarioDefinition })?.default) as ScenarioDefinition | undefined
  if (!def || typeof def.run !== 'function') throw new Error('file does not default-export defineScenario({...})')
  return def
}

async function healthy(base: string): Promise<boolean> {
  try {
    const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) })
    return r.status === 200
  } catch {
    return false
  }
}

async function ensureServer(base: string): Promise<void> {
  if (await healthy(base)) return
  const u = new URL(base)
  if (!['localhost', '127.0.0.1'].includes(u.hostname) || u.port !== '3000') {
    throw new Error(`${base}/api/health does not answer; verify only starts the dev server for http://localhost:3000`)
  }
  console.log('[verify] dev server not answering; running `pnpm dev:ensure`')
  const r = spawnSync('pnpm', ['dev:ensure'], { cwd: ROOT, stdio: 'inherit' })
  if (r.status !== 0) throw new Error('pnpm dev:ensure failed')
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (await healthy(base)) return
    await new Promise((res) => setTimeout(res, 1000))
  }
  throw new Error('dev server did not become healthy within 120 s')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const all = discover()

  if (args.list) {
    for (const s of all) {
      try {
        const def = await load(s.file)
        const flags = [def.account && def.account !== 'seed' ? `account=${def.account}` : '', def.destructive ? 'destructive' : '', def.widths ? `widths=${def.widths.join(',')}` : '']
          .filter(Boolean)
          .join(' ')
        console.log(`${s.id.padEnd(36)} ${def.description ?? ''}${flags ? `  [${flags}]` : ''}`)
      } catch (err) {
        console.log(`${s.id.padEnd(36)} (failed to load: ${(err as Error).message.split('\n')[0]})`)
      }
    }
    console.log(`\naliases: ${Object.entries(SCENARIO_ALIASES).map(([k, v]) => `${k} → ${v}`).join(', ')}`)
    return 0
  }

  if (!args.selectors.length) {
    console.error('usage: pnpm verify <scenario|dir|alias>[,...] [--widths 1440,390] [--base URL] [--account seed|seed2|empty|fresh|anonymous] [--headed] [--no-trace]\n       pnpm verify:list')
    return 2
  }
  const { selected, unknown } = selectScenarios(args.selectors, all.map((s) => s.id))
  if (unknown.length) {
    console.error(`[verify] unknown scenario(s): ${unknown.join(', ')} — see \`pnpm verify:list\``)
    return 2
  }

  await ensureServer(args.base)
  const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed })
  let failed = 0
  try {
    for (const id of selected) {
      const file = all.find((s) => s.id === id)!.file
      let def: ScenarioDefinition
      try {
        def = await load(file)
      } catch (err) {
        console.error(`✗ ${id}: failed to load scenario — ${(err as Error).message}`)
        failed++
        continue
      }
      if (def.id !== id) console.warn(`[verify] ${path.relative(ROOT, file)} declares id "${def.id}" but its path implies "${id}"; using "${def.id}"`)
      console.log(`▶ ${def.id}${def.description ? ` — ${def.description}` : ''}`)
      const t0 = Date.now()
      const { log, outDir } = await runScenario(def, { browser, baseUrl: args.base, widths: args.widths, account: args.account, root: ROOT, trace: args.trace })
      const rel = path.relative(ROOT, outDir)
      const shots = log.widths.reduce((n, w) => n + w.screenshots.length, 0)
      const summary = `${shots} screenshots, ${log.consoleErrors.filter((e) => !e.expected).length} console errors, ${log.failedRequests.filter((e) => !e.expected).length} failed requests, ${log.apiNon2xx.filter((e) => !e.expected).length} unexpected non-2xx`
      if (log.passed) console.log(`✓ ${def.id} (${((Date.now() - t0) / 1000).toFixed(1)} s) — ${summary}\n  ${rel}/log.json`)
      else {
        failed++
        console.log(`✗ ${def.id} (${((Date.now() - t0) / 1000).toFixed(1)} s) — ${summary}\n  ${rel}/log.json`)
        for (const r of log.failureReasons) console.log(`    - ${r}`)
      }
      for (const b of log.budgets) {
        console.log(`    budget ${b.name}: ${b.missing ? 'MISSING' : b.statisticMs === null ? 'n/a' : `${b.statisticMs} ms`} (target ≤ ${b.target} ms, samples ${b.samplesMs.join('/') || '-'})${b.note ? ` — ${b.note}` : ''} ${b.passed ? 'ok' : 'FAIL'}`)
      }
    }
  } finally {
    await browser.close()
  }
  return failed ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[verify] ${(err as Error).message}`)
    process.exit(1)
  },
)
