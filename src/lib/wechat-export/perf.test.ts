import { describe, expect, it } from 'vitest'
import { parseExportZip, summarize } from '@/lib/wechat-export'
import { generateChat } from '@/lib/wechat-export/test-synthetic'

describe('performance (ARCHITECTURE §10 P1/P1b)', () => {
  it('parses a 5000-message ZIP (with ~16 MB media) within budget in Node', async () => {
    const { zip, messageCount, imageCount } = generateChat(5000)
    expect(messageCount).toBeGreaterThanOrEqual(5000)
    // warm-up run excluded (JIT), then best of 3 is compared against the Node budget (P1b ≤ 1.5 s; spec budget 3 s)
    await parseExportZip(zip)
    const times: number[] = []
    let last
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now()
      last = await parseExportZip(zip)
      summarize(last)
      times.push(performance.now() - t0)
    }
    const median = [...times].sort((a, b) => a - b)[1]
    console.log(JSON.stringify({ perf: 'parseExportZip', messages: messageCount, zipBytes: zip.length, runsMs: times.map(Math.round), medianMs: Math.round(median) }))
    expect(last!.messages).toHaveLength(messageCount)
    expect(last!.media.filter((m) => m.kind === 'image')).toHaveLength(imageCount)
    expect(median).toBeLessThanOrEqual(1500)
  })
})
