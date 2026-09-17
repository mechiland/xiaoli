// Parsed payload staged in R2 between overlay step 1 (POST /api/imports) and step 2 (mapping). ARCHITECTURE §1.4, DECISIONS A7 #1.
import { StagedImportPayloadSchema, type StagedImportPayload } from '@/contracts'

export function stagedPayloadKey(ownerId: string, importId: number): string {
  return `u/${ownerId}/imp/${importId}/parsed.json`
}

export async function putStagedPayload(r2: R2Bucket, ownerId: string, importId: number, p: StagedImportPayload): Promise<void> {
  await r2.put(stagedPayloadKey(ownerId, importId), JSON.stringify(p), { httpMetadata: { contentType: 'application/json' } })
}

/** null → mapping answers 409 `conflict` "请重新选择这份文件". A corrupt object counts as missing. */
export async function getStagedPayload(r2: R2Bucket, ownerId: string, importId: number): Promise<StagedImportPayload | null> {
  const obj = await r2.get(stagedPayloadKey(ownerId, importId))
  if (!obj) {
    logStaging('staged_payload_missing', { importId })
    return null
  }
  try {
    const parsed = StagedImportPayloadSchema.safeParse(JSON.parse(await obj.text()))
    if (!parsed.success) {
      // issue paths/codes only — never message bodies
      logStaging('staged_payload_invalid', { importId, issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}:${i.code}`) })
      return null
    }
    if (parsed.data.importId !== importId) {
      logStaging('staged_payload_wrong_import', { importId, stagedFor: parsed.data.importId })
      return null
    }
    return parsed.data
  } catch (err) {
    logStaging('staged_payload_unreadable', { importId, name: (err as Error)?.name })
    return null
  }
}

function logStaging(msg: string, fields: Record<string, unknown>): void {
  console.warn(JSON.stringify({ level: 'warn', msg, module: 'import', time: new Date().toISOString(), ...fields }))
}

/** Idempotent: removes everything under `u/<ownerId>/imp/<importId>/`. */
export async function deleteStagedPayload(r2: R2Bucket, ownerId: string, importId: number): Promise<void> {
  const prefix = `u/${ownerId}/imp/${importId}/`
  let cursor: string | undefined
  do {
    const page = await r2.list({ prefix, cursor })
    if (page.objects.length) await r2.delete(page.objects.map((o) => o.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
}
