import { DEFAULT_HIGH_CONFIDENCE_THRESHOLD, type PatchSettingsRequest, type SettingsDTO } from '@/contracts'
import { nowIso } from '@/lib/time'
import { owned, type Db } from './owned'
import { userSettings } from './schema'

type SettingsRow = typeof userSettings.$inferSelect

function toDTO(row: SettingsRow | undefined): SettingsDTO {
  return {
    selfDisplayNames: row?.selfDisplayNames ?? [],
    // Never default-filled: null means "not chosen" (resolveExtractModel falls back to env, then deepseek-flash).
    extractModel: row?.extractModel ?? null,
    highConfidenceThreshold: row?.highConfidenceThreshold ?? DEFAULT_HIGH_CONFIDENCE_THRESHOLD,
    onboardedAt: row?.onboardedAt ?? null,
  }
}

/** Settings for an owner; a missing row yields defaults (delete-all removes the row). */
export async function getUserSettings(db: Db, ownerId: string): Promise<SettingsDTO> {
  const row = await db.select().from(userSettings).where(owned(userSettings, ownerId)).get()
  return toDTO(row)
}

/** Upserts the owner's settings row with the given patch and returns the result. */
export async function updateUserSettings(db: Db, ownerId: string, patch: PatchSettingsRequest): Promise<SettingsDTO> {
  const now = nowIso()
  const current = await getUserSettings(db, ownerId)
  const next: SettingsDTO = {
    selfDisplayNames:
      patch.selfDisplayNames !== undefined ? [...new Set(patch.selfDisplayNames.map((s) => s.trim()))] : current.selfDisplayNames,
    extractModel: patch.extractModel !== undefined ? patch.extractModel : current.extractModel,
    highConfidenceThreshold: patch.highConfidenceThreshold ?? current.highConfidenceThreshold,
    onboardedAt: patch.onboarded ? (current.onboardedAt ?? now) : current.onboardedAt,
  }
  await db
    .insert(userSettings)
    .values({ ownerId, ...next, updatedAt: now })
    .onConflictDoUpdate({ target: userSettings.ownerId, set: { ...next, updatedAt: now } })
  return next
}
