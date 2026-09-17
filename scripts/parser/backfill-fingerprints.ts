// Backfill `messages.fingerprint` after a fingerprint change (PARSER_VERSION wechat-export@2, DECISIONS parser P14).
// Recomputes fingerprint(sender_name, sent_at, kind, body) for stored image/video messages, the only kinds whose
// fingerprint changed, and updates the rows that differ. Idempotent. Prints COUNTS ONLY: no names, bodies or ids.
//
//   npx tsx scripts/parser/backfill-fingerprints.ts [--dry-run]            local D1 (the dev server's)
//   npx tsx scripts/parser/backfill-fingerprints.ts --remote [--env <name>] [--dry-run]   deployed D1 via wrangler
//
// Node-only script (excluded from the no-Node lint); the parser itself stays pure.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fingerprint, type MessageKind } from '@/lib/wechat-export'

type Row = { id: number; sender_name: string; sent_at: string; kind: MessageKind; body: string; fingerprint: string }
const SELECT = `SELECT id, sender_name, sent_at, kind, body, fingerprint FROM messages WHERE kind IN ('image','video')`

function stale(rows: Row[]): { id: number; fp: string }[] {
  const out: { id: number; fp: string }[] = []
  for (const r of rows) {
    const fp = fingerprint({ senderName: r.sender_name, sentAt: r.sent_at, kind: r.kind, body: r.body })
    if (fp !== r.fingerprint) out.push({ id: r.id, fp })
  }
  return out
}

async function local(dryRun: boolean) {
  const { withPlatform } = await import('~/scripts/with-platform')
  return withPlatform(async ({ env }) => {
    const rows = (await env.DB.prepare(SELECT).all<Row>()).results
    const todo = stale(rows)
    if (!dryRun) {
      for (let i = 0; i < todo.length; i += 50) {
        await env.DB.batch(todo.slice(i, i + 50).map((t) => env.DB.prepare('UPDATE messages SET fingerprint = ?1 WHERE id = ?2').bind(t.fp, t.id)))
      }
    }
    return { mediaMessages: rows.length, stale: todo.length }
  })
}

function remote(dryRun: boolean, envName: string | null) {
  const base = ['exec', 'wrangler', 'd1', 'execute', 'DB', '--remote', ...(envName ? ['--env', envName] : [])]
  const out = execFileSync('pnpm', [...base, '--json', '--command', SELECT], { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'inherit'] })
  const rows = (JSON.parse(out.slice(out.indexOf('['))) as { results: Row[] }[])[0].results
  const todo = stale(rows)
  if (!dryRun && todo.length) {
    const dir = mkdtempSync(path.join(tmpdir(), 'xiaoli-fp-'))
    try {
      const file = path.join(dir, 'backfill.sql')
      // ids are integers and fingerprints 16 hex chars, so the SQL carries no user content
      writeFileSync(file, todo.map((t) => `UPDATE messages SET fingerprint = '${t.fp.replace(/[^0-9a-f]/g, '')}' WHERE id = ${Math.trunc(t.id)};`).join('\n') + '\n')
      execFileSync('pnpm', [...base, '--yes', '--file', file], { stdio: ['ignore', 'ignore', 'inherit'] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  return { mediaMessages: rows.length, stale: todo.length }
}

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const envIdx = argv.indexOf('--env')
  const res = argv.includes('--remote') ? remote(dryRun, envIdx >= 0 ? argv[envIdx + 1] : null) : await local(dryRun)
  console.log(JSON.stringify({ target: argv.includes('--remote') ? 'remote' : 'local', dryRun, ...res, updated: dryRun ? 0 : res.stale }))
}

main().catch((e) => {
  console.error((e as Error).message.split('\n')[0])
  process.exit(1)
})
