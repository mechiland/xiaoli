// Cloudflare bindings and vars available via getCloudflareContext().env (wrangler.jsonc + .dev.vars).
// Hand-maintained (not `wrangler types`, which would also emit runtime types that clash with @cloudflare/workers-types).
interface CloudflareEnv {
  DB: D1Database
  R2: R2Bucket
  ASSETS?: Fetcher
  APP_TZ?: string
  NEXTJS_ENV?: string
  BETTER_AUTH_SECRET?: string
  BETTER_AUTH_URL?: string
  DEEPSEEK_API_KEY?: string
  DEEPSEEK_BASE_URL?: string
  EXTRACT_MODEL?: string
  LLM_MODE?: string
  LLM_CASSETTE_DIR?: string
  LLM_THINKING?: string
  LLM_BUDGET_TOKENS?: string
  LLM_BUDGET_SINCE?: string
}
