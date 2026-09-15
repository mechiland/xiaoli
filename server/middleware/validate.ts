import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import type { ZodType } from 'zod'
import { errors } from '@/server/errors'

/** zod validation for every route (ARCHITECTURE §2.7); failure → 400 `validation_failed` envelope. */
export function validator<Target extends keyof ValidationTargets, Schema extends ZodType>(target: Target, schema: Schema) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      return c.json(errors.validation(undefined, { target, issues }).toBody(), 400)
    }
  })
}
