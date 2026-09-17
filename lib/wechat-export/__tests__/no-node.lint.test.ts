import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// The runtime parser must work in browsers and Workers: no Node built-ins, no Buffer/process, no server imports.
const ROOT = join(__dirname, '..')
const EXCLUDE_DIRS = new Set(['__tests__', 'scripts'])

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (!EXCLUDE_DIRS.has(name)) out.push(...sources(p))
    } else if (/\.tsx?$/.test(name) && !/\.(test|bench)\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const FORBIDDEN: [RegExp, string][] = [
  [/from\s+['"]node:/, 'node: import'],
  [/from\s+['"](fs|path|crypto|buffer|stream|os|zlib|util|child_process|worker_threads)['"]/, 'node built-in import'],
  [/require\(/, 'require()'],
  [/\bBuffer\./, 'Buffer'],
  [/\bprocess\./, 'process'],
  [/from\s+['"]@\/server/, 'server import'],
  [/from\s+['"]@\/(app|components)/, 'app/components import'],
]

describe('parser has no Node / server dependencies', () => {
  it('source files are clean', () => {
    const files = sources(ROOT)
    expect(files.length).toBeGreaterThan(5)
    const offenders: string[] = []
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n')
      lines.forEach((l, i) => {
        if (l.trim().startsWith('//') || l.trim().startsWith('*')) return
        for (const [re, what] of FORBIDDEN) if (re.test(l)) offenders.push(`${relative(ROOT, f)}:${i + 1} ${what}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('contracts are imported as types only (no zod at runtime in the browser bundle)', () => {
    for (const f of sources(ROOT)) {
      for (const l of readFileSync(f, 'utf8').split('\n')) {
        if (/from\s+['"]@\/contracts['"]/.test(l)) expect(l, relative(ROOT, f)).toMatch(/^\s*(import|export) type /)
      }
    }
  })
})
