import { z } from 'zod'
import { ExtractModel } from '../common'
import { SettingsDTOSchema } from '../entities'

export const SettingsResponseSchema = z.object({ settings: SettingsDTOSchema })
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>

export const PatchSettingsRequestSchema = z
  .object({
    selfDisplayNames: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    /** null = back to default (env EXTRACT_MODEL → deepseek-flash) */
    extractModel: ExtractModel.nullable().optional(),
    highConfidenceThreshold: z.number().min(0.5).max(1).optional(),
    onboarded: z.literal(true).optional(),
  })
  .strict()
export type PatchSettingsRequest = z.infer<typeof PatchSettingsRequestSchema>
