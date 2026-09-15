// Pinyin index helpers (ARCHITECTURE §1.1, DECISIONS A6). Pure.
import { pinyin } from 'pinyin-pro'

export type IndexLetter =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z' | '#'

const HAN = /\p{Script=Han}/u
const LATIN = /^[A-Za-z]$/

/** Latin first char → that letter; Chinese → pinyin initial (surname mode: 曾→Z, 单→S); anything else → '#'. */
export function indexLetter(label: string): IndexLetter {
  const s = label.trim().normalize('NFKC')
  const first = [...s][0]
  if (!first) return '#'
  if (LATIN.test(first)) return first.toUpperCase() as IndexLetter
  if (HAN.test(first)) {
    const initials = pinyin(s, { pattern: 'first', toneType: 'none', surname: 'head', type: 'array' })
    const letter = (initials[0] ?? '').charAt(0).toUpperCase()
    return /^[A-Z]$/.test(letter) ? (letter as IndexLetter) : '#'
  }
  return '#'
}

/** Full-pinyin sort key, lowercase, space-separated syllables (ü → v); non-Chinese kept as-is lowercased. */
export function sortKey(label: string): string {
  const s = label.trim().normalize('NFKC')
  if (!s) return ''
  const parts = pinyin(s, { toneType: 'none', surname: 'head', type: 'array', v: true, nonZh: 'consecutive' })
  return parts.join(' ').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Pinyin initials of a label ('王小丽' → 'wxl'), for Latin-query matching. */
export function initials(label: string): string {
  const s = label.trim().normalize('NFKC')
  if (!s) return ''
  return pinyin(s, { pattern: 'first', toneType: 'none', surname: 'head', type: 'array', nonZh: 'removed' }).join('').toLowerCase()
}
