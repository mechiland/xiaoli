// CLI flag → mode mapping (ARCHITECTURE §5): --live = record, --live --no-record = live, default replay.
import { LlmRequestError, type LlmMode } from './types'

export function llmModeFromArgs(argv: readonly string[], fallback: LlmMode = 'replay'): LlmMode {
  const explicit = argv.find((a) => a.startsWith('--llm-mode='))
  if (explicit) {
    const v = explicit.slice('--llm-mode='.length)
    if (v === 'live' || v === 'record' || v === 'replay') return v
    throw new LlmRequestError(`--llm-mode must be live, record or replay (got ${v})`)
  }
  if (argv.includes('--live')) return argv.includes('--no-record') ? 'live' : 'record'
  return fallback
}
