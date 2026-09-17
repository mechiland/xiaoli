// Real-sample check: parse every ZIP in fixtures/real/ and print COUNTS ONLY (no names, no bodies).
// Usage: npx tsx lib/wechat-export/scripts/check-real.ts [dir]
// Node-only script (excluded from the no-Node lint); the parser itself stays pure.
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseExportZip, summarize } from '@/lib/wechat-export'

const dir = resolve(process.argv[2] ?? 'fixtures/real')
const zips = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.zip')).sort()
if (zips.length === 0) {
  console.log(JSON.stringify({ dir: 'fixtures/real', zips: 0 }))
  process.exit(0)
}

let failed = 0
for (const [i, f] of zips.entries()) {
  const bytes = new Uint8Array(readFileSync(join(dir, f)))
  try {
    const t0 = performance.now()
    const p = await parseExportZip(bytes, { fileName: f })
    const ms = Math.round(performance.now() - t0)
    const s = summarize(p)
    const warnings: Record<string, number> = {}
    for (const w of p.warnings) warnings[w.code] = (warnings[w.code] ?? 0) + 1
    const attachmentKinds = p.messages.filter((m) => m.kind === 'image' || m.kind === 'video' || m.kind === 'file')
    console.log(
      JSON.stringify({
        file: `real-${i + 1}`,
        parseMs: ms,
        messages: s.messageCount,
        byKind: s.byKind,
        senders: s.senders.length,
        media: { total: p.media.length, images: s.images.count, videos: s.videos.count, referenced: p.media.filter((m) => m.referenced).length },
        attachmentMessages: attachmentKinds.length,
        linkedAttachments: attachmentKinds.filter((m) => m.attachmentName !== null).length,
        emptyNameAttachments: attachmentKinds.filter((m) => !m.meta?.fileName).length,
        missingAttachments: attachmentKinds.filter((m) => m.meta?.fileName && m.attachmentName === null).length,
        multiLineBodies: p.messages.filter((m) => m.body.includes('\n')).length,
        hasDateRange: Boolean(p.dateFrom && p.dateTo),
        exportedAtParsed: p.exportedAt !== null,
        warnings,
      }),
    )
  } catch (e) {
    failed++
    console.log(JSON.stringify({ file: `real-${i + 1}`, error: (e as { code?: string }).code ?? 'exception' }))
  }
}
process.exit(failed ? 1 : 0)
