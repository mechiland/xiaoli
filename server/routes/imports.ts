import { Hono } from 'hono'
import {
  AttachmentNameParamSchema,
  CreateImportRequestSchema,
  IdParamSchema,
  ImportCheckRequestSchema,
  JobsNextRequestSchema,
  JobsRetryRequestSchema,
  MappingRequestSchema,
} from '@/contracts'
import type { AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { notImplemented } from './_stub'

// owner: import (core bootstrap stub). jobs/next and jobs/retry bodies are contractual (ARCHITECTURE §1.4).
const route = new Hono<AppEnv>()
  .post('/imports/check', validator('json', ImportCheckRequestSchema), (c) => notImplemented(c))
  .post('/imports', validator('json', CreateImportRequestSchema), (c) => notImplemented(c))
  .put('/imports/:id/attachments/:name', validator('param', AttachmentNameParamSchema), (c) => notImplemented(c))
  .get('/imports/:id', validator('param', IdParamSchema), (c) => notImplemented(c))
  .delete('/imports/:id', validator('param', IdParamSchema), (c) => notImplemented(c))
  .post('/imports/:id/mapping', validator('param', IdParamSchema), validator('json', MappingRequestSchema), (c) =>
    notImplemented(c),
  )
  .post('/imports/:id/jobs/next', validator('param', IdParamSchema), validator('json', JobsNextRequestSchema), (c) =>
    notImplemented(c),
  )
  .post('/imports/:id/jobs/retry', validator('param', IdParamSchema), validator('json', JobsRetryRequestSchema), (c) =>
    notImplemented(c),
  )

export default route
