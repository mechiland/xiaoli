import { defineConfig } from 'drizzle-kit'

// Generates SQL migrations only; they are applied with `wrangler d1 migrations apply xiaoli --local|--remote`.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  strict: true,
  verbose: true,
})
