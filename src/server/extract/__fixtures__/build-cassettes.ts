// Writes server/extract/__fixtures__/cassettes/<promptVersion>/<key>.json for every failure scenario.
// Run: node --import tsx server/extract/__fixtures__/build-cassettes.ts
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCassettes, CASSETTE_DIR, FIXTURE_VERSIONS, SCENARIOS } from './cassette-scenarios'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

async function main() {
  // Each scenario now yields two cassettes (extraction + interaction), in different version directories.
  for (const version of FIXTURE_VERSIONS()) {
    const dir = path.join(ROOT, CASSETTE_DIR, version)
    mkdirSync(dir, { recursive: true })
    for (const f of readdirSync(dir)) rmSync(path.join(dir, f))
  }
  for (const s of SCENARIOS) {
    for (const c of await buildCassettes(s)) {
      const dir = path.join(ROOT, CASSETTE_DIR, c.promptVersion)
      mkdirSync(dir, { recursive: true })
      writeFileSync(path.join(dir, `${c.key}.json`), `${JSON.stringify(c, null, 2)}\n`)
      console.log(`${c.promptVersion} ${s.name}: ${c.key}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
