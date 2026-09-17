import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, createTestDb, createTestUser } from '@/tests/helpers/test-db'
import type { Db } from '@/server/db'
import { Hono } from 'hono'
import { notImplemented } from '@/server/routes/_stub'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (r: Response): Promise<any> => r.json()

describe('Hono app: health, me, settings, stubs, errors', () => {
  let db: Db
  let dispose: () => Promise<void>
  let alice: { id: string; email: string }
  let bob: { id: string; email: string }

  beforeAll(async () => {
    const t = await createTestDb()
    db = t.db
    dispose = t.dispose
    alice = await createTestUser(db, 'alice@xiaoli.test')
    bob = await createTestUser(db, 'bob@xiaoli.test')
  })
  afterAll(async () => dispose?.())

  it('GET /api/health is public and reports db', async () => {
    const res = await createTestApp({ db, userId: null }).request('/api/health')
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ ok: true, db: true })
    expect(res.headers.get('server-timing')).toMatch(/^app;dur=\d+(\.\d+)?$/)
  })

  it('GET /api/me → 401 envelope without a session', async () => {
    const res = await createTestApp({ db, userId: null }).request('/api/me')
    expect(res.status).toBe(401)
    expect(await json(res)).toEqual({ error: { code: 'unauthorized', message: '请先登录' } })
  })

  it('GET /api/me → 200 with user and default settings', async () => {
    const res = await createTestApp({ db, userId: alice.id }).request('/api/me')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.user).toMatchObject({ id: alice.id, email: alice.email })
    expect(body.settings).toEqual({ selfDisplayNames: [], extractModel: null, highConfidenceThreshold: 0.8, onboardedAt: null })
  })

  it('every non-public route requires a session, even stubs', async () => {
    const app = createTestApp({ db, userId: null })
    for (const [method, url] of [
      ['GET', '/api/people'],
      ['GET', '/api/home'],
      ['GET', '/api/search?q=x'],
      ['POST', '/api/imports/check'],
      ['GET', '/api/settings'],
      ['GET', '/api/nope'],
    ] as const) {
      const res = await app.request(url, { method })
      expect(res.status, `${method} ${url}`).toBe(401)
    }
  })

  it('stub routes return the 501 envelope; validation runs first (400)', async () => {
    const app = createTestApp({ db, userId: alice.id })
    // Every wave-3 module has replaced its route stub, so test the shared 501 helper directly.
    const stubApp = new Hono().get('/stub', notImplemented)
    const stub = await stubApp.request('/stub')
    expect(stub.status).toBe(501)
    expect(await json(stub)).toEqual({ error: { code: 'not_implemented', message: '这个功能还在建设中' } })
    const bad = await app.request('/api/people/abc')
    expect(bad.status).toBe(400)
    expect((await json(bad)).error.code).toBe('validation_failed')
    const missing = await app.request('/api/definitely-not-a-route')
    expect(missing.status).toBe(404)
    expect((await json(missing)).error.code).toBe('not_found')
  })

  it('PATCH /api/settings validates, persists, and is isolated per owner', async () => {
    const aliceApp = createTestApp({ db, userId: alice.id })
    const bobApp = createTestApp({ db, userId: bob.id })
    const patch = (app: ReturnType<typeof createTestApp>, body: unknown) =>
      app.request('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

    expect((await patch(aliceApp, { highConfidenceThreshold: 0.2 })).status).toBe(400)
    expect((await patch(aliceApp, { extractModel: 'gpt-x' })).status).toBe(400)

    const ok = await patch(aliceApp, { selfDisplayNames: ['合成名'], highConfidenceThreshold: 0.9, onboarded: true })
    expect(ok.status).toBe(200)
    const s = (await json(ok)).settings
    expect(s).toMatchObject({ selfDisplayNames: ['合成名'], highConfidenceThreshold: 0.9, extractModel: null })
    expect(typeof s.onboardedAt).toBe('string')

    const bobSettings = await json(await bobApp.request('/api/settings'))
    expect(bobSettings.settings).toEqual({ selfDisplayNames: [], extractModel: null, highConfidenceThreshold: 0.8, onboardedAt: null })
  })

  it('invalid env → 500 internal naming no values', async () => {
    const app = createTestApp({ db, userId: alice.id, env: { EXTRACT_MODEL: 'not-a-model' } })
    const res = await app.request('/api/me')
    expect(res.status).toBe(500)
    expect((await json(res)).error.code).toBe('internal')
  })
})
