// Node-only file IO for the llm module. Imported only through dynamic import() from Worker-safe files.
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CassetteSchema, cassetteRelPath, type Cassette, type CassetteStore } from '../cassette'

export async function appendJsonl(file: string, value: unknown): Promise<void> {
  const abs = path.resolve(file)
  await mkdir(path.dirname(abs), { recursive: true })
  await appendFile(abs, `${JSON.stringify(value)}\n`, 'utf8')
}

/** Parsed lines of a JSONL file; [] when the file does not exist. */
export async function readJsonl(file: string): Promise<unknown[]> {
  let text: string
  try {
    text = await readFile(path.resolve(file), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as unknown)
}

export async function writeFileAtomic(file: string, content: string): Promise<void> {
  const abs = path.resolve(file)
  await mkdir(path.dirname(abs), { recursive: true })
  const tmp = `${abs}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, abs)
}

export function fsCassetteStore(dir: string): CassetteStore {
  const root = path.resolve(dir)
  const fileOf = (v: string, k: string) => path.join(root, cassetteRelPath(v, k))
  return {
    describe(v, k) {
      const abs = fileOf(v, k)
      const rel = path.relative(process.cwd(), abs)
      return rel && !rel.startsWith('..') ? rel : abs
    },
    async read(v, k) {
      let text: string
      try {
        text = await readFile(fileOf(v, k), 'utf8')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw err
      }
      const parsed = CassetteSchema.safeParse(JSON.parse(text))
      if (!parsed.success) throw new Error(`invalid cassette: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
      if (parsed.data.key !== k) throw new Error(`cassette key ${parsed.data.key} does not match its file name ${k}`)
      return parsed.data
    },
    async write(c: Cassette) {
      await writeFileAtomic(fileOf(c.promptVersion, c.key), `${JSON.stringify(c, null, 2)}\n`)
    },
  }
}
