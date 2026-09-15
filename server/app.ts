import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '@/server/context'
import { getAuth } from '@/server/auth'
import { ApiError, errors } from '@/server/errors'
import { log } from '@/server/middleware/log'
import { platformMiddleware, sessionMiddleware, type AppDeps } from '@/server/middleware/session'
import { serverTiming } from '@/server/middleware/timing'
import chatsRoute from './routes/chats'
import chatsListRoute from './routes/chats-list'
import evidenceRoute from './routes/evidence'
import exportRoute from './routes/export'
import homeRoute from './routes/home'
import importsRoute from './routes/imports'
import importsReviewRoute from './routes/imports-review'
import meRoute from './routes/me'
import peopleRoute from './routes/people'
import peopleActionsRoute from './routes/people-actions'
import peopleIndexRoute from './routes/people-index'
import reviewRoute from './routes/review'
import searchRoute from './routes/search'
import settingsRoute from './routes/settings'

/**
 * Hono app under /api (ARCHITECTURE §1 "server/app.ts"):
 * platform env/db → Better Auth /auth/* → Server-Timing → session (central 401) → routers in the documented order.
 * `deps` exist for tests (createTestApp); the running app uses the defaults.
 */
export function buildApp(deps: AppDeps = {}) {
  const app = new Hono<AppEnv>()
    .basePath('/api')
    .use('*', platformMiddleware(deps))
    .on(['GET', 'POST'], '/auth/*', (c) => getAuth(c.var.env, c.var.db).handler(c.req.raw))
    .use('*', serverTiming())
    .use('*', sessionMiddleware(deps))
    .route('/', meRoute)
    .route('/', settingsRoute)
    .route('/', importsRoute)
    .route('/', chatsListRoute)
    .route('/', importsReviewRoute)
    .route('/', reviewRoute)
    .route('/', peopleActionsRoute)
    .route('/', peopleIndexRoute)
    .route('/', evidenceRoute)
    .route('/', peopleRoute)
    .route('/', chatsRoute)
    .route('/', homeRoute)
    .route('/', searchRoute)
    .route('/', exportRoute)

  app.notFound((c) => c.json(errors.notFound().toBody(), 404))
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(err.toBody(), err.status)
    if (err instanceof HTTPException) {
      const status = err.status
      const code = status === 401 ? 'unauthorized' : status === 413 ? 'payload_too_large' : status === 404 ? 'not_found' : 'validation_failed'
      return c.json(new ApiError(status, code).toBody(), status)
    }
    // Stack server-side only; never request bodies or secrets.
    log('error', 'unhandled_error', { path: c.req.path, method: c.req.method, name: (err as Error)?.name, stack: (err as Error)?.stack })
    return c.json(errors.internal('服务器出错了').toBody(), 500)
  })
  return app
}

export const app = buildApp()
export type AppType = typeof app
