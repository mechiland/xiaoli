// Tiny generated PNGs for seeded image attachments (no binary fixtures in the repo).
import { crc32, deflateSync } from 'node:zlib'

const PALETTE: [number, number, number][] = [
  [196, 184, 160],
  [168, 180, 164],
  [184, 170, 190],
  [205, 180, 150],
  [160, 176, 190],
]

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

/** A `w`×`h` RGB PNG with soft diagonal bands; `n` picks the colours. */
export function tinyPng(n: number, w = 96, h = 72): Uint8Array {
  const a = PALETTE[n % PALETTE.length]
  const b = PALETTE[(n + 2) % PALETTE.length]
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < w; x++) {
      const c = Math.floor((x + y) / 16) % 2 ? a : b
      raw.set(c, row + 1 + x * 3)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return new Uint8Array(Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}
