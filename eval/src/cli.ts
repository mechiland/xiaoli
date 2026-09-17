// eval CLI (ARCHITECTURE §7.5, §7.6). Entry for `pnpm eval` (= `run`) and `pnpm eval:<cmd>`.
//   run [--source synthetic|real|all] [--zip <name>] [--live [--no-record]] [--prompt extract.vN] [--model deepseek-flash]
//       [--compare extract.vM] [--run-id <id>] [--deadline app|none] [--no-write]
//   annotate-view <zip path> [--source synthetic|real]
//   gold-template <zip path> [--source synthetic|real]
//   validate-gold [--source synthetic|real] [--zip <name>]
//   freeze-gold --source synthetic|real [--zip <name>]
//   compare <reportA.json> <reportB.json>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ExtractModel } from '@/contracts'
import { annotateView, freezeGoldFiles, goldTemplate, listGoldFiles, validateGoldFile } from './annotate'
import { loadExtract, loadLlm, loadParser, type LlmMode } from './entries'
import { committedLock, readLock } from './lock'
import { evalPaths, fileTimestamp, sourceOfZipPath, type Source } from './paths'
import { compareReports, isGitIgnored, writeCompare, type EvalReport } from './report'
import { runEval } from './run'

const VALUE_FLAGS = new Set(['source', 'zip', 'prompt', 'model', 'compare', 'run-id', 'deadline'])

export function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      positional.push(a)
      continue
    }
    const eq = a.indexOf('=')
    const key = eq > 0 ? a.slice(2, eq) : a.slice(2)
    if (eq > 0) flags[key] = a.slice(eq + 1)
    else if (VALUE_FLAGS.has(key) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[key] = argv[++i]
    else flags[key] = true
  }
  return { positional, flags }
}

/** process.env plus .env.local (KEY=VALUE lines); values are never printed. */
function loadEnv(root: string): Record<string, unknown> {
  const env: Record<string, unknown> = { ...process.env }
  const file = path.join(root, '.env.local')
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  return env
}

function asSource(v: string | true | undefined, fallback: Source | 'all'): Source | 'all' {
  if (v === undefined) return fallback
  if (v === 'synthetic' || v === 'real' || v === 'all') return v
  throw new Error(`--source must be synthetic, real or all`)
}

async function requireParser(root: string) {
  const p = await loadParser(root)
  if (!p.ok) {
    console.error(`cannot run: parser entry unavailable — ${p.reason}`)
    process.exit(2)
  }
  return p.api
}

async function main(argv: string[]): Promise<number> {
  const paths = evalPaths()
  const root = paths.root
  const [cmd, ...rest] = argv
  const { positional, flags } = parseArgs(rest)
  const readDecisions = () => (existsSync(paths.decisions) ? readFileSync(paths.decisions, 'utf8') : '')

  switch (cmd) {
    case 'run': {
      const env = loadEnv(root)
      const live = flags.live === true
      const mode: LlmMode = live ? (flags['no-record'] === true ? 'live' : 'record') : 'replay'
      const model = ExtractModel.safeParse(typeof flags.model === 'string' ? flags.model : (env.EXTRACT_MODEL ?? 'deepseek-flash'))
      if (!model.success) {
        console.error('invalid model: --model / EXTRACT_MODEL must be one of deepseek-flash, deepseek-v4-pro')
        return 2
      }
      const deadline = flags.deadline === 'none' ? 'none' : 'app'
      const result = await runEval(
        {
          source: asSource(flags.source, 'all'),
          zip: typeof flags.zip === 'string' ? flags.zip : undefined,
          mode,
          model: model.data,
          promptVersion: typeof flags.prompt === 'string' ? flags.prompt : undefined,
          compare: typeof flags.compare === 'string' ? flags.compare : undefined,
          runId: typeof flags['run-id'] === 'string' ? flags['run-id'] : undefined,
          deadlinePolicy: deadline,
          write: flags['no-write'] !== true,
        },
        {
          paths,
          loadParser: () => loadParser(root),
          loadExtract: () => loadExtract(root),
          loadLlm: () => loadLlm(root),
          llmEnv: env,
          baseline: committedLock(root),
          readDecisions,
          now: () => new Date(),
          log: (l) => console.log(l),
        },
      )
      ;(result.exitCode === 0 ? console.log : console.error)(result.message)
      return result.exitCode
    }
    case 'annotate-view':
    case 'gold-template': {
      const zipPath = positional[0]
      if (!zipPath || !existsSync(zipPath)) {
        console.error(`usage: ${cmd} <zip path> [--source synthetic|real]`)
        return 2
      }
      const inferred = sourceOfZipPath(paths, zipPath)
      const source = asSource(flags.source, inferred ?? 'synthetic')
      if (source === 'all') throw new Error('--source must be synthetic or real')
      const parser = await requireParser(root)
      if (cmd === 'annotate-view') {
        const r = await annotateView({ paths, parser, zipPath: path.resolve(zipPath), source })
        console.log(`wrote ${path.relative(root, r.file)} · messages ${r.messageCount} · senders ${r.senders}`)
      } else {
        const r = await goldTemplate({ paths, parser, zipPath: path.resolve(zipPath), source })
        console.log(`wrote ${source === 'real' ? 'eval/gold/real/<zip>.json' : path.relative(root, r.file)}`)
      }
      return 0
    }
    case 'validate-gold': {
      const parser = await requireParser(root)
      const source = flags.source === undefined ? undefined : (asSource(flags.source, 'all') as Source | 'all')
      const files = listGoldFiles(paths, source === 'all' ? undefined : source, typeof flags.zip === 'string' ? flags.zip : undefined)
      if (!files.length) {
        console.error('no gold files found')
        return 1
      }
      let errors = 0
      let realIndex = 0
      for (const f of files) {
        const v = await validateGoldFile({ paths, parser, source: f.source, goldPath: f.goldPath, lock: readLock(paths.lock), baseline: committedLock(root), decisions: readDecisions() })
        errors += v.errors.length
        const label = f.source === 'real' ? (v.lockKey ?? `real-file-${++realIndex}`) : v.zip
        console.log(`[${f.source}] ${label}: ${v.errors.length} error(s), ${v.warnings.length} warning(s)${v.frozen ? ' · frozen' : ''}`)
        if (f.source === 'synthetic') {
          for (const e of v.errors) console.log(`  error: ${e}`)
          for (const w of v.warnings) console.log(`  warning: ${w}`)
        } else if (v.errors.length || v.warnings.length) {
          // real gold contains real names: issue text goes only to a gitignored file, stdout gets its path
          const detailFile = path.join(paths.annotate.real, `validate-${label}.txt`)
          if (isGitIgnored(root, detailFile) === true) {
            mkdirSync(path.dirname(detailFile), { recursive: true })
            writeFileSync(detailFile, [`gold file: ${path.basename(f.goldPath)}`, ...v.errors.map((e) => `error: ${e}`), ...v.warnings.map((w) => `warning: ${w}`)].join('\n') + '\n')
            console.log(`  details: ${path.relative(root, detailFile)}`)
          } else {
            console.log('  (details suppressed: .dev/annotate/real is not confirmed gitignored)')
          }
        }
      }
      return errors ? 1 : 0
    }
    case 'freeze-gold': {
      const source = asSource(flags.source, 'all')
      if (source === 'all') {
        console.error('freeze-gold requires --source synthetic|real')
        return 2
      }
      const parser = await requireParser(root)
      const r = await freezeGoldFiles({ paths, parser, source, zip: typeof flags.zip === 'string' ? flags.zip : undefined, baseline: committedLock(root), readDecisions })
      for (const x of r.results) console.log(`${x.zip}: ${x.action}${x.error ? ` — ${x.error}` : ''}`)
      return r.exitCode
    }
    case 'compare': {
      const [a, b] = positional
      if (!a || !b) {
        console.error('usage: compare <reportA.json> <reportB.json>')
        return 2
      }
      const ra = JSON.parse(readFileSync(a, 'utf8')) as EvalReport
      const rb = JSON.parse(readFileSync(b, 'utf8')) as EvalReport
      const file = writeCompare(paths, compareReports(ra, rb), fileTimestamp())
      console.log(`wrote ${path.relative(root, file)}`)
      return 0
    }
    default:
      console.error('usage: cli.ts run|annotate-view|gold-template|validate-gold|freeze-gold|compare …')
      return 2
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`eval: ${(e as Error).message}`)
    process.exit(1)
  },
)
