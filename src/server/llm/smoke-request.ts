// The one tiny synthetic request used by the live smoke run and its replay test.
import { z } from 'zod'
import type { LlmJsonRequest } from './types'

export const SMOKE_PROMPT_VERSION = 'llm-smoke.v1'

export const SmokeOutputSchema = z.object({ city: z.string().nullable(), job: z.string().nullable() })

export function smokeRequest(model: string): LlmJsonRequest {
  return {
    purpose: 'other',
    promptVersion: SMOKE_PROMPT_VERSION,
    model,
    messages: [
      {
        role: 'system',
        content: '你是信息抽取助手。只输出一个 json 对象，不要输出其他文字。json 格式示例：{"city": "城市名，没有则为 null", "job": "职业，没有则为 null"}',
      },
      { role: 'user', content: '合成测试消息：「下个月我搬去成都，继续当小学老师。」请抽取说话人的城市和职业，输出 json。' },
    ],
    maxTokens: 200,
    timeoutMs: 30_000,
    maxTransportRetries: 1,
  }
}
