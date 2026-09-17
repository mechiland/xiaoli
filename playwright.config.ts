// Playwright test runner config for tests/e2e/** (module e2e specs). Screenshot scenarios use `pnpm verify` instead.
// System Chrome only (no browser downloads); one worker — the single dev server on :3000 is shared with other agents.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  globalSetup: './tests/e2e/_support/global-setup.ts',
  use: {
    baseURL: process.env.VERIFY_BASE_URL ?? 'http://localhost:3000',
    channel: 'chrome',
    headless: true,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'narrow-390', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true } },
  ],
})
