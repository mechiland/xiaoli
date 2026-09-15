// Small JSON fetch helper for the import overlay. Types come from @/contracts; errors are ApiClientError like `unwrap`.
// (The RPC client's `unwrap` does not accept routes whose validator adds a 400 branch to the response union.)
import { ApiClientError } from '@/lib/api-client'

export async function requestJson<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  })
  if (res.ok) return (await res.json()) as T
  let code = 'internal'
  let message = '服务器出错了'
  let details: unknown
  try {
    const j = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } }
    if (j?.error) {
      code = j.error.code ?? code
      message = j.error.message ?? message
      details = j.error.details
    }
  } catch {
    // non-JSON body
  }
  throw new ApiClientError(res.status, code, message, details)
}

export const importUrl = (id: number) => `/api/imports/${id}`
