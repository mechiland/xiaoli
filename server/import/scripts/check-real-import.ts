// Real-sample import check: parse every ZIP in fixtures/real/ in Node, import it through the running app's API into a
// throwaway account (no attachment uploads), compare counts, then delete the import. Prints NUMBERS ONLY — no names,
// no bodies, no file names (real-1..n by sorted basename).
// Usage: npx tsx server/import/scripts/check-real-import.ts [dir]   (dev server on :3000)
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseExportZip } from '@/lib/wechat-export'

const base = process.env.BASE_URL ?? 'http://localhost:3000'
const dir = resolve(process.argv[2] ?? 'fixtures/real')
let cookie = ''

async function call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const set = res.headers.getSetCookie?.() ?? []
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
  const text = await res.text()
  return { status: res.status, json: (text ? JSON.parse(text) : null) as T }
}

const zips = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.zip')).sort()
const signup = await call('POST', '/api/auth/sign-up/email', { email: `import-real-check+${Date.now()}@xiaoli.test`, password: 'import-real-check-2026', name: 'check' })
if (signup.status !== 200) {
  console.log(JSON.stringify({ signup: signup.status }))
  process.exit(1)
}

let failed = 0
for (const [i, f] of zips.entries()) {
  const tag = `real-${i + 1}`
  const p = await parseExportZip(new Uint8Array(readFileSync(join(dir, f))), { fileName: f })
  const body = { fileName: `${tag}.zip`, sha256: p.sha256, exportedAt: p.exportedAt, parserVersion: p.parserVersion, messages: p.messages, media: p.media, selectedAttachments: [] }
  const created = await call('POST', '/api/imports', body)
  const id = created.json?.import?.id
  const mapped = await call('POST', `/api/imports/${id}/mapping`, {
    chat: { new: { title: tag, kind: p.senders.length === 2 ? 'private' : 'group' } },
    senders: p.senders.map((s, k) => ({ senderName: s.name, target: { newPerson: { label: `sender-${k + 1}` } } })),
  })
  const detail = await call('GET', `/api/imports/${id}`)
  const chats = await call('GET', '/api/chats')
  const chat = chats.json?.chats?.find((c: { id: number }) => c.id === mapped.json?.chat?.id)
  const dup = await call('POST', '/api/imports', body)
  const del = await call('DELETE', `/api/imports/${id}`)
  const row = {
    file: tag,
    parsedMessages: p.messages.length,
    senders: p.senders.length,
    create: created.status,
    mapping: mapped.status,
    importMessageCount: detail.json?.import?.messageCount,
    newMessageCount: detail.json?.import?.newMessageCount,
    chatMessageCount: chat?.messageCount,
    jobs: detail.json?.progress?.total,
    status: detail.json?.import?.status,
    duplicatePost: dup.status,
    deletedMessages: del.json?.deletedMessages,
    chatsLeftAfterDelete: (await call('GET', '/api/chats')).json?.chats?.length,
  }
  const ok =
    row.create === 201 && row.mapping === 200 && row.duplicatePost === 409 &&
    row.importMessageCount === row.parsedMessages && row.newMessageCount === row.parsedMessages &&
    row.chatMessageCount === row.parsedMessages && row.deletedMessages === row.parsedMessages && row.chatsLeftAfterDelete === 0 && (row.jobs ?? 0) > 0
  if (!ok) failed++
  console.log(JSON.stringify({ ...row, ok }))
}
process.exit(failed ? 1 : 0)
