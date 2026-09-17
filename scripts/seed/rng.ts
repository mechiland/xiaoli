// Deterministic PRNG (mulberry32, seed 20260915 — ARCHITECTURE §9).
export interface Rng {
  next(): number
  /** integer in [min, max] */
  int(min: number, max: number): number
  pick<T>(xs: readonly T[]): T
  chance(p: number): boolean
  shuffle<T>(xs: T[]): T[]
  sample<T>(xs: readonly T[], n: number): T[]
}

export const SEED_RNG = 20260915

export function createRng(seed: number = SEED_RNG): Rng {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (xs) => {
      if (!xs.length) throw new Error('pick from empty list')
      return xs[Math.floor(next() * xs.length)]
    },
    chance: (p) => next() < p,
    shuffle: (xs) => {
      for (let i = xs.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[xs[i], xs[j]] = [xs[j], xs[i]]
      }
      return xs
    },
    sample: (xs, n) => rng.shuffle([...xs]).slice(0, Math.max(0, Math.min(n, xs.length))),
  }
  return rng
}
