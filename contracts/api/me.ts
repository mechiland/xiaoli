import { z } from 'zod'
import { SettingsDTOSchema } from '../entities'

export const HealthResponseSchema = z.object({ ok: z.literal(true), db: z.boolean() })
export type HealthResponse = z.infer<typeof HealthResponseSchema>

export const MeResponseSchema = z.object({
  user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
  settings: SettingsDTOSchema,
})
export type MeResponse = z.infer<typeof MeResponseSchema>
