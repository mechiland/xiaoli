// Strips anything key-like from strings that may end up in errors or logs.
export function redactSecrets(s: string, key?: string | null): string {
  let out = s
  if (key && key.length >= 8) out = out.split(key).join('[redacted]')
  return out
    .replace(/sk-[A-Za-z0-9_*-]{6,}/g, 'sk-[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(api[\s_-]?key[^:=]{0,20}[:=]\s*)\S+/gi, '$1[redacted]')
}

export function errorText(err: unknown, key?: string | null, max = 200): string {
  let s: string
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: unknown } }).cause
    const causeCode = cause && typeof cause === 'object' && typeof cause.code === 'string' ? ` (${cause.code})` : ''
    s = `${err.name}: ${err.message}${causeCode}`
  } else {
    s = String(err)
  }
  return redactSecrets(s, key).slice(0, max)
}

export function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err
}
