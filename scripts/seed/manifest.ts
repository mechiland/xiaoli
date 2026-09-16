// `.dev/seed-manifest.json` — tag → id mappings written by `pnpm seed`, read by verify scenarios (ARCHITECTURE §8, §9).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { SEED_MANIFEST_PATH, type SeedAccountName } from './accounts'

export interface ManifestRef {
  id: number
  label?: string
  title?: string
  personId?: number
  chatId?: number
  statement?: string
  /** loop 正文 (SPEC §7 交互层) */
  text?: string
}

export interface AccountManifest {
  userId: string
  email: string
  seededAt: string
  persons: Record<string, ManifestRef>
  imports: Record<string, ManifestRef>
  chats: Record<string, ManifestRef>
  claims: Record<string, ManifestRef>
  /** 段落 (conversation_segments) tags, SPEC §7 交互层 */
  segments: Record<string, ManifestRef>
  /** 未结事项 (loops) tags */
  loops: Record<string, ManifestRef>
  counts: Record<string, number>
}

export interface SeedManifest {
  /** 2 = accounts carry `segments` / `loops` tags (interaction layer) */
  version: 2
  generatedAt: string
  /** 'YYYY-MM-DD' in Asia/Shanghai used for "upcoming" dates */
  today: string
  accounts: Partial<Record<SeedAccountName, AccountManifest>>
}

export function manifestPath(root = process.cwd()): string {
  return path.join(root, SEED_MANIFEST_PATH)
}

export function readManifest(root = process.cwd()): SeedManifest | null {
  const file = manifestPath(root)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as SeedManifest
  } catch {
    return null
  }
}

/** Merges the given accounts into the existing manifest (seeding one account keeps the others' entries). */
export function writeManifest(update: { today: string; accounts: Partial<Record<SeedAccountName, AccountManifest>> }, root = process.cwd()): string {
  const file = manifestPath(root)
  const prev = readManifest(root)
  const next: SeedManifest = {
    version: 2,
    generatedAt: new Date().toISOString(),
    today: update.today,
    accounts: { ...(prev?.accounts ?? {}), ...update.accounts },
  }
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(next, null, 2))
  renameSync(tmp, file)
  return file
}
