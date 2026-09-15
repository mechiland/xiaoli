// Writes server/extract/__fixtures__/cassettes/<promptVersion>/<key>.json for every failure scenario.
// Run: node --import tsx server/extract/__fixtures__/build-cassettes.ts
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCassette, CASSETTE_DIR, FIXTURE_PROMPT_VERSION, SCENARIOS } from './cassette-scenarios'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

async function main() {
  const dir = path.join(ROOT, CASSETTE_DIR, FIXTURE_PROMPT_VERSION)
  mkdirSync(dir, { recursive: true })
  for (const f of readdirSync(dir)) rmSync(path.join(dir, f))
  for (const s of SCENARIOS) {
    const c = await buildCassette(s)
    writeFileSync(path.join(dir, `${c.key}.json`), `${JSON.stringify(c, null, 2)}\n`)
    console.log(`${s.name}: ${c.key}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
