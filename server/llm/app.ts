// In-app client factory for Hono handlers.
import type { AppContext } from '@/server/context'
import { appBudget } from './budget'
import { createLlmClient } from './client'
import { d1CallLogger } from './loggers'
import type { LlmClient } from './types'

export type HonoContext = AppContext

/** mode = LLM_MODE (default live), d1CallLogger(c.var.db), budget = appBudget(c). Honours createTestApp's llmOverride. */
export async function getAppLlm(c: HonoContext): Promise<LlmClient> {
  const override = c.get('llmOverride')
  if (override) return override as LlmClient
  const env = c.get('env')
  return createLlmClient({
    env,
    logger: d1CallLogger(c.get('db')),
    mode: env.LLM_MODE ?? 'live',
    cassetteDir: env.LLM_CASSETTE_DIR,
    budget: await appBudget(c),
  })
}
