// Static Better Auth options shared by the runtime `getAuth(env)` (server/auth.ts) and the schema generator:
//   npx auth@1.7.5 generate --config server/auth.config.ts --adapter drizzle --dialect sqlite --output server/db/schema/auth.ts
// No env access and no `@/` aliases here (the CLI loads this file on its own).
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'

export const authOptions = {
  appName: '小丽',
  basePath: '/api/auth',
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    // D1 ids for auth tables stay text (Better Auth default); business tables use integer ids.
    cookiePrefix: 'xiaoli',
  },
  telemetry: { enabled: false },
} satisfies Omit<BetterAuthOptions, 'database' | 'secret' | 'baseURL'>

// Used only by the CLI generator. The db object is never touched during generation.
export const auth = betterAuth({
  ...authOptions,
  // This instance has no real db/schema; its schema check would report every auth table as missing whenever this
  // module is imported (the runtime getAuth imports authOptions from here).
  advanced: { ...authOptions.advanced, database: { validateSchema: false } },
  secret: 'schema-generation-only-not-a-real-secret-0000',
  baseURL: 'http://localhost:3000',
  database: drizzleAdapter({} as never, { provider: 'sqlite' }),
})
