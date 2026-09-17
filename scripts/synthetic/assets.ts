// Tiny valid JPEGs (96x72 flat shapes, generated once with PIL) and a fake MP4 header. Each file gets its name in a
// JPEG COM segment / MP4 free box so every attachment has distinct bytes (distinct sha256) and stays decodable.
import { strToU8 } from 'fflate'

const JPEG_BASE64 = [
  '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',
]

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
const JPEGS = JPEG_BASE64.map(b64ToBytes)

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h
}

export function jpegBytes(name: string): Uint8Array {
  const base = JPEGS[hash(name) % JPEGS.length]
  const comment = strToU8(`xiaoli synthetic ${name}`)
  const seg = new Uint8Array(4 + comment.length)
  seg[0] = 0xff
  seg[1] = 0xfe
  seg[2] = ((comment.length + 2) >> 8) & 0xff
  seg[3] = (comment.length + 2) & 0xff
  seg.set(comment, 4)
  const out = new Uint8Array(base.length + seg.length)
  out.set(base.subarray(0, 2), 0) // SOI
  out.set(seg, 2)
  out.set(base.subarray(2), 2 + seg.length)
  return out
}

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length)
  const size = out.length
  out[0] = (size >>> 24) & 0xff
  out[1] = (size >>> 16) & 0xff
  out[2] = (size >>> 8) & 0xff
  out[3] = size & 0xff
  out.set(strToU8(type), 4)
  out.set(payload, 8)
  return out
}

/** Not a playable video: an ftyp box plus a free box with the name. Videos are unselected by default (SPEC §8.1). */
export function mp4Bytes(name: string): Uint8Array {
  const ftyp = box('ftyp', strToU8('isom\x00\x00\x02\x00isomiso2mp41'))
  const free = box('free', strToU8(`xiaoli synthetic ${name}`))
  const out = new Uint8Array(ftyp.length + free.length)
  out.set(ftyp, 0)
  out.set(free, ftyp.length)
  return out
}
