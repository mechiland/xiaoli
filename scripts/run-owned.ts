// Runs a CLI entry owned by another module; fails with a clear message if that module has not created it yet.
// Usage (package.json): tsx scripts/run-owned.ts <entry> <owner-module> -- [args...]
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const [entry, owner, sep, ...rest] = process.argv.slice(2)
if (!entry || !owner || (sep !== undefined && sep !== '--')) {
  console.error('usage: tsx scripts/run-owned.ts <entry> <owner-module> -- [args...]')
  process.exit(2)
}
const args = sep === '--' ? rest : []
const abs = path.resolve(process.cwd(), entry)
if (!existsSync(abs)) {
  console.error(`[xiaoli] ${entry} does not exist yet. It is owned by the "${owner}" module (docs/ARCHITECTURE.md §1); run this script after that module lands.`)
  process.exit(1)
}
const r = spawnSync(process.execPath, ['--import', 'tsx', abs, ...args], { stdio: 'inherit', env: process.env })
process.exit(r.status ?? 1)
