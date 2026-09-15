// pnpm extract:offline <zip> (--gold <gold.json> | --mapping <mapping.json>) [--live [--no-record]] [--prompt extract.vN]
//   [--model deepseek-flash] [--deadline app|none] [--source synthetic|real]
// Runs extractOffline on one export. Only the `mapping` object of a gold file is read (what a user types at mapping time).
// Synthetic: prints the result JSON. Real: writes it to .dev/extract/offline/ (gitignored) and prints counts only.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ExtractModel } from '@/contracts'
import { parseExportZip } from '@/lib/wechat-export'
import { extractOffline } from '@/server/extract'
import { cassetteDirFor, createCliLlm, llmModeFromArgs } from '@/server/llm'
import { loadEnvLocal } from './with-platform'

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== '--')
  const valueFlags = new Set(['gold', 'mapping', 'prompt', 'model', 'deadline', 'source'])
  const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && valueFlags.has(argv[i - 1].replace(/^--/, ''))))
  const zipPath = positional[0]
  const mappingFile = flag(argv, 'gold') ?? flag(argv, 'mapping')
  if (!zipPath || !mappingFile) {
    console.error('usage: pnpm extract:offline <zip> --gold <gold.json> | --mapping <mapping.json> [--live] [--prompt extract.vN] [--deadline app|none]')
    process.exit(2)
  }
  loadEnvLocal()
  const source = (flag(argv, 'source') ?? (path.resolve(zipPath).includes(`${path.sep}fixtures${path.sep}real${path.sep}`) ? 'real' : 'synthetic')) as 'synthetic' | 'real'
  const rawMapping = JSON.parse(readFileSync(mappingFile, 'utf8')) as { mapping?: unknown }
  const mapping = (flag(argv, 'gold') ? rawMapping.mapping : rawMapping) as Parameters<typeof extractOffline>[0]['mapping']
  const model = flag(argv, 'model') ? ExtractModel.parse(flag(argv, 'model')) : undefined
  const deadline = flag(argv, 'deadline') === 'none' ? 'none' : 'app'

  const parsed = await parseExportZip(new Uint8Array(readFileSync(zipPath)), { fileName: path.basename(zipPath) })
  const mode = llmModeFromArgs(argv)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
  const cli = await createCliLlm({ mode, runId: `extract-offline-${stamp}`, runsDir: '.dev/extract/runs', cassetteDir: cassetteDirFor(source) })
  const result = await extractOffline({
    parsed,
    mapping,
    llm: cli.llm,
    model,
    promptVersion: flag(argv, 'prompt'),
    deadlinePolicy: deadline,
    onWindow: (i, total, o) => console.error(`window ${i + 1}/${total}: ${o.status}${o.status === 'done' ? ` +${o.itemsCreated}` : ` ${o.code}`}`),
  })
  const counts = {
    windows: result.windows.length,
    failedWindows: result.windows.filter((w) => w.outcome !== 'done').length,
    persons: result.persons.length,
    handles: result.handles.length,
    relations: result.relations.length,
    claims: result.claims.length,
    events: result.events.length,
    dates: result.dates.length,
    usage: result.usage,
    promptVersion: result.promptVersion,
    model: result.model,
  }
  if (source === 'real') {
    const dir = '.dev/extract/offline'
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${stamp}.json`)
    writeFileSync(file, JSON.stringify(result, null, 2))
    console.log(JSON.stringify({ ...counts, file }, null, 2))
  } else {
    console.log(JSON.stringify(result, null, 2))
    console.error(JSON.stringify(counts))
  }
}

main().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
