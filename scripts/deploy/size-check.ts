// Worker size check (ARCHITECTURE §1.13): gzip worker ≤ 3 MiB (Workers Free) / ≤ 10 MiB (Workers Paid).
// Local only: `wrangler deploy --dry-run --outdir` bundles without contacting Cloudflare.
// Usage: pnpm tsx scripts/deploy/size-check.ts [--dir <build dir with .open-next>] [--json]
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { computeGzipSize, fail, fmtMiB, FREE_LIMIT_GZ, log, PAID_LIMIT_GZ, parseArgs, parseWranglerUpload, planFor, pnpmExec, REMOTE_ENV, type SizeReport } from './lib'

export interface SizeCheckResult extends SizeReport {
  outdir: string
  computedGzipBytes: number
  freeLimitBytes: number
  paidLimitBytes: number
}

export function checkWorkerSize(buildDir: string): SizeCheckResult {
  if (!existsSync(path.join(buildDir, '.open-next', 'worker.js'))) fail(`${buildDir}/.open-next/worker.js not found; run the OpenNext build first (scripts/deploy/build.ts)`)
  const outdir = path.join(buildDir, '.deploy-dryrun')
  rmSync(outdir, { recursive: true, force: true })
  const r = pnpmExec(buildDir, ['wrangler', 'deploy', '--dry-run', '--env', REMOTE_ENV, '--outdir', outdir], {
    capture: true,
    // OPEN_NEXT_DEPLOY stops wrangler from delegating `deploy` back to opennextjs-cloudflare.
    env: { OPEN_NEXT_DEPLOY: 'true', CI: '1', WRANGLER_SEND_METRICS: 'false' },
  })
  if (r.status !== 0) {
    process.stderr.write(r.stdout + r.stderr)
    fail('wrangler deploy --dry-run failed')
  }
  const parsed = parseWranglerUpload(r.stdout + r.stderr)
  const computed = computeGzipSize(outdir)
  const gzipBytes = parsed?.gzipBytes ?? computed.gzipBytes
  return {
    outdir,
    files: computed.files,
    rawBytes: parsed?.rawBytes ?? computed.rawBytes,
    gzipBytes,
    computedGzipBytes: computed.gzipBytes,
    plan: planFor(gzipBytes),
    source: parsed ? 'wrangler-dry-run' : 'computed',
    freeLimitBytes: FREE_LIMIT_GZ,
    paidLimitBytes: PAID_LIMIT_GZ,
  }
}

export function describeSize(s: SizeCheckResult): string[] {
  const head = FREE_LIMIT_GZ - s.gzipBytes
  const lines = [`worker upload: ${fmtMiB(s.rawBytes)} raw, ${fmtMiB(s.gzipBytes)} gzip (${s.source}; own gzip-9 estimate ${fmtMiB(s.computedGzipBytes)})`]
  if (s.plan === 'free') {
    lines.push(`fits the Workers Free size limit (3 MiB) with ${(head / 1024).toFixed(0)} KiB to spare, and the Paid limit (10 MiB)`)
    lines.push('plan needed: Workers Paid is still recommended — Free allows 10 ms CPU per request, which server-rendered pages and extraction requests exceed (docs/DEPLOY.md)')
  } else if (s.plan === 'paid') lines.push('exceeds the Free limit (3 MiB): plan needed = Workers Paid (limit 10 MiB)')
  else lines.push('exceeds the Workers Paid limit (10 MiB): cannot deploy')
  return lines
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { flags } = parseArgs(process.argv.slice(2))
  const dir = path.resolve(typeof flags.get('dir') === 'string' ? (flags.get('dir') as string) : process.cwd())
  const res = checkWorkerSize(dir)
  if (flags.has('json')) console.log(JSON.stringify(res, null, 2))
  else for (const l of describeSize(res)) log(l)
  if (res.plan === 'too-large') process.exit(1)
}
