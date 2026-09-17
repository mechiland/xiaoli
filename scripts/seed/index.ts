// `pnpm seed [--account seed|seed2|empty|all] [--reset]` — synthetic data in the local D1/R2 the dev server uses (ARCHITECTURE §9).
// Always resets the chosen seed accounts' business rows first (idempotent); other users are never touched.
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { hashPassword, verifyPassword } from 'better-auth/crypto'
import { todayInTz } from '@/lib/time'
import { getAuth } from '@/server/auth'
import { account, user, type Db } from '@/server/db'
import { withPlatform } from '@/scripts/with-platform'
import { SEED_ACCOUNT_NAMES, SEED_ACCOUNTS, type SeedAccountName } from './accounts'
import { writeManifest, type AccountManifest } from './manifest'
import { seedAccounts } from './write'

function parseArgs(argv: string[]): SeedAccountName[] {
  let which = 'all'
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--reset') continue
    if (a === '--account') which = argv[++i] ?? ''
    else if (a.startsWith('--account=')) which = a.slice('--account='.length)
    else throw new Error(`unknown argument ${a}`)
  }
  if (which === 'all') return SEED_ACCOUNT_NAMES
  if (!(SEED_ACCOUNT_NAMES as string[]).includes(which)) throw new Error(`--account must be one of ${SEED_ACCOUNT_NAMES.join(', ')}, all`)
  return [which as SeedAccountName]
}

async function ensureUser(env: CloudflareEnv, db: Db, name: SeedAccountName): Promise<string> {
  const acc = SEED_ACCOUNTS[name]
  let row = await db.select().from(user).where(eq(user.email, acc.email)).get()
  if (!row) {
    const secret = (env as unknown as Record<string, string | undefined>).BETTER_AUTH_SECRET
    const auth = getAuth({ BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: 'http://localhost:3000', DB: env.DB }, db)
    await auth.api.signUpEmail({ body: { email: acc.email, password: acc.password, name: acc.name } })
    row = await db.select().from(user).where(eq(user.email, acc.email)).get()
    if (!row) throw new Error(`could not create ${acc.email}`)
    return row.id
  }
  // Keep the documented password working even if a scenario changed it.
  const cred = await db.select().from(account).where(and(eq(account.userId, row.id), eq(account.providerId, 'credential'))).get()
  const ok = cred?.password ? await verifyPassword({ hash: cred.password, password: acc.password }) : false
  if (!ok) {
    const hash = await hashPassword(acc.password)
    const now = new Date()
    if (cred) await db.update(account).set({ password: hash, updatedAt: now }).where(eq(account.id, cred.id))
    else await db.insert(account).values({ id: randomUUID(), accountId: row.id, providerId: 'credential', userId: row.id, password: hash, createdAt: now, updatedAt: now })
  }
  return row.id
}

async function main() {
  const names = parseArgs(process.argv.slice(2))
  const started = performance.now()
  await withPlatform(async ({ env, db, r2 }) => {
    const owners: Partial<Record<SeedAccountName, string>> = {}
    for (const n of names) owners[n] = await ensureUser(env, db, n)
    const today = todayInTz('Asia/Shanghai')
    const res = await seedAccounts(db, r2, owners, { today, now: new Date() })
    const seededAt = new Date().toISOString()
    const accounts: Partial<Record<SeedAccountName, AccountManifest>> = {}
    for (const n of names) {
      const ds = res.datasets[n]!
      accounts[n] = { userId: owners[n]!, email: SEED_ACCOUNTS[n].email, seededAt, ...ds.refs, counts: ds.counts }
    }
    const file = writeManifest({ today, accounts })
    for (const n of names) {
      const c = res.datasets[n]!.counts
      console.log(`[seed] ${SEED_ACCOUNTS[n].email}: persons ${c.visiblePersons} visible (${c.persons ?? 0} rows), claims ${c.claims ?? 0}, messages ${c.messages ?? 0}, evidence ${c.evidence ?? 0}, imports ${c.imports ?? 0}, chats ${c.chats ?? 0}`)
    }
    console.log(`[seed] ${res.statements} insert statements; reset ${res.ms.reset} ms, build ${res.ms.build} ms, insert ${res.ms.insert} ms, r2 ${res.ms.r2} ms`)
    console.log(`[seed] manifest → ${file}`)
  })
  console.log(`[seed] done in ${((performance.now() - started) / 1000).toFixed(1)} s`)
}

main().catch((err) => {
  console.error('[seed] failed:', (err as Error).stack ?? err)
  process.exit(1)
})
