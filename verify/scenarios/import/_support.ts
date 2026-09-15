// Shared helpers for import scenarios. Synthetic ZIPs only (fixtures/synthetic).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ParsedExport } from '@/contracts'
import { parseExportZip } from '@/lib/wechat-export'
import type { ScenarioContext } from '@/verify/lib'

export const FIXTURES = path.resolve(process.cwd(), 'fixtures', 'synthetic')
export const PRIVATE_1 = path.join(FIXTURES, '聊天记录_20260405_223012.zip')
export const PRIVATE_2 = path.join(FIXTURES, '聊天记录_20260914_211545.zip')
export const GROUP = path.join(FIXTURES, '聊天记录_20260912_095501.zip')
export const PERF_5000 = path.join(FIXTURES, 'perf-5000.zip')
export const SELF_NAME = '小满'

export async function parseFixture(p: string): Promise<ParsedExport> {
  return parseExportZip(new Uint8Array(readFileSync(p)), { fileName: path.basename(p) })
}

type Api = ScenarioContext['api']

/** Imports a synthetic ZIP entirely through the API (no uploads). Idempotent: an existing import of the file is reused. */
export async function importViaApi(api: Api, file: string, chat: { title: string; kind: 'private' | 'group' }): Promise<{ importId: number; chatId: number }> {
  const p = await parseFixture(file)
  const check = await api.post<{ duplicate: boolean; importId?: number }>('/api/imports/check', { sha256: p.sha256 })
  if (check.json?.duplicate && check.json.importId) {
    const d = await api.get<{ import: { chatId: number } }>(`/api/imports/${check.json.importId}`)
    return { importId: check.json.importId, chatId: d.json!.import.chatId }
  }
  const created = await api.post<{ import: { id: number } }>('/api/imports', {
    fileName: p.fileName,
    sha256: p.sha256,
    exportedAt: p.exportedAt,
    parserVersion: p.parserVersion,
    messages: p.messages,
    media: p.media,
    selectedAttachments: [],
  })
  if (created.status !== 201) throw new Error(`POST /api/imports → ${created.status}`)
  const importId = created.json!.import.id
  const mapped = await api.post<{ chat: { id: number } }>(`/api/imports/${importId}/mapping`, {
    chat: { new: chat },
    senders: p.senders.map((s) => ({ senderName: s.name, target: s.name === SELF_NAME ? { self: true } : { newPerson: { label: s.name } } })),
  })
  if (mapped.status !== 200) throw new Error(`POST mapping → ${mapped.status} ${mapped.text.slice(0, 200)}`)
  return { importId, chatId: mapped.json!.chat.id }
}

/** Deletes the import of this file if the account has one (so the other width can run the same flow). */
export async function deleteImportOf(api: Api, file: string): Promise<void> {
  const p = await parseFixture(file)
  const check = await api.post<{ duplicate: boolean; importId?: number }>('/api/imports/check', { sha256: p.sha256 })
  if (check.json?.duplicate && check.json.importId) await api.delete(`/api/imports/${check.json.importId}`)
}

export async function waitFor(fn: () => Promise<boolean>, timeoutMs = 15_000, stepMs = 250): Promise<boolean> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, stepMs))
  }
  return false
}
