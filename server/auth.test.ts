import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, createTestDb } from '@/tests/helpers/test-db'
import type { Db } from '@/server/db'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (r: Response): Promise<any> => r.json()

const ORIGIN = 'http://localhost:3000'

function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

describe('Better Auth flow through the Hono app (email + password)', () => {
  let db: Db
  let dispose: () => Promise<void>
  let app: ReturnType<typeof createTestApp>

  const post = (path: string, body: unknown, cookie?: string) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    })

  beforeAll(async () => {
    const t = await createTestDb()
    db = t.db
    dispose = t.dispose
    app = createTestApp({ db }) // real session middleware (no userId override)
  })
  afterAll(async () => dispose?.())

  it('sign-up sets a session cookie that authorizes /api/me', async () => {
    const res = await post('/api/auth/sign-up/email', { email: 'fresh@xiaoli.test', password: 'synthetic-pass-1', name: '合成用户' })
    expect(res.status).toBe(200)
    const cookie = cookieHeader(res)
    expect(cookie).toMatch(/xiaoli\.session_token=/)

    const me = await app.request('/api/me', { headers: { cookie } })
    expect(me.status).toBe(200)
    expect((await json(me)).user.email).toBe('fresh@xiaoli.test')
  })

  it('sign-in works, a repeated request with the same cookie stays signed in, sign-out revokes', async () => {
    const res = await post('/api/auth/sign-in/email', { email: 'fresh@xiaoli.test', password: 'synthetic-pass-1' })
    expect(res.status).toBe(200)
    const cookie = cookieHeader(res)
    for (let i = 0; i < 2; i++) {
      expect((await app.request('/api/me', { headers: { cookie } })).status).toBe(200)
    }
    const out = await post('/api/auth/sign-out', {}, cookie)
    expect(out.status).toBe(200)
    expect((await app.request('/api/me', { headers: { cookie } })).status).toBe(401)
  })

  it('rejects a wrong password and a duplicate email', async () => {
    const wrong = await post('/api/auth/sign-in/email', { email: 'fresh@xiaoli.test', password: 'wrong-password-9' })
    expect(wrong.status).toBe(401)
    const dup = await post('/api/auth/sign-up/email', { email: 'fresh@xiaoli.test', password: 'synthetic-pass-2', name: 'x' })
    expect(dup.status).toBeGreaterThanOrEqual(400)
    expect((await app.request('/api/me')).status).toBe(401)
  })

  it('rejects passwords shorter than 8', async () => {
    const res = await post('/api/auth/sign-up/email', { email: 'short@xiaoli.test', password: 'short', name: 'x' })
    expect(res.status).toBe(400)
  })
})
