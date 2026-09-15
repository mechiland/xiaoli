// Helpers for settings scenarios. Synthetic data and throwaway accounts only.
import { request, type APIRequestContext } from 'playwright'
import { SEED_PASSWORD } from '@/scripts/seed/accounts'
import type { ScenarioContext } from '@/verify/lib'
import { parseFixture, SELF_NAME } from '../import/_support'

export const EXPORT_TABLES = [
  'chats',
  'imports',
  'importMessages',
  'messages',
  'attachments',
  'persons',
  'handles',
  'relations',
  'claims',
  'claimMentions',
  'events',
  'eventParticipants',
  'importantDates',
  'evidence',
  'extractionJobs',
  'reviewLog',
  'llmCalls',
] as const

export type Dump = Record<(typeof EXPORT_TABLES)[number], unknown[]> & {
  version: number
  user: { id: string; email: string }
  settings: { selfDisplayNames: string[]; extractModel: string | null; highConfidenceThreshold: number; onboardedAt: string | null }
}

export function tableCounts(dump: Dump): Record<string, number> {
  return Object.fromEntries(EXPORT_TABLES.map((t) => [t, dump[t]?.length ?? -1]))
}

/** A separate signed-in API context (its own cookie jar), for a second throwaway account or seed2. */
export async function apiAs(baseUrl: string, account: { email: string; password: string; signUp?: boolean }): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL: baseUrl, extraHTTPHeaders: { origin: baseUrl } })
  const path = account.signUp ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email'
  const res = await ctx.post(path, { data: { email: account.email, password: account.password, name: 'verify' }, failOnStatusCode: false })
  if (res.status() !== 200) {
    await ctx.dispose()
    throw new Error(`${account.signUp ? 'sign-up' : 'sign-in'} failed (HTTP ${res.status()})`)
  }
  return ctx
}

export const THROWAWAY_PASSWORD = SEED_PASSWORD

type Poster = { post(url: string, data: unknown): Promise<{ status: number; json: unknown }>; put(url: string, bytes: Buffer, mime: string): Promise<number> }

export function posterFromContext(ctx: APIRequestContext): Poster {
  return {
    async post(url, data) {
      const r = await ctx.post(url, { data, failOnStatusCode: false })
      return { status: r.status(), json: await r.json().catch(() => null) }
    },
    async put(url, bytes, mime) {
      return (await ctx.put(url, { data: bytes, headers: { 'content-type': mime }, failOnStatusCode: false })).status()
    },
  }
}

export function posterFromScenario(api: ScenarioContext['api']): Poster {
  return {
    async post(url, data) {
      const r = await api.post(url, data)
      return { status: r.status, json: r.json }
    },
    async put(url, bytes, mime) {
      return (await api.raw.put(url, { data: bytes, headers: { 'content-type': mime }, failOnStatusCode: false })).status()
    },
  }
}

/**
 * Imports a synthetic ZIP through the API with its first referenced image selected and uploaded (→ one R2 object
 * under u/<owner>/att/…), a manual claim on a new person, and settings — so delete-all has rows in D1 and R2.
 */
export async function fillAccount(p: Poster, zip: string, chatTitle: string): Promise<{ importId: number; uploaded: number }> {
  const parsed = await parseFixture(zip)
  const image = parsed.media.find((m) => m.referenced && m.kind === 'image')
  const created = await p.post('/api/imports', {
    fileName: parsed.fileName,
    sha256: parsed.sha256,
    exportedAt: parsed.exportedAt,
    parserVersion: parsed.parserVersion,
    messages: parsed.messages,
    media: parsed.media,
    selectedAttachments: image ? [image.name] : [],
  })
  if (created.status !== 201) throw new Error(`POST /api/imports → ${created.status}`)
  const importId = (created.json as { import: { id: number } }).import.id
  const mapped = await p.post(`/api/imports/${importId}/mapping`, {
    chat: { new: { title: chatTitle, kind: 'private' } },
    senders: parsed.senders.map((s) => ({ senderName: s.name, target: s.name === SELF_NAME ? { self: true } : { newPerson: { label: s.name } } })),
  })
  if (mapped.status !== 200) throw new Error(`POST mapping → ${mapped.status}`)
  let uploaded = 0
  if (image) {
    const status = await p.put(`/api/imports/${importId}/attachments/${encodeURIComponent(image.name)}`, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]), image.mime)
    if (status === 200) uploaded = 1
  }
  const person = await p.post('/api/people', { label: `临时人物${chatTitle}` })
  if (person.status === 201) {
    const id = (person.json as { person: { id: number } }).person.id
    await p.post(`/api/people/${id}/claims`, { statement: '在杭州做制片', category: 'work' })
  }
  return { importId, uploaded }
}
