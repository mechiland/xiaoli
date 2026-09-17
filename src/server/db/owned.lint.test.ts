// Owner-scoping lint (ARCHITECTURE §3): every select/update/delete on a business table in server/** must carry
// owned(...) or an ownerId condition. Whitelist a statement with `// owner-checked: <reason>`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '..', '..')
const SERVER = path.join(ROOT, 'server')
const EXCLUDED_DIRS = [path.join(SERVER, 'db'), path.join(SERVER, 'llm')]
const QUERY = /\.(from|update|delete)\(/
// Common non-DB calls that share the method names.
const NOT_DB = /\b(Array|Buffer|Uint8Array|Object|Promise|Set|Map|String)\.from\(|\b(searchParams|headers|params|map|set|cache|r2|R2|bucket|store|listeners)\.delete\(|\.(from|delete|update)\(\s*['"`]/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (EXCLUDED_DIRS.some((d) => p === d || p.startsWith(d + path.sep))) continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

export function findOffenders(files: { file: string; source: string }[]): string[] {
  const offenders: string[] = []
  for (const { file, source } of files) {
    const lines = source.split('\n')
    lines.forEach((line, i) => {
      if (!QUERY.test(line) || NOT_DB.test(line)) return
      // The statement: this line plus up to 8 following lines, and the preceding line for a whitelist comment.
      const window = lines.slice(Math.max(0, i - 1), i + 9).join('\n')
      if (/owned\(|ownerId|owner_id|owner-checked:/.test(window)) return
      offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`)
    })
  }
  return offenders
}

describe('owner lint', () => {
  it('flags unscoped queries and accepts scoped/whitelisted ones', () => {
    const offenders = findOffenders([
      { file: path.join(SERVER, 'x.ts'), source: 'await db.select().from(claims).where(eq(claims.id, 1))' },
      { file: path.join(SERVER, 'y.ts'), source: 'await db.select().from(claims).where(owned(claims, uid))' },
      { file: path.join(SERVER, 'z.ts'), source: '// owner-checked: rows derived from an owned import\nawait db.delete(evidence).where(inArray(evidence.messageId, ids))' },
      { file: path.join(SERVER, 'w.ts'), source: 'const xs = Array.from(new Set(a))\nparams.delete("q")\n  .delete(\'/people/:id\', (c) => h(c))' },
    ])
    expect(offenders).toEqual(['server/x.ts:1: await db.select().from(claims).where(eq(claims.id, 1))'])
  })

  it('server/** (excluding server/db, server/llm) has no unscoped business queries', () => {
    const files = walk(SERVER).map((file) => ({ file, source: readFileSync(file, 'utf8') }))
    expect(findOffenders(files)).toEqual([])
  })
})
