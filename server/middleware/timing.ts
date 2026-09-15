import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '@/server/context'

/** Adds `Server-Timing: app;dur=<ms>` to every /api response (perf budgets, ARCHITECTURE §8). */
export function serverTiming(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = performance.now()
    await next()
    const dur = (performance.now() - start).toFixed(1)
    c.res.headers.append('Server-Timing', `app;dur=${dur}`)
  }
}
