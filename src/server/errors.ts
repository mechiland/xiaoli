import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ApiErrorBody, ApiErrorCode } from '@/contracts'

/** Thrown by handlers/helpers; `app.onError` converts it to the error envelope. `message` is user-facing Chinese. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: ApiErrorCode | (string & {})
  readonly details: unknown

  constructor(status: ContentfulStatusCode, code: ApiErrorCode | (string & {}), message?: string, details?: unknown) {
    super(message ?? DEFAULT_MESSAGES[code as ApiErrorCode] ?? code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  toBody(): ApiErrorBody {
    return {
      error: { code: this.code, message: this.message, ...(this.details === undefined ? {} : { details: this.details }) },
    }
  }
}

const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  unauthorized: '请先登录',
  forbidden: '没有权限',
  not_found: '没有找到',
  validation_failed: '提交的内容不正确',
  duplicate_import: '这份文件已经导入过',
  conflict: '当前状态不允许这个操作',
  payload_too_large: '文件太大了',
  attachment_missing: '附件未导入',
  not_implemented: '这个功能还在建设中',
  llm_unavailable: '模型暂时不可用',
  budget_exceeded: '模型调用额度已用完',
  internal: '服务器出错了',
}

export const errors = {
  unauthorized: (message?: string) => new ApiError(401, 'unauthorized', message),
  forbidden: (message?: string) => new ApiError(403, 'forbidden', message),
  notFound: (message?: string) => new ApiError(404, 'not_found', message),
  validation: (message?: string, details?: unknown) => new ApiError(400, 'validation_failed', message, details),
  duplicateImport: (importId: number, message?: string) => new ApiError(409, 'duplicate_import', message, { importId }),
  conflict: (message?: string, details?: unknown) => new ApiError(409, 'conflict', message, details),
  payloadTooLarge: (message?: string) => new ApiError(413, 'payload_too_large', message),
  attachmentMissing: (message?: string) => new ApiError(404, 'attachment_missing', message),
  notImplemented: (message?: string) => new ApiError(501, 'not_implemented', message),
  llmUnavailable: (message?: string) => new ApiError(503, 'llm_unavailable', message),
  budgetExceeded: (message?: string) => new ApiError(503, 'budget_exceeded', message),
  internal: (message?: string) => new ApiError(500, 'internal', message),
}

export function errorBody(code: ApiErrorCode, message?: string, details?: unknown): ApiErrorBody {
  return new ApiError(500, code, message, details).toBody()
}
