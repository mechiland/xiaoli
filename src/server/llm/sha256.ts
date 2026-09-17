// Synchronous SHA-256 in plain JS (cassetteKey must be sync; crypto.subtle is async and node:crypto is not Worker-safe).
// Round constants are derived (fractional parts of cube/square roots of the first primes) instead of hard-coded.

function firstPrimes(n: number): number[] {
  const out: number[] = []
  for (let c = 2; out.length < n; c++) if (out.every((p) => c % p !== 0)) out.push(c)
  return out
}
const frac32 = (x: number) => ((x - Math.floor(x)) * 0x100000000) >>> 0
const PRIMES = firstPrimes(64)
const K = Uint32Array.from(PRIMES, (p) => frac32(Math.cbrt(p)))
const H0 = Uint32Array.from(PRIMES.slice(0, 8), (p) => frac32(Math.sqrt(p)))

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const len = bytes.length
  const total = Math.ceil((len + 9) / 64) * 64
  const buf = new Uint8Array(total)
  buf.set(bytes)
  buf[len] = 0x80
  const view = new DataView(buf.buffer)
  view.setUint32(total - 8, Math.floor((len * 8) / 0x100000000))
  view.setUint32(total - 4, (len * 8) >>> 0)

  const h = Uint32Array.from(H0)
  const w = new Uint32Array(64)
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]
      const b = w[i - 2]
      w[i] = w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7]
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      hh = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    h[0] += a
    h[1] += b
    h[2] += c
    h[3] += d
    h[4] += e
    h[5] += f
    h[6] += g
    h[7] += hh
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('')
}
