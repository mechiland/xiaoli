// Generates src/server/extract/prompts.generated.ts from prompts/*.md so the Worker bundle needs no fs access.
// Run: node --import tsx scripts/extract/gen-prompts.ts   (prompts.test.ts fails when the file is stale)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePromptFile, type PromptFile } from '@/server/extract/prompt-file'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const PROMPTS_DIR = path.join(ROOT, 'prompts')
export const GENERATED_PATH = path.join(ROOT, 'src/server/extract/prompts.generated.ts')

export function loadPromptFiles(dir = PROMPTS_DIR): PromptFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const p = parsePromptFile(readFileSync(path.join(dir, f), 'utf8'))
      if (`${p.version}.md` !== f) throw new Error(`${f}: front-matter version ${p.version} does not match the file name`)
      return p
    })
}

export function renderGenerated(files: PromptFile[]): string {
  const entries = files.map((p) => `  ${JSON.stringify(p.version)}: ${JSON.stringify(p, null, 2).replace(/\n/g, '\n  ')},`).join('\n')
  return `// GENERATED from prompts/*.md by scripts/extract/gen-prompts.ts. Do not edit by hand.
import type { PromptFile } from './prompt-file'

export const PROMPTS: Record<string, PromptFile> = {
${entries}
}
`
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(GENERATED_PATH, renderGenerated(loadPromptFiles()))
  console.log(`wrote ${path.relative(ROOT, GENERATED_PATH)}`)
}
