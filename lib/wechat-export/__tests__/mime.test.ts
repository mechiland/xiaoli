// Media mime from leading bytes (overall critic r3 #1, DECISIONS parser P15). Synthetic bytes only.
import { strToU8, zipSync, type Zippable } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseExportZip } from '@/lib/wechat-export'
import { sniffImageMime } from '@/lib/wechat-export/sniff'
import { buildExportText, buildExportZip, MEDIA_DIR } from '@/lib/wechat-export/testing/synthetic'
import { entryHead, localHeaderOffsets } from '@/lib/wechat-export/zip'

const cat = (...parts: (string | number[] | Uint8Array)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...strToU8(p)] : [...p])))
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

/** deterministic, poorly compressible filler so deflate emits real blocks */
function noise(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n)
  let x = seed
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0
    out[i] = x >>> 16
  }
  return out
}

const ftyp = (major: string, compat: string[], fill = 4096) =>
  cat(u32be(16 + 4 * compat.length), 'ftyp', major, [0, 0, 0, 0], ...compat, noise(fill))
const HEIC = ftyp('heic', ['mif1', 'heic'], 200_000)
const JPEG = cat([0xff, 0xd8, 0xff, 0xe0], 'JFIF', noise(3000, 2))
const PNG = cat([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], noise(500, 3))

const IMG = (n: number) => `微信图片_202601011200_${n}.jpg`
const text = buildExportText([
  { sender: '测试甲', at: '2026-01-01 12:00', body: `[图片] ${IMG(1)}` },
  { sender: '测试乙', at: '2026-01-01 12:01', body: '[视频] 微信视频_202601011200_1.mp4' },
])

async function mediaOf(zip: Uint8Array) {
  const p = await parseExportZip(zip, { fileName: '聊天记录_20260101_120000.zip' })
  return Object.fromEntries(p.media.map((m) => [m.name, m]))
}

describe('media mime from leading bytes', () => {
  it("'ftypheic' named .jpg → image/heic (stored entry, WeChat-style names)", async () => {
    const m = await mediaOf(buildExportZip({ text, media: [{ name: IMG(1), bytes: HEIC }] }))
    expect(m[IMG(1)]).toEqual({ name: IMG(1), path: `${MEDIA_DIR}/${IMG(1)}`, kind: 'image', mime: 'image/heic', byteSize: HEIC.length, referenced: true })
  })

  it('deflated entries (as in real exports) are sniffed from a partial inflate', async () => {
    const files: Zippable = { '聊天记录.txt': strToU8(text) }
    const put = (name: string, bytes: Uint8Array) => (files[`${MEDIA_DIR}/${name}`] = [bytes, { level: 9 }])
    put(IMG(1), HEIC)
    put(IMG(2), ftyp('mif1', ['miaf'], 50_000))
    put(IMG(3), ftyp('avif', ['mif1', 'miaf'], 50_000))
    put(IMG(4), JPEG)
    put(IMG(5), PNG)
    put(IMG(6), noise(2000, 9)) // unrecognised bytes keep the extension's mime
    put('微信图片_202601011200_7.heic', JPEG) // right bytes win over a wrong extension either way
    put('微信视频_202601011200_1.mp4', ftyp('isom', ['iso2', 'mp41'], 50_000)) // non-images are not sniffed
    put('报告.pdf', cat('%PDF-1.4', noise(100)))
    const m = await mediaOf(zipSync(files))
    expect(Object.fromEntries(Object.values(m).map((x) => [x.name, [x.kind, x.mime]]))).toEqual({
      [IMG(1)]: ['image', 'image/heic'],
      [IMG(2)]: ['image', 'image/heif'],
      [IMG(3)]: ['image', 'image/avif'],
      [IMG(4)]: ['image', 'image/jpeg'],
      [IMG(5)]: ['image', 'image/png'],
      [IMG(6)]: ['image', 'image/jpeg'],
      '微信图片_202601011200_7.heic': ['image', 'image/jpeg'],
      '微信视频_202601011200_1.mp4': ['video', 'video/mp4'],
      '报告.pdf': ['file', 'application/pdf'],
    })
    expect(m[IMG(1)].byteSize).toBe(HEIC.length)
  })

  it('an empty or truncated image entry falls back to the extension', async () => {
    const m = await mediaOf(buildExportZip({ text, media: [{ name: IMG(1), bytes: new Uint8Array() }, { name: IMG(2), bytes: cat([0, 0, 0, 0x18], 'ftyp') }] }))
    expect([m[IMG(1)].mime, m[IMG(2)].mime]).toEqual(['image/jpeg', 'image/jpeg'])
  })

  it('entryHead reads only the leading bytes; localHeaderOffsets follows directory order', () => {
    const zip = zipSync({ 'a.txt': strToU8('hello'), 'b.jpg': [HEIC, { level: 6 }], 'c.jpg': [JPEG, { level: 0 }] })
    const offs = localHeaderOffsets(zip)
    expect(offs).toHaveLength(3)
    expect(offs[0]).toBe(0)
    const compressed = zip.length // upper bound is fine: inflate stops once 64 bytes are out
    expect(entryHead(zip, offs[1], 8, compressed)).toEqual(HEIC.slice(0, 64))
    expect(entryHead(zip, offs[2], 0, JPEG.length, 16)).toEqual(JPEG.slice(0, 16))
    expect(entryHead(zip, offs[2] + 1, 0, 10)).toBeNull()
    expect(localHeaderOffsets(strToU8('not a zip at all, no directory'))).toEqual([])
  })

  it('sniffImageMime brands match the chat copy', () => {
    for (const b of ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis']) expect(sniffImageMime(ftyp(b, [], 0))).toBe('image/heic')
    expect(sniffImageMime(ftyp('mif1', ['heic'], 0))).toBe('image/heic')
    expect(sniffImageMime(ftyp('msf1', [], 0))).toBe('image/heif')
    expect(sniffImageMime(ftyp('mif1', ['avis'], 0))).toBe('image/avif')
    expect(sniffImageMime(ftyp('qt  ', ['qt  '], 0))).toBeNull()
    expect(sniffImageMime(cat('GIF89a'))).toBe('image/gif')
    expect(sniffImageMime(cat('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toBe('image/webp')
    expect(sniffImageMime(new Uint8Array())).toBeNull()
  })
})
