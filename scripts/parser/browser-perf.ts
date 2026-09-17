// Browser perf measurement (ARCHITECTURE §10 P1): parse a synthetic 5000-message ZIP inside system Chrome.
// Usage: npx tsx scripts/parser/browser-perf.ts
// Does NOT touch the dev server: the page, bundle and ZIP are served through Playwright request routing.
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { generateChat } from '@/lib/wechat-export/test-synthetic'

const repo = resolve(dirname(new URL(import.meta.url).pathname), '../..')
// esbuild is not a direct dependency; borrow the one tsx ships with.
const tsxPkg = realpathSync(join(repo, 'node_modules/tsx/package.json'))
type EsbuildLike = { build(o: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }> }
const esbuild = createRequire(tsxPkg)('esbuild') as EsbuildLike

const entry = `
import { parseExportZip, summarize } from '@/lib/wechat-export'
globalThis.__runParse = async (url) => {
  const buf = await (await fetch(url)).arrayBuffer()
  const file = new File([buf], '聊天记录_20250101_080000.zip')
  const t0 = performance.now()
  performance.mark('xiaoli:parse:start')
  const parsed = await parseExportZip(await file.arrayBuffer(), { fileName: file.name })
  const preview = summarize(parsed)
  performance.mark('xiaoli:parse:end')
  const ms = performance.now() - t0
  return { ms, messageCount: preview.messageCount, images: preview.images.count, videos: preview.videos.count }
}
`
const built = await esbuild.build({
  stdin: { contents: entry, resolveDir: repo, loader: 'ts' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  write: false,
  tsconfig: join(repo, 'tsconfig.json'),
})
const bundle = built.outputFiles[0].text

const { zip, messageCount } = generateChat(5000)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.route('https://parser-perf.test/**', (route) => {
    const u = new URL(route.request().url())
    if (u.pathname === '/perf.zip') return route.fulfill({ status: 200, contentType: 'application/zip', body: Buffer.from(zip) })
    if (u.pathname === '/bundle.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: bundle })
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body><pre id="out">running…</pre><script src="/bundle.js"></script>' })
  })
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('https://parser-perf.test/')
  const runs: { ms: number; messageCount: number; images: number; videos: number }[] = []
  for (let i = 0; i < 4; i++) runs.push(await page.evaluate(() => (globalThis as any).__runParse('/perf.zip')))
  const measured = runs.slice(1).map((r) => r.ms).sort((a, b) => a - b)
  const result = {
    browser: `chrome ${browser.version()}`,
    messages: messageCount,
    zipBytes: zip.length,
    firstRunMs: Math.round(runs[0].ms),
    runsMs: runs.slice(1).map((r) => Math.round(r.ms)),
    medianMs: Math.round(measured[1]),
    budgetMs: 3000,
    pass: measured[1] <= 3000 && runs[0].ms <= 3000,
    parsedMessages: runs[0].messageCount,
    consoleErrors: errors.length,
  }
  await page.evaluate((r) => {
    document.getElementById('out')!.textContent = JSON.stringify(r, null, 2)
  }, result)
  const outDir = join(repo, 'artifacts/parser/browser-perf', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(outDir, { recursive: true })
  await page.screenshot({ path: join(outDir, 'result-1440.png') })
  writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ ...result, artifacts: outDir }))
  if (!result.pass || errors.length) process.exitCode = 1
} finally {
  await browser.close()
}
