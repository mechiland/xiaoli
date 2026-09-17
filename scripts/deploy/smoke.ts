// Deploy smoke test (ARCHITECTURE §1.13) against a running deployment or `pnpm preview:prod`.
// Signs up a throwaway user, imports a SYNTHETIC export through the API (parse → POST /api/imports → mapping →
// attachment upload to R2), checks the main pages render, then deletes the user's data (DELETE /api/data).
// No LLM call unless --extract <n> is given (each jobs/next spends live DeepSeek tokens on the target deployment).
//
// Usage: pnpm tsx scripts/deploy/smoke.ts --base https://xiaoli.<subdomain>.workers.dev
//          [--zip fixtures/synthetic/<file>.zip] [--extract <n>] [--keep] [--json]
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseExportZip, readMediaFiles } from '@/lib/wechat-export'
import { fail, parseArgs } from './lib'

const DEFAULT_ZIP = 'fixtures/synthetic/聊天记录_20260405_223012.zip'
const CONFIRM_DELETE_ALL = '删除全部数据' // contracts/api/export.ts DELETE_ALL_CONFIRM_TEXT

interface StepResult {
  name: string
  ok: boolean
  ms: number
  note?: string
}

class Client {
  private jar = new Map<string, string>()
  constructor(readonly base: string) {}

  async req(method: string, p: string, opts: { json?: unknown; body?: Uint8Array; contentType?: string; auth?: boolean; redirect?: RequestRedirect } = {}): Promise<Response> {
    const headers: Record<string, string> = { origin: this.base }
    if (opts.auth !== false && this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ')
    let body: BodyInit | undefined
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(opts.json)
    } else if (opts.body) {
      headers['content-type'] = opts.contentType ?? 'application/octet-stream'
      body = new Blob([opts.body as Uint8Array<ArrayBuffer>])
    }
    const res = await fetch(new URL(p, this.base), { method, headers, body, redirect: opts.redirect ?? 'manual', signal: AbortSignal.timeout(60_000) })
    if (opts.auth !== false) {
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';')
        const eq = pair.indexOf('=')
        if (eq > 0) this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
      }
    }
    return res
  }

  async json<T>(method: string, p: string, expect: number, opts: Parameters<Client['req']>[2] = {}): Promise<T> {
    const res = await this.req(method, p, opts)
    const text = await res.text()
    if (res.status !== expect) throw new Error(`${method} ${p} → ${res.status} (expected ${expect}): ${text.slice(0, 200)}`)
    return JSON.parse(text) as T
  }
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2))
  const baseFlag = flags.get('base')
  if (typeof baseFlag !== 'string') fail('--base <url> is required, e.g. --base http://localhost:8787')
  const base = baseFlag.replace(/\/+$/, '')
  const zipPath = path.resolve(typeof flags.get('zip') === 'string' ? (flags.get('zip') as string) : DEFAULT_ZIP)
  if (/fixtures[\\/]real|eval[\\/]gold[\\/]real|artifacts[\\/]/.test(zipPath)) fail('smoke uses synthetic exports only')
  const extractN = Number(flags.get('extract') ?? 0)
  const jsonOnly = flags.has('json')
  const c = new Client(base)
  const steps: StepResult[] = []
  const say = (s: string) => {
    if (!jsonOnly) console.log(s)
  }

  async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now()
    try {
      const out = await fn()
      const note = typeof out === 'string' && out.length <= 120 ? out : undefined
      steps.push({ name, ok: true, ms: Date.now() - t0, note })
      say(`  ok   ${name} (${Date.now() - t0} ms)${note ? ` — ${note}` : ''}`)
      return out
    } catch (e) {
      steps.push({ name, ok: false, ms: Date.now() - t0, note: (e as Error).message })
      say(`  FAIL ${name}: ${(e as Error).message}`)
      throw e
    }
  }

  async function page(p: string, mustContain?: string): Promise<string> {
    const res = await c.req('GET', p)
    const html = await res.text()
    if (res.status !== 200) throw new Error(`GET ${p} → ${res.status}`)
    if (!(res.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`GET ${p} is not HTML`)
    if (mustContain && !html.includes(mustContain)) throw new Error(`GET ${p} does not contain the expected text`)
    return html
  }

  say(`[smoke] ${base}`)
  let signedUp = false
  let exitCode = 0
  try {
    await step('GET /api/health', async () => {
      const h = await c.json<{ ok: boolean; db: boolean }>('GET', '/api/health', 200, { auth: false })
      if (!h.ok || !h.db) throw new Error(`health ${JSON.stringify(h)}`)
    })
    await step('unauthenticated API is 401', async () => {
      const r = await c.req('GET', '/api/people', { auth: false })
      if (r.status !== 401) throw new Error(`GET /api/people → ${r.status}`)
    })
    const signInHtml = await step('GET /sign-in renders', () => page('/sign-in'))
    await step('static asset served', async () => {
      const m = /\/_next\/static\/[^"'\s]+\.(?:js|css)/.exec(signInHtml)
      if (!m) throw new Error('no /_next/static asset referenced in /sign-in')
      const r = await c.req('GET', m[0], { auth: false })
      if (r.status !== 200) throw new Error(`${m[0]} → ${r.status}`)
      return m[0].split('/').pop()
    })

    const email = `smoke+${Date.now()}@xiaoli.test`
    await step('sign up throwaway user', async () => {
      await c.json('POST', '/api/auth/sign-up/email', 200, { json: { email, password: `smoke-${Date.now()}-pw`, name: 'smoke' } })
      signedUp = true
      const me = await c.json<{ user: { email: string } }>('GET', '/api/me', 200)
      if (me.user.email !== email) throw new Error('/api/me returned another user')
      return email
    })

    const zipBytes = new Uint8Array(readFileSync(zipPath))
    const parsed = await step('parse synthetic export', async () => parseExportZip(zipBytes, { fileName: path.basename(zipPath) }))
    const image = parsed.media.find((m) => m.kind === 'image' && parsed.messages.some((msg) => msg.attachmentName === m.name))

    const created = await step('POST /api/imports', async () => {
      const check = await c.json<{ duplicate: boolean }>('POST', '/api/imports/check', 200, { json: { sha256: parsed.sha256 } })
      if (check.duplicate) throw new Error('fresh user reports a duplicate import')
      return c.json<{ import: { id: number; status: string } }>('POST', '/api/imports', 201, {
        json: { fileName: parsed.fileName, sha256: parsed.sha256, exportedAt: parsed.exportedAt, parserVersion: parsed.parserVersion, messages: parsed.messages, media: parsed.media, selectedAttachments: image ? [image.name] : [] },
      })
    })
    const importId = created.import.id

    const senders = [...parsed.senders].sort((a, b) => b.count - a.count)
    const labels = senders.slice(1).map((s) => s.name)
    const chatTitle = `smoke ${new Date().toISOString().slice(0, 16)}`
    const mapped = await step('POST /api/imports/:id/mapping', async () => {
      const r = await c.json<{ chat: { id: number }; jobsCreated: number; newMessageCount: number }>('POST', `/api/imports/${importId}/mapping`, 200, {
        json: {
          chat: { new: { title: chatTitle, kind: senders.length > 2 ? 'group' : 'private' } },
          senders: senders.map((s, i) => ({ senderName: s.name, target: i === 0 ? { self: true } : { newPerson: { label: s.name } } })),
        },
      })
      if (r.newMessageCount !== parsed.messages.length) throw new Error(`newMessageCount ${r.newMessageCount} ≠ ${parsed.messages.length}`)
      return r
    })

    if (image) {
      await step('attachment upload to R2 and read back', async () => {
        const bytes = (await readMediaFiles(zipBytes, [image.name])).get(image.name)
        if (!bytes) throw new Error('image missing from ZIP')
        const up = await c.json<{ attachment: { uploaded: boolean; url: string | null } }>('PUT', `/api/imports/${importId}/attachments/${encodeURIComponent(image.name)}`, 200, { body: bytes, contentType: image.mime })
        if (!up.attachment.uploaded || !up.attachment.url) throw new Error('attachment not marked uploaded')
        const got = await c.req('GET', up.attachment.url)
        const back = new Uint8Array(await got.arrayBuffer())
        if (got.status !== 200 || back.length !== bytes.length) throw new Error(`read back ${got.status}, ${back.length}/${bytes.length} bytes`)
        return `${bytes.length} bytes`
      })
    }

    const detail = await step('GET /api/imports/:id', async () => {
      const d = await c.json<{ import: { status: string }; progress: { total: number }; persons: { id: number; label: string }[] }>('GET', `/api/imports/${importId}`, 200)
      if (d.progress.total !== mapped.jobsCreated) throw new Error(`progress.total ${d.progress.total} ≠ jobsCreated ${mapped.jobsCreated}`)
      if (!['extracting', 'reviewing'].includes(d.import.status)) throw new Error(`status ${d.import.status}`)
      return d
    })
    const person = detail.persons.find((p) => labels.includes(p.label))

    if (extractN > 0) {
      await step(`POST jobs/next ×${extractN} (live LLM)`, async () => {
        const seen: string[] = []
        for (let i = 0; i < extractN; i++) {
          const r = await c.json<{ processed: { status: string; code?: string } | null; importStatus: string }>('POST', `/api/imports/${importId}/jobs/next`, 200, { json: {} })
          seen.push(r.processed ? `${r.processed.status}${r.processed.code ? `:${r.processed.code}` : ''}` : 'none')
          if (!r.processed) break
        }
        return seen.join(', ')
      })
    }

    await step('GET /api/home', () => c.json('GET', '/api/home', 200).then(() => undefined))
    await step('GET / renders', () => page('/').then(() => undefined))
    await step('GET /imports/:id renders', () => page(`/imports/${importId}`).then(() => undefined))
    // The chat transcript loads per block on the client (DECISIONS chat C1): page render + the APIs it calls.
    await step('GET /chats/:id renders', () => page(`/chats/${mapped.chat.id}`).then(() => undefined))
    await step('GET /api/chats/:id and messages', async () => {
      const chat = await c.json<{ chat: { title: string } }>('GET', `/api/chats/${mapped.chat.id}`, 200)
      if (chat.chat.title !== chatTitle) throw new Error('chat title mismatch')
      const msgs = await c.json<{ messages: unknown[] }>('GET', `/api/chats/${mapped.chat.id}/messages?dir=newer&limit=100`, 200)
      if (msgs.messages.length === 0) throw new Error('no messages returned')
      return `${msgs.messages.length} messages`
    })
    if (person) {
      await step('GET /p/:id renders', () => page(`/p/${person.id}`).then(() => undefined))
      await step('GET /api/people/:id', async () => {
        const r = await c.json<{ person?: { label: string } }>('GET', `/api/people/${person.id}`, 200)
        if (r.person?.label !== person.label) throw new Error('person label mismatch')
      })
      await step('GET /api/search finds the new person', async () => {
        const r = await c.json<{ people: { person: { id: number } }[] }>('GET', `/api/search?q=${encodeURIComponent(person.label)}&types=people`, 200)
        if (!r.people.some((p) => p.person.id === person.id)) throw new Error('person not found by label')
      })
    }
    await step('GET /settings renders', () => page('/settings').then(() => undefined))
  } catch {
    exitCode = 1
  } finally {
    if (signedUp && !flags.has('keep')) {
      await step('cleanup DELETE /api/data', () => c.json('DELETE', '/api/data', 200, { json: { confirm: CONFIRM_DELETE_ALL } }).then(() => undefined)).catch(() => {
        exitCode = 1
      })
    }
  }
  const ok = exitCode === 0 && steps.every((s) => s.ok)
  const summary = { base, ok, steps }
  if (jsonOnly) console.log(JSON.stringify(summary, null, 2))
  else say(`[smoke] ${ok ? 'PASS' : 'FAIL'} — ${steps.filter((s) => s.ok).length}/${steps.length} steps`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => fail((e as Error).message))
