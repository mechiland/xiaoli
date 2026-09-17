// Pure text helpers for search (owner: search). No server/DB imports: also used by the search overlay and PersonPicker
// on the client to highlight labels and aliases the same way the server matched them.

/** Same normalization the stored `value_norm` / `statement_norm` columns use: NFKC (full-width → half-width), lowercase, trim. */
export function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase().trim()
}

/** Normalized query with inner whitespace collapsed to one space. */
export function normalizeQuery(q: string): string {
  return normalize(q).replace(/\s+/g, ' ')
}

/** Whitespace-separated terms of a normalized query, de-duplicated, longest first (so highlights prefer the longer term). */
export function splitTerms(q: string): string[] {
  const terms = [...new Set(normalizeQuery(q).split(' ').filter(Boolean))]
  return terms.sort((a, b) => b.length - a.length)
}

/** Escapes LIKE wildcards; use with `ESCAPE '\'`. */
export function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
}

/**
 * Highlight ranges `[start, end)` in UTF-16 offsets of the ORIGINAL text for every occurrence of any term.
 * Each code point is normalized on its own so offsets map back even when NFKC changes the length.
 * Overlapping/adjacent ranges are merged; result sorted.
 */
export function highlightRanges(text: string, terms: string[]): [number, number][] {
  const needles = terms.map(normalize).filter(Boolean)
  if (!needles.length || !text) return []
  let norm = ''
  const origin: number[] = [] // norm code-unit index → original code-unit start
  const originEnd: number[] = [] // norm code-unit index → original code-unit end
  let i = 0
  for (const ch of text) {
    const n = ch.normalize('NFKC').toLowerCase()
    for (let k = 0; k < n.length; k++) {
      origin.push(i)
      originEnd.push(i + ch.length)
    }
    norm += n
    i += ch.length
  }
  const raw: [number, number][] = []
  for (const needle of needles) {
    let from = 0
    for (;;) {
      const at = norm.indexOf(needle, from)
      if (at < 0) break
      raw.push([origin[at], originEnd[at + needle.length - 1]])
      from = at + Math.max(1, needle.length)
    }
  }
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: [number, number][] = []
  for (const r of raw) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}

/** Splits text into plain/highlighted segments for rendering. */
export function segmentsFor(text: string, ranges: [number, number][]): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = []
  let pos = 0
  for (const [s, e] of ranges) {
    const start = Math.max(pos, Math.min(s, text.length))
    const end = Math.min(e, text.length)
    if (end <= start) continue
    if (start > pos) out.push({ text: text.slice(pos, start), hit: false })
    out.push({ text: text.slice(start, end), hit: true })
    pos = end
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false })
  return out
}

const HAN = /\p{Script=Han}/u
const LATIN_QUERY = /^[a-z]+( [a-z]+)*$/

/** A query that should also be tried as pinyin (full syllables or initials): ASCII letters only. */
export function isLatinQuery(q: string): boolean {
  return LATIN_QUERY.test(normalizeQuery(q))
}

/** Pinyin keys of a label from its stored `label_sort` ("lin zhi xia" → full "linzhixia", initials "lzx"). Only for labels containing Han characters. */
export function pinyinKeys(label: string, labelSort: string): { full: string; initials: string } | null {
  if (!HAN.test(label)) return null
  const syllables = labelSort.toLowerCase().split(/\s+/).filter((s) => /^[a-z]/.test(s))
  if (!syllables.length) return null
  return { full: syllables.join(''), initials: syllables.map((s) => s[0]).join('') }
}
