import { hc, type ClientResponse } from 'hono/client'
import type { AppType } from '@/server/app'

/** Typed Hono RPC client for browser code: `unwrap(await api.me.$get())`. */
export const api = hc<AppType>('/', { init: { credentials: 'same-origin' } }).api

export class ApiClientError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
    this.details = details
  }
}

type SuccessBody<T> = T extends { error: { code: string } } ? never : T

/** Non-2xx → throws ApiClientError { status, code, message, details } parsed from the error envelope. */
export async function unwrap<T, S extends number, F extends string>(res: ClientResponse<T, S, F>): Promise<SuccessBody<T>> {
  if (res.ok) {
    if (res.status === 204) return undefined as SuccessBody<T>
    return (await res.json()) as SuccessBody<T>
  }
  let code = 'internal'
  let message = '服务器出错了'
  let details: unknown
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } }
    if (body?.error) {
      code = body.error.code ?? code
      message = body.error.message ?? message
      details = body.error.details
    }
  } catch {
    // non-JSON error body (proxy/HTML); keep defaults
  }
  throw new ApiClientError(res.status, code, message, details)
}
