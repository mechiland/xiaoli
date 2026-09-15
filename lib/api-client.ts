import { hc, type ClientResponse } from 'hono/client'
import type { ResponseFormat } from 'hono/types'
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

/** Body type of a (possibly union) RPC response, distributed over its branches. */
type ResponseBody<R> = R extends ClientResponse<infer T, number, ResponseFormat> ? T : never

/**
 * Non-2xx → throws ApiClientError { status, code, message, details } parsed from the error envelope.
 * Accepts the union a validated route returns (`ClientResponse<ApiErrorBody, 400> | ClientResponse<Body, 200>`);
 * error-envelope branches are dropped from the result type (core-request import#1).
 */
export async function unwrap<R extends ClientResponse<unknown, number, ResponseFormat>>(res: R): Promise<SuccessBody<ResponseBody<R>>> {
  type Out = SuccessBody<ResponseBody<R>>
  if (res.ok) {
    if (res.status === 204) return undefined as Out
    return (await res.json()) as Out
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
