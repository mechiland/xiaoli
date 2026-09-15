// Synthetic seed accounts (ARCHITECTURE §8, §9). Local-only test credentials, safe to commit.
export const SEED_PASSWORD = 'xiaoli-seed-2026'

export const SEED_ACCOUNTS = {
  seed: { email: 'seed@xiaoli.test', name: '小丽', password: SEED_PASSWORD },
  seed2: { email: 'seed2@xiaoli.test', name: '隔离账号', password: SEED_PASSWORD },
  empty: { email: 'empty@xiaoli.test', name: '空账号', password: SEED_PASSWORD },
} as const

export type SeedAccountName = keyof typeof SEED_ACCOUNTS
export const SEED_ACCOUNT_NAMES = Object.keys(SEED_ACCOUNTS) as SeedAccountName[]

/** Where seed writes tag → id mappings for verify scenarios. */
export const SEED_MANIFEST_PATH = '.dev/seed-manifest.json'
