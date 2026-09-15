// In-app job entries (ARCHITECTURE §6): createJobsForImport, processNextJob, retryFailedJobs.
import { asc, eq, inArray, sql } from 'drizzle-orm'
import type { ImportStatus, JobsNextResponse, JobStatus, Progress } from '@/contracts'
import { nowIso } from '@/lib/time'
import { claims, events, extractionJobs, getOwnedOr404, getUserSettings, handles, importantDates, imports, messages, owned, relations, withOwner, type Db } from '@/server/db'
import type { ServerEnv } from '@/server/env'
import { ApiError } from '@/server/errors'
import type { LlmClient } from '@/server/llm'
import { d1Store } from './d1-store'
import { extractWindow, resolveExtractModel } from './pipeline'
import { PROMPT_VERSION, promptFeatures } from './prompt-version'
import type { WindowOutcome } from './types'
import { packWindows, planWindows } from './windowing'

/** PLAN "重试最多 2 次": 3 attempts per window in total (DECISIONS A5 #16). */
export const MAX_ATTEMPTS = 3
/** A job left `running` longer than this (request died) may be claimed again; that dead attempt still counts. */
export const STALE_LOCK_MS = 60_000
const INSERT_CHUNK = 50

export async function getProgress(db: Db, ownerId: string, importId: number): Promise<Progress> {
  const rows = await db
    .select({ status: extractionJobs.status, n: sql<number>`count(*)` })
    .from(extractionJobs)
    .where(owned(extractionJobs, ownerId, eq(extractionJobs.importId, importId)))
    .groupBy(extractionJobs.status)
    .all()
  const p: Progress = { total: 0, done: 0, failed: 0, pending: 0, running: 0 }
  for (const r of rows) {
    const n = Number(r.n)
    p[r.status] += n
    p.total += n
  }
  return p
}

export async function createJobsForImport(db: Db, ownerId: string, importId: number, focus: [number, number][]): Promise<number> {
  const imp = await getOwnedOr404(db, imports, ownerId, importId)
  if (imp.chatId === null) throw new ApiError(409, 'conflict', '这次导入还没有选择聊天')
  const existing = await getProgress(db, ownerId, importId)
  if (existing.total > 0) return 0 // idempotent: jobs are created once, by mapping
  if (!focus.length) return 0
  const msgs = await db
    .select({ seq: messages.seq, sentAt: messages.sentAt })
    .from(messages)
    .where(owned(messages, ownerId, eq(messages.chatId, imp.chatId)))
    .orderBy(asc(messages.seq))
    .all()
  const planned = planWindows(msgs, focus)
  const { packMaxMessages } = promptFeatures(PROMPT_VERSION)
  const plans = packMaxMessages ? packWindows(planned, msgs, packMaxMessages) : planned
  const now = nowIso()
  const rows = plans.map((p) =>
    withOwner<typeof extractionJobs>(
      ownerId,
      { importId, windowStartSeq: p.startSeq, windowEndSeq: p.endSeq, focusStartSeq: p.focusStartSeq, focusEndSeq: p.focusEndSeq, status: 'pending', attempts: 0 },
      now,
    ),
  )
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    // 5 rows per statement keeps each INSERT under D1's 100 bound parameters
    const chunk = rows.slice(i, i + INSERT_CHUNK)
    const stmts = []
    for (let j = 0; j < chunk.length; j += 5) stmts.push(db.insert(extractionJobs).values(chunk.slice(j, j + 5)))
    await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]])
  }
  return plans.length
}

async function countProposed(db: Db, ownerId: string, importId: number): Promise<number> {
  const count = sql<number>`count(*)`
  const [c, h, r, e, d] = await Promise.all([
    db.select({ n: count }).from(claims).where(owned(claims, ownerId, eq(claims.importId, importId), eq(claims.status, 'proposed'))).get(),
    db.select({ n: count }).from(handles).where(owned(handles, ownerId, eq(handles.importId, importId), eq(handles.status, 'proposed'))).get(),
    db.select({ n: count }).from(relations).where(owned(relations, ownerId, eq(relations.importId, importId), eq(relations.status, 'proposed'))).get(),
    db.select({ n: count }).from(events).where(owned(events, ownerId, eq(events.importId, importId), eq(events.status, 'proposed'))).get(),
    db.select({ n: count }).from(importantDates).where(owned(importantDates, ownerId, eq(importantDates.importId, importId), eq(importantDates.status, 'proposed'))).get(),
  ])
  return [c, h, r, e, d].reduce((s, x) => s + Number(x?.n ?? 0), 0)
}

/** extracting → reviewing (items to review or failed windows to retry) | done, once no job is pending or running. */
async function finalizeIfIdle(db: Db, ownerId: string, importId: number, status: ImportStatus, progress: Progress): Promise<ImportStatus> {
  if (status !== 'extracting' || progress.pending > 0 || progress.running > 0) return status
  const next: ImportStatus = progress.failed > 0 || (await countProposed(db, ownerId, importId)) > 0 ? 'reviewing' : 'done'
  await db
    .update(imports)
    .set({ status: next, updatedAt: nowIso() })
    .where(owned(imports, ownerId, eq(imports.id, importId), eq(imports.status, 'extracting')))
  return next
}

export async function processNextJob(
  db: Db,
  llm: LlmClient,
  ownerId: string,
  importId: number,
  opts: { deadlineAt: number; env: Pick<ServerEnv, 'EXTRACT_MODEL'> },
): Promise<JobsNextResponse> {
  const imp = await getOwnedOr404(db, imports, ownerId, importId)
  if (imp.status !== 'extracting') {
    return { processed: null, progress: await getProgress(db, ownerId, importId), importStatus: imp.status }
  }
  const settings = await getUserSettings(db, ownerId)
  const model = resolveExtractModel(settings, opts.env)

  const now = nowIso()
  const stale = new Date(Date.now() - STALE_LOCK_MS).toISOString()
  const pick = sql`(SELECT id FROM extraction_jobs WHERE owner_id = ${ownerId} AND import_id = ${importId} AND (status = 'pending' OR (status = 'running' AND locked_at < ${stale})) ORDER BY id LIMIT 1)`
  const job = await db
    .update(extractionJobs)
    .set({ status: 'running', lockedAt: now, attempts: sql`${extractionJobs.attempts} + 1`, model, promptVersion: PROMPT_VERSION, updatedAt: now })
    .where(owned(extractionJobs, ownerId, eq(extractionJobs.id, pick)))
    .returning()
    .get()

  if (!job) {
    const progress = await getProgress(db, ownerId, importId)
    return { processed: null, progress, importStatus: await finalizeIfIdle(db, ownerId, importId, imp.status, progress) }
  }

  let status: JobStatus
  let code: string | undefined
  let itemsCreated = 0
  let rawOutput: string | null = null
  let error: string | null = null

  if (job.attempts > MAX_ATTEMPTS) {
    // reclaimed after its last allowed attempt died mid-request
    status = 'failed'
    code = 'deadline'
    error = 'deadline: request ended before the attempt finished'
  } else {
    let outcome: WindowOutcome
    try {
      outcome = await extractWindow(
        { llm, store: d1Store(db, ownerId), model, deadlineAt: opts.deadlineAt, context: { ownerId, importId, jobId: job.id } },
        { importId, jobId: job.id, windowIndex: job.id, startSeq: job.windowStartSeq, endSeq: job.windowEndSeq, focusStartSeq: job.focusStartSeq, focusEndSeq: job.focusEndSeq },
      )
    } catch (e) {
      // storage or programming error: never echo the message (drizzle errors include bound params = message text)
      console.log(JSON.stringify({ level: 'error', msg: 'extract window failed', importId, jobId: job.id, error: (e as Error).name }))
      outcome = { status: 'retryable_error', code: 'llm_error', message: `internal: ${(e as Error).name}`, latencyMs: 0 }
      code = 'internal'
    }
    rawOutput = outcome.raw ?? null
    if (outcome.status === 'done') {
      status = 'done'
      itemsCreated = outcome.itemsCreated
      if (outcome.dedup === 'skipped_deadline') {
        console.log(JSON.stringify({ level: 'info', msg: 'dedup skipped (deadline)', importId, jobId: job.id }))
      }
    } else {
      code = code ?? outcome.code
      error = `${code}: ${outcome.message}`.slice(0, 500)
      status = outcome.status === 'fatal_error' || job.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
    }
  }

  await db
    .update(extractionJobs)
    .set({ status, lockedAt: null, rawOutput, error, itemsCreated, updatedAt: nowIso() })
    .where(owned(extractionJobs, ownerId, eq(extractionJobs.id, job.id), eq(extractionJobs.lockedAt, now)))

  const progress = await getProgress(db, ownerId, importId)
  const importStatus = await finalizeIfIdle(db, ownerId, importId, imp.status, progress)
  return { processed: { jobId: job.id, status, itemsCreated, ...(code ? { code } : {}) }, progress, importStatus }
}

export async function retryFailedJobs(db: Db, ownerId: string, importId: number, jobIds?: number[]): Promise<{ reset: number; progress: Progress }> {
  const imp = await getOwnedOr404(db, imports, ownerId, importId)
  const reset = await db
    .update(extractionJobs)
    .set({ status: 'pending', attempts: 0, error: null, lockedAt: null, updatedAt: nowIso() })
    .where(
      owned(
        extractionJobs,
        ownerId,
        eq(extractionJobs.importId, importId),
        eq(extractionJobs.status, 'failed'),
        jobIds && jobIds.length ? inArray(extractionJobs.id, jobIds) : undefined,
      ),
    )
    .returning({ id: extractionJobs.id })
    .all()
  if (reset.length && (imp.status === 'reviewing' || imp.status === 'done' || imp.status === 'failed')) {
    await db
      .update(imports)
      .set({ status: 'extracting', updatedAt: nowIso() })
      .where(owned(imports, ownerId, eq(imports.id, importId)))
  }
  return { reset: reset.length, progress: await getProgress(db, ownerId, importId) }
}
