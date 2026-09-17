import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from './sha256'

describe('sha256Hex', () => {
  const cases = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'x'.repeat(10_000), '合成 json {"city":"成都"}', '🙂'.repeat(300)]
  it.each(cases.map((s, i) => [i, s] as const))('matches node:crypto (case %i)', (_i, s) => {
    expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'))
  })

  it('accepts bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 255])
    expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'))
  })
})
