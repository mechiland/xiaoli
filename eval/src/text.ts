// Text normalisation and the harness's own sensitive-content detector (independent of extract's guard, ARCHITECTURE §7.4).

/** NFKC, strip all whitespace, case-fold. Used for person label/alias and handle value matching (§7.2, §7.3). */
export function normKey(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

/** Character bigram Jaccard on normalized text (judge fallback, §7.3). */
export function bigramJaccard(a: string, b: string): number {
  const grams = (s: string) => {
    const t = normKey(s).replace(/[，。、,.!?！？：:；;“”"'（）()]/g, '')
    const set = new Set<string>()
    if (t.length === 1) set.add(t)
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2))
    return set
  }
  const A = grams(a)
  const B = grams(b)
  if (!A.size && !B.size) return 1
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return inter / (A.size + B.size - inter)
}

// ARCHITECTURE §6 sensitive guard patterns, re-implemented here so a bug in extract's guard still fails the gate.
const DIGITS_JOINED = (s: string) => s.normalize('NFKC').replace(/(?<=\d)[\s-]+(?=\d)/g, '')
const PATTERNS: { code: string; re: RegExp }[] = [
  { code: 'phone', re: /(?<!\d)1[3-9]\d{9}(?!\d)/ },
  { code: 'landline', re: /(?<!\d)0\d{2,3}\d{7,8}(?!\d)/ },
  { code: 'id_card', re: /(?<!\d)\d{17}[\dXx](?!\d)/ },
  { code: 'bank_card', re: /(?<!\d)\d{16,19}(?!\d)/ },
  { code: 'address', re: /(?<![月\d])\d{1,5}\s*(号楼|号院|号|栋|幢|单元|室|弄)(?!线)|(路|街|巷|大道)\s*\d{1,5}\s*号/ },
]

/** Returns matched pattern codes / 'value' for sensitiveValues hits; empty = clean. */
export function sensitiveHits(text: string, sensitiveValues: string[] = []): string[] {
  const hits: string[] = []
  const joined = DIGITS_JOINED(text)
  const compact = normKey(text)
  for (const v of sensitiveValues) {
    const nv = normKey(v)
    if (nv && compact.includes(nv)) {
      hits.push('value')
      break
    }
  }
  for (const p of PATTERNS) if (p.re.test(p.code === 'address' ? text.normalize('NFKC') : joined)) hits.push(p.code)
  return hits
}
