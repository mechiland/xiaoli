// Gold freeze: append-only LOCK with version history + DECISIONS change lines (ARCHITECTURE §7.6).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { GoldLockSchema, type GoldLock } from './gold-schema'
import { zipBase, type Source } from './paths'

export const LOCK_REL_PATH = 'eval/gold/LOCK.json'

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function emptyLock(): GoldLock {
  return { lockVersion: 2, entries: {} }
}

export function parseLock(text: string): GoldLock {
  return GoldLockSchema.parse(JSON.parse(text))
}

export function readLock(file: string): GoldLock {
  if (!existsSync(file)) return emptyLock()
  return parseLock(readFileSync(file, 'utf8'))
}

/** synthetic: ZIP basename (no `.zip`); real: `real-<first 16 hex of the ZIP sha256>` (no names). */
export function lockKeyFor(source: Source, zipFile: string, zipSha256: string): string {
  return source === 'real' ? `real-${zipSha256.slice(0, 16)}` : zipBase(zipFile)
}

/** Text of the `## annotator` section (up to the next `## ` heading). */
export function annotatorSection(decisions: string): string {
  const m = /^## annotator[ \t]*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(decisions)
  return m ? m[1] : ''
}

/** Set of `<lockKey> <sha12>` from `gold-change: <lockKey> <sha12> <reason>` lines under `## annotator`. */
export function goldChangeLines(decisions: string): Set<string> {
  const out = new Set<string>()
  for (const m of annotatorSection(decisions).matchAll(/gold-change:\s*`?([^\s`]+)`?\s+`?([0-9a-f]{12})`?/g)) out.add(`${m[1]} ${m[2]}`)
  return out
}

/** Every entry of `base` exists in `working` and its versions are a prefix of the working versions. */
export function isAppendOf(base: GoldLock, working: GoldLock): boolean {
  for (const [key, be] of Object.entries(base.entries)) {
    const we = working.entries[key]
    if (!we || we.source !== be.source || we.versions.length < be.versions.length) return false
    for (let i = 0; i < be.versions.length; i++) {
      const a = be.versions[i]
      const b = we.versions[i]
      if (a.goldSha256 !== b.goldSha256 || a.messagesSha256 !== b.messagesSha256 || a.frozenAt !== b.frozenAt) return false
    }
  }
  return true
}

/** LOCK as committed at HEAD, or null when there is no git / no committed LOCK. */
export function committedLock(root: string, rel: string = LOCK_REL_PATH): GoldLock | null {
  try {
    const text = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
    return parseLock(text)
  } catch {
    return null
  }
}

export interface GoldStatus {
  lockKey: string
  goldSha256: string
  lockedSha256: string | null
  lockVersions: number
  frozen: boolean
  changeRecorded: boolean | null
  lockAppendOnly: boolean | null
}

export function goldStatus(args: { lock: GoldLock; baseline: GoldLock | null; decisions: string; lockKey: string; goldSha256: string }): GoldStatus {
  const entry = args.lock.entries[args.lockKey]
  const versions = entry?.versions ?? []
  const last = versions[versions.length - 1]
  const lines = goldChangeLines(args.decisions)
  return {
    lockKey: args.lockKey,
    goldSha256: args.goldSha256,
    lockedSha256: last?.goldSha256 ?? null,
    lockVersions: versions.length,
    frozen: !!last && last.goldSha256 === args.goldSha256,
    changeRecorded: versions.length <= 1 ? null : versions.slice(1).every((v) => lines.has(`${args.lockKey} ${v.goldSha256.slice(0, 12)}`)),
    lockAppendOnly: args.baseline ? isAppendOf(args.baseline, args.lock) : null,
  }
}

export class FreezeError extends Error {}

function writeAtomic(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

export function serializeLock(lock: GoldLock): string {
  const sorted: GoldLock = { lockVersion: 2, entries: Object.fromEntries(Object.keys(lock.entries).sort().map((k) => [k, lock.entries[k]])) }
  return JSON.stringify(sorted, null, 2) + '\n'
}

/**
 * Append a version for `lockKey` (ARCHITECTURE §7.6 rules a–c). Throws FreezeError when the working LOCK already dropped
 * committed history, when a second+ version lacks its DECISIONS `gold-change:` line, or when LOCK changed concurrently.
 */
export function freezeGold(args: {
  lockPath: string
  decisions: string
  baseline: GoldLock | null
  lockKey: string
  source: Source
  goldSha256: string
  messagesSha256: string
  now?: string
}): { action: 'appended' | 'noop'; versions: number } {
  const before = existsSync(args.lockPath) ? readFileSync(args.lockPath, 'utf8') : null
  const working = before === null ? emptyLock() : parseLock(before)
  if (args.baseline && !isAppendOf(args.baseline, working)) {
    throw new FreezeError('eval/gold/LOCK.json is not an append of the committed LOCK (a version or entry was removed or edited); restore it from git before freezing')
  }
  const entry = working.entries[args.lockKey]
  if (entry && entry.source !== args.source) throw new FreezeError(`LOCK entry ${args.lockKey} has source ${entry.source}, not ${args.source}`)
  const last = entry?.versions[entry.versions.length - 1]
  if (last && last.goldSha256 === args.goldSha256) return { action: 'noop', versions: entry!.versions.length }
  if (entry) {
    const need = `${args.lockKey} ${args.goldSha256.slice(0, 12)}`
    if (!goldChangeLines(args.decisions).has(need)) {
      throw new FreezeError(`gold for ${args.lockKey} changed after freeze; first add "gold-change: ${need} <reason>" under "## annotator" in docs/DECISIONS.md`)
    }
  }
  const next: GoldLock = JSON.parse(JSON.stringify(working))
  const version = { goldSha256: args.goldSha256, messagesSha256: args.messagesSha256, frozenAt: args.now ?? new Date().toISOString() }
  if (next.entries[args.lockKey]) next.entries[args.lockKey].versions.push(version)
  else next.entries[args.lockKey] = { source: args.source, versions: [version] }
  if (!isAppendOf(working, next)) throw new FreezeError('internal: computed LOCK is not a strict append')
  const now = existsSync(args.lockPath) ? readFileSync(args.lockPath, 'utf8') : null
  if (now !== before) throw new FreezeError('eval/gold/LOCK.json changed while freezing; re-run')
  writeAtomic(args.lockPath, serializeLock(next))
  return { action: 'appended', versions: next.entries[args.lockKey].versions.length }
}
