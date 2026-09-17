import { z } from 'zod'
import { ExtractModel } from '@/contracts'

/**
 * Server env (ARCHITECTURE §3). In-app source = Cloudflare env binding (getCloudflareContext().env);
 * CLI source = process.env. Bindings are optional in the schema so CLI scripts (eval, extract:offline) validate too.
 * Never log values, only variable names.
 */
export const ServerEnvSchema = z.object({
  DB: z.custom<D1Database>((v) => v != null && typeof v === 'object').optional(),
  R2: z.custom<R2Bucket>((v) => v != null && typeof v === 'object').optional(),
  BETTER_AUTH_SECRET: z.string().min(16).optional(),
  BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  DEEPSEEK_BASE_URL: z.url().default('https://api.deepseek.com'),
  EXTRACT_MODEL: ExtractModel.optional(),
  LLM_MODE: z.enum(['live', 'record', 'replay']).optional(),
  LLM_CASSETTE_DIR: z.string().optional(),
  LLM_THINKING: z.enum(['enabled', 'disabled']).default('disabled'),
  LLM_BUDGET_TOKENS: z.coerce.number().int().positive().default(3_000_000),
  LLM_BUDGET_SINCE: z.iso.datetime({ offset: true }).optional(),
  APP_TZ: z.string().default('Asia/Shanghai'),
  NEXTJS_ENV: z.string().optional(),
})
export type ServerEnv = z.infer<typeof ServerEnvSchema>

export class EnvValidationError extends Error {
  readonly variables: string[]
  constructor(variables: string[]) {
    super(`invalid server env: ${variables.join(', ')}`)
    this.name = 'EnvValidationError'
    this.variables = variables
  }
}

/** Empty strings count as unset (common in .env files). Throws EnvValidationError naming the variables, never values. */
export function parseServerEnv(source: Record<string, unknown>): ServerEnv {
  const cleaned: Record<string, unknown> = {}
  for (const key of Object.keys(ServerEnvSchema.shape)) {
    const v = source[key]
    if (v === undefined || v === null || v === '') continue
    cleaned[key] = v
  }
  const r = ServerEnvSchema.safeParse(cleaned)
  if (!r.success) {
    throw new EnvValidationError([...new Set(r.error.issues.map((i) => String(i.path[0] ?? '?')))])
  }
  return r.data
}
