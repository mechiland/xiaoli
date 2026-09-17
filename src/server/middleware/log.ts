/** JSON-line server log (ARCHITECTURE §3). Never pass message bodies, API keys, auth headers or request bodies. */
export function log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}
