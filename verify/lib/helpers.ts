// Scenario helpers: navigation + settle, loading/error simulation via routes, OS file drag-and-drop, keyboard.
// Browser-side code is passed as strings: tsx (esbuild keepNames) would inject `__name` into serialized functions.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page, Route } from 'playwright'
import { resolveKeys } from './log-utils'
import type { DropFileInput, ScenarioHelpers } from './types'

export interface InflightTracker {
  count: number
  lastChange: number
}

const MIME_BY_EXT: Record<string, string> = {
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
}

function toPayload(f: DropFileInput): { name: string; mimeType: string; b64: string } {
  const bytes = f.buffer ?? (f.path ? readFileSync(f.path) : null)
  if (!bytes) throw new Error('dropFiles: each file needs `path` or `buffer`')
  const name = f.name ?? (f.path ? path.basename(f.path) : 'file')
  const mimeType = f.mimeType ?? MIME_BY_EXT[path.extname(name).toLowerCase()] ?? 'application/octet-stream'
  return { name, mimeType, b64: Buffer.from(bytes).toString('base64') }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function createHelpers(page: Page, inflight: InflightTracker): ScenarioHelpers {
  const settle: ScenarioHelpers['settle'] = async (opts = {}) => {
    const quietMs = opts.quietMs ?? 400
    const deadline = Date.now() + (opts.timeoutMs ?? 5000)
    while (Date.now() < deadline) {
      if (inflight.count === 0 && Date.now() - inflight.lastChange >= quietMs) return
      await sleep(50)
    }
  }

  const fontsReady = async () => {
    try {
      await page.evaluate('document.fonts ? document.fonts.ready.then(() => true) : true')
    } catch {
      // navigation in progress
    }
  }

  const makeDataTransfer = async (files: DropFileInput[]) => {
    const payload = JSON.stringify(files.map(toPayload))
    return page.evaluateHandle(`(() => {
      const dt = new DataTransfer();
      for (const f of ${payload}) {
        const bin = atob(f.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        dt.items.add(new File([bytes], f.name, { type: f.mimeType }));
      }
      return dt;
    })()`)
  }

  const install = async (pattern: string | RegExp, handler: (route: Route) => Promise<void>) => {
    await page.route(pattern, handler)
    return async () => {
      await page.unroute(pattern, handler)
    }
  }

  return {
    async goto(p, opts = {}) {
      const res = await page.goto(p, { waitUntil: 'load', timeout: opts.timeoutMs ?? 60_000 })
      await fontsReady()
      if (opts.waitFor) await page.waitForSelector(opts.waitFor, { timeout: opts.timeoutMs ?? 30_000 })
      await settle()
      return res?.status() ?? null
    },
    settle,
    simulateLoading(pattern, ms = 3000) {
      return install(pattern, async (route) => {
        await sleep(ms)
        await route.continue().catch(() => undefined)
      })
    },
    simulateError(pattern, opts = {}) {
      const status = opts.status ?? 500
      const body = JSON.stringify({ error: { code: opts.code ?? 'internal', message: opts.message ?? '服务器出错了' } })
      return install(pattern, (route) => route.fulfill({ status, contentType: 'application/json', body }).catch(() => undefined))
    },
    stubJson(pattern, body, opts = {}) {
      return install(pattern, (route) =>
        route.fulfill({ status: opts.status ?? 200, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => undefined),
      )
    },
    async clearRoutes() {
      await page.unrouteAll({ behavior: 'ignoreErrors' })
    },
    async dragOver(files, opts = {}) {
      const target = opts.target ?? 'body'
      const dt = await makeDataTransfer(files)
      await page.dispatchEvent(target, 'dragenter', { dataTransfer: dt })
      await page.dispatchEvent(target, 'dragover', { dataTransfer: dt })
    },
    async dropFiles(files, opts = {}) {
      const target = opts.target ?? 'body'
      const dt = await makeDataTransfer(files)
      await page.dispatchEvent(target, 'dragenter', { dataTransfer: dt })
      await page.dispatchEvent(target, 'dragover', { dataTransfer: dt })
      if (opts.release === false) return
      await page.dispatchEvent(target, 'drop', { dataTransfer: dt })
    },
    async setInputFiles(selector, files) {
      await page.setInputFiles(
        selector,
        files.map((f) => {
          const p = toPayload(f)
          return { name: p.name, mimeType: p.mimeType, buffer: Buffer.from(p.b64, 'base64') }
        }),
      )
    },
    async press(keys) {
      await page.keyboard.press(resolveKeys(keys))
    },
    async type(text, opts = {}) {
      await page.keyboard.type(text, { delay: opts.delayMs ?? 0 })
    },
  }
}
