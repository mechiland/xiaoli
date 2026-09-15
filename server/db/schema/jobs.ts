import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { ExtractModel, ReviewAction, TargetType } from '@/contracts'
import { entityColumns } from './_columns'
import { user } from './auth'
import { imports } from './import'

export const extractionJobs = sqliteTable(
  'extraction_jobs',
  {
    ...entityColumns(),
    importId: integer('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    windowStartSeq: integer('window_start_seq').notNull(),
    windowEndSeq: integer('window_end_seq').notNull(),
    focusStartSeq: integer('focus_start_seq').notNull(),
    focusEndSeq: integer('focus_end_seq').notNull(),
    status: text('status', { enum: ['pending', 'running', 'done', 'failed'] }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    lockedAt: text('locked_at'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    rawOutput: text('raw_output'),
    error: text('error'),
    itemsCreated: integer('items_created').notNull().default(0),
  },
  (t) => [index('extraction_jobs_owner_idx').on(t.ownerId), index('extraction_jobs_import_status_idx').on(t.importId, t.status)],
)

export const reviewLog = sqliteTable(
  'review_log',
  {
    ...entityColumns(),
    targetType: text('target_type').$type<TargetType>().notNull(),
    targetId: integer('target_id').notNull(),
    action: text('action').$type<ReviewAction>().notNull(),
    before: text('before', { mode: 'json' }),
    after: text('after', { mode: 'json' }),
  },
  (t) => [index('review_log_owner_idx').on(t.ownerId), index('review_log_owner_target_idx').on(t.ownerId, t.targetType, t.targetId)],
)

/** No FK on owner_id: CLI calls have a null owner; delete-all removes rows by owner_id. */
export const llmCalls = sqliteTable(
  'llm_calls',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerId: text('owner_id'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    purpose: text('purpose', { enum: ['extract', 'dedup', 'judge', 'other'] }).notNull(),
    importId: integer('import_id'),
    jobId: integer('job_id'),
    evalRunId: text('eval_run_id'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheHitTokens: integer('cache_hit_tokens'),
    latencyMs: integer('latency_ms').notNull(),
    attempt: integer('attempt').notNull(),
    mode: text('mode', { enum: ['live', 'record', 'replay'] }).notNull(),
    cassetteKey: text('cassette_key'),
    rawOutput: text('raw_output'),
    finishReason: text('finish_reason'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('llm_calls_owner_created_idx').on(t.ownerId, t.createdAt),
    index('llm_calls_import_idx').on(t.importId),
    index('llm_calls_created_idx').on(t.createdAt),
  ],
)

export const userSettings = sqliteTable('user_settings', {
  ownerId: text('owner_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  selfDisplayNames: text('self_display_names', { mode: 'json' }).$type<string[]>().notNull().default([]),
  /** null → env EXTRACT_MODEL → 'deepseek-flash' */
  extractModel: text('extract_model').$type<ExtractModel>(),
  highConfidenceThreshold: real('high_confidence_threshold').notNull().default(0.8),
  onboardedAt: text('onboarded_at'),
  updatedAt: text('updated_at').notNull(),
})
