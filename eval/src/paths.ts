import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type Source = 'synthetic' | 'real'
export const SOURCES: Source[] = ['synthetic', 'real']

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** All filesystem locations used by eval (ARCHITECTURE §7.1). Tests pass a temp root. */
export interface EvalPaths {
  root: string
  fixtures: Record<Source, string>
  gold: Record<Source, string>
  lock: string
  decisions: string
  reports: string
  reportDetail: Record<Source, string>
  judgeCache: Record<Source, string>
  runs: string
  cassettes: Record<Source, string>
  annotate: Record<Source, string>
  judgePrompts: string
}

export function evalPaths(root: string = REPO_ROOT): EvalPaths {
  const j = (...p: string[]) => path.join(root, ...p)
  return {
    root,
    fixtures: { synthetic: j('fixtures/synthetic'), real: j('fixtures/real') },
    gold: { synthetic: j('eval/gold/synthetic'), real: j('eval/gold/real') },
    lock: j('eval/gold/LOCK.json'),
    decisions: j('docs/DECISIONS.md'),
    reports: j('eval/reports'),
    reportDetail: { synthetic: j('eval/reports/synthetic'), real: j('eval/reports/real') },
    judgeCache: { synthetic: j('eval/judge-cache/synthetic'), real: j('eval/judge-cache/real') },
    runs: j('eval/runs'),
    cassettes: { synthetic: j('fixtures/cassettes/synthetic'), real: j('fixtures/cassettes/real') },
    annotate: { synthetic: j('.dev/annotate/synthetic'), real: j('.dev/annotate/real') },
    judgePrompts: j('eval/prompts'),
  }
}

/**
 * "basename" of a ZIP as used for gold/intent file names and synthetic lock keys: file name without directory and
 * without the `.zip` extension (DECISIONS eval-synthetic E1). `聊天记录_20260405_223012.zip` → `聊天记录_20260405_223012`.
 */
export function zipBase(file: string): string {
  return path.basename(file).replace(/\.zip$/i, '')
}

/** Accepted gold file names for a ZIP, preferred first: `<zip file name>.json` (annotator convention), `<basename>.json`. */
export function goldFileNames(zipFile: string): string[] {
  return [`${zipBase(zipFile)}.zip.json`, `${zipBase(zipFile)}.json`]
}

/** Existing gold file for the ZIP, else the preferred path (DECISIONS eval-synthetic E1). */
export function goldPathFor(paths: EvalPaths, source: Source, zipFile: string): string {
  const candidates = goldFileNames(zipFile).map((n) => path.join(paths.gold[source], n))
  return candidates.find((c) => existsSync(c)) ?? candidates[0]
}

/** Gold file name → ZIP basename (strips `.json` and an optional `.zip`). */
export function zipBaseOfGoldFile(goldFile: string): string {
  return zipBase(path.basename(goldFile).replace(/\.json$/i, ''))
}

export function sourceOfZipPath(paths: EvalPaths, zipPath: string): Source | null {
  const abs = path.resolve(zipPath)
  for (const s of SOURCES) if (abs.startsWith(path.resolve(paths.fixtures[s]) + path.sep)) return s
  return null
}

/** Timestamp used in report/run file names: UTC `YYYYMMDD-HHmmss`. */
export function fileTimestamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}
