import { describe, expect, it } from 'vitest'
import { attachmentDisposition, fileNameForMime, peekStream, sniffImageMime } from './sniff'

// Synthetic headers only (no real files). DECISIONS chat C14.
const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)))
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
/** ISO-BMFF ftyp box: size, 'ftyp', major brand, minor version, compatible brands */
const ftyp = (major: string, compatible: string[], tail = 200) =>
  new Uint8Array([...bytes(u32(16 + 4 * compatible.length), 'ftyp', major, u32(0), ...compatible), ...new Array(tail).fill(7)])

describe('sniffImageMime', () => {
  it('recognises HEIF stills from their ftyp brands', () => {
    expect(sniffImageMime(ftyp('heic', ['mif1', 'heic']))).toBe('image/heic')
    expect(sniffImageMime(ftyp('heix', ['mif1']))).toBe('image/heic')
    expect(sniffImageMime(ftyp('mif1', ['heic']))).toBe('image/heic')
    expect(sniffImageMime(ftyp('mif1', ['miaf']))).toBe('image/heif')
    expect(sniffImageMime(ftyp('msf1', []))).toBe('image/heif')
  })

  it('tells AVIF (also a mif1 file) apart from HEIC', () => {
    expect(sniffImageMime(ftyp('avif', ['mif1', 'miaf']))).toBe('image/avif')
    expect(sniffImageMime(ftyp('mif1', ['avif', 'miaf']))).toBe('image/avif')
  })

  it('recognises the common raster types', () => {
    expect(sniffImageMime(bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF'))).toBe('image/jpeg')
    expect(sniffImageMime(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(sniffImageMime(bytes('GIF89a'))).toBe('image/gif')
    expect(sniffImageMime(bytes('RIFF', u32(100), 'WEBPVP8 '))).toBe('image/webp')
    expect(sniffImageMime(bytes('BM', u32(100)))).toBe('image/bmp')
  })

  it('returns null for video ftyp brands, text and short input', () => {
    expect(sniffImageMime(ftyp('isom', ['iso2', 'mp41']))).toBeNull()
    expect(sniffImageMime(ftyp('qt  ', ['qt  ']))).toBeNull()
    expect(sniffImageMime(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull()
    expect(sniffImageMime(bytes([137, 80, 78, 71]))).toBeNull()
    expect(sniffImageMime(new Uint8Array())).toBeNull()
  })
})

describe('fileNameForMime / attachmentDisposition', () => {
  it('swaps a wrong extension for the sniffed one, keeps a right one', () => {
    expect(fileNameForMime('微信图片_202601011200_1.jpg', 'image/heic')).toBe('微信图片_202601011200_1.heic')
    expect(fileNameForMime('a.jpeg', 'image/jpeg')).toBe('a.jpeg')
    expect(fileNameForMime('noext', 'image/png')).toBe('noext.png')
    expect(fileNameForMime('a.mp4', 'video/mp4')).toBe('a.mp4')
  })

  it('sends an ASCII fallback plus the UTF-8 name', () => {
    expect(attachmentDisposition(null)).toBe('attachment')
    expect(attachmentDisposition('微信图片_1.heic')).toBe(`attachment; filename="_____1.heic"; filename*=UTF-8''${encodeURIComponent('微信图片_1.heic')}`)
  })
})

describe('peekStream', () => {
  const chunked = (chunks: number[][]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(new Uint8Array(ch))
        c.close()
      },
    })
  const all = async (s: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(s).arrayBuffer())

  it('returns the first bytes across chunks and still yields every byte', async () => {
    const { head, body } = await peekStream(chunked([[1, 2], [3], [4, 5, 6, 7], [8, 9]]), 5)
    expect([...head]).toEqual([1, 2, 3, 4, 5])
    expect([...(await all(body))]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('handles a body shorter than the peek', async () => {
    const { head, body } = await peekStream(chunked([[1, 2, 3]]), 64)
    expect([...head]).toEqual([1, 2, 3])
    expect([...(await all(body))]).toEqual([1, 2, 3])
  })
})
