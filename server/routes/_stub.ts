import type { Context } from 'hono'
import { errors } from '@/server/errors'

/** 501 envelope for routes whose owning module has not landed yet (ARCHITECTURE §1). */
export function notImplemented(c: Context) {
  return c.json(errors.notImplemented().toBody(), 501)
}
