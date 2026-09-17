import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/', import.meta.url)),
      '~': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**', '.open-next/**', '.wrangler/**', 'artifacts/**'],
    environment: 'node',
    env: { LLM_MODE: 'replay', NEXTJS_ENV: 'test' },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // getPlatformProxy spins up workerd per test file; keep concurrency bounded on a memory-tight machine.
    maxWorkers: 4,
  },
})
