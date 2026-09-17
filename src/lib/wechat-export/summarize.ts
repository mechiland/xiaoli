import type { ExportPreview, MessageKind, ParsedExport } from '@/contracts'

/** Import overlay step 1 preview (SPEC §8.1 / §9.7). Senders sorted by count desc, ties by first appearance. */
export function summarize(p: ParsedExport): ExportPreview {
  const byKind: Partial<Record<MessageKind, number>> = {}
  for (const m of p.messages) byKind[m.kind] = (byKind[m.kind] ?? 0) + 1
  const images = { count: 0, bytes: 0 }
  const videos = { count: 0, bytes: 0 }
  for (const f of p.media) {
    if (f.kind === 'image') {
      images.count++
      images.bytes += f.byteSize
    } else if (f.kind === 'video') {
      videos.count++
      videos.bytes += f.byteSize
    }
  }
  const senders = p.senders
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.count - a.s.count || a.i - b.i)
    .map(({ s }) => ({ name: s.name, count: s.count }))
  return { messageCount: p.messages.length, dateFrom: p.dateFrom, dateTo: p.dateTo, senders, byKind, images, videos }
}
