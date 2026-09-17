import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseExportZip, sha256Hex } from '@/lib/wechat-export'
import { __resetUploadsForTests, getUploadEntry, registerUpload, removeUpload, resumeWithFile, startUploads, subscribeUploads } from './upload-store'

const ZIP = path.resolve(__dirname, '..', '..', '..', 'fixtures', 'synthetic', '聊天记录_20260405_223012.zip')

type Call = { url: string; method: string; bytes: number }

/** Fake server: GET detail answers pendingNames; PUT answers from `script(name, attempt)`. */
function fakeServer(pending: string[], script: (name: string, attempt: number) => number | 'network') {
  const calls: Call[] = []
  const attempts = new Map<string, number>()
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method === 'GET') {
      return new Response(JSON.stringify({ import: { id: 1, fileSha256: 'x' }, uploads: { selected: pending.length, uploaded: 0, pendingNames: pending } }), { status: 200 })
    }
    const name = decodeURIComponent(url.split('/attachments/')[1])
    const n = (attempts.get(name) ?? 0) + 1
    attempts.set(name, n)
    calls.push({ url, method, bytes: (init?.body as Uint8Array).byteLength })
    const r = script(name, n)
    if (r === 'network') throw new TypeError('fetch failed')
    return new Response(JSON.stringify(r < 300 ? { attachment: {} } : { error: { code: 'x', message: 'x' } }), { status: r })
  })
  return { fetchImpl, calls, attempts }
}

describe('attachment upload queue', () => {
  let file: File
  let images: string[]
  let sha: string

  beforeEach(async () => {
    __resetUploadsForTests()
    const bytes = new Uint8Array(readFileSync(ZIP))
    const parsed = await parseExportZip(bytes)
    images = parsed.media.filter((m) => m.kind === 'image').map((m) => m.name)
    sha = await sha256Hex(bytes)
    file = new File([bytes], 'x.zip', { type: 'application/zip' })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('uploads pending names one at a time, skips names the server already has, retries transient failures', async () => {
    // the server already has images[0] (e.g. uploaded before a navigation)
    const server = fakeServer(images.slice(1), (name, attempt) => (name === images[1] && attempt < 3 ? (attempt === 1 ? 'network' : 503) : 200))
    vi.stubGlobal('fetch', server.fetchImpl)
    const phases: string[] = []
    const unsub = subscribeUploads(() => phases.push(getUploadEntry(7)!.phase))

    registerUpload(7, file, sha, images)
    await startUploads(7, { delays: [1, 1] })
    unsub()

    const e = getUploadEntry(7)!
    expect(e).toMatchObject({ phase: 'done', total: images.length, uploaded: images.length, failedNames: [] })
    expect(e.bytesUploaded).toBeGreaterThan(0)
    expect(e.bytesUploaded).toBe(e.bytesTotal)
    // images[1] took 3 attempts (network error, 503, 200); nothing was sent for images[0]
    expect(server.attempts.get(images[1])).toBe(3)
    expect(server.calls.some((c) => c.url.endsWith(encodeURIComponent(images[0])))).toBe(false)
    expect(server.calls.every((c) => c.method === 'PUT' && c.url.startsWith('/api/imports/7/attachments/'))).toBe(true)
    expect(phases).toContain('uploading')
    expect(phases.at(-1)).toBe('done')
  })

  it('gives up after 2 retries and reports failed names; 404 is not retried', async () => {
    const server = fakeServer(images, (name) => (name === images[0] ? 500 : name === images[1] ? 404 : 200))
    vi.stubGlobal('fetch', server.fetchImpl)
    registerUpload(8, file, sha, images)
    await startUploads(8, { delays: [1, 1] })
    const e = getUploadEntry(8)!
    expect(e.phase).toBe('error')
    expect(e.failedNames.sort()).toEqual([images[0], images[1]].sort())
    expect(e.uploaded).toBe(images.length - 2)
    expect(server.attempts.get(images[0])).toBe(3)
    expect(server.attempts.get(images[1])).toBe(1)
  })

  it('concurrent starts for the same import run the queue once', async () => {
    const server = fakeServer(images, () => 200)
    vi.stubGlobal('fetch', server.fetchImpl)
    registerUpload(9, file, sha, images)
    await Promise.all([startUploads(9, { delays: [1, 1] }), startUploads(9, { delays: [1, 1] })])
    expect(server.calls.length).toBe(images.length)
  })

  it('resume after reload: wrong file → sha_mismatch; same file → uploads the pending names', async () => {
    const server = fakeServer(images.slice(0, 2), () => 200)
    vi.stubGlobal('fetch', server.fetchImpl)
    const other = new File([new Uint8Array([1, 2, 3])], 'other.zip')
    expect(await resumeWithFile(10, other, sha, images.slice(0, 2))).toBe('sha_mismatch')
    expect(getUploadEntry(10)).toBeUndefined()

    expect(await resumeWithFile(10, file, sha, images.slice(0, 2))).toBe('ok')
    await vi.waitFor(() => expect(getUploadEntry(10)?.phase).toBe('done'))
    expect(server.calls.length).toBe(2)
    removeUpload(10)
    expect(getUploadEntry(10)).toBeUndefined()
  })
})
