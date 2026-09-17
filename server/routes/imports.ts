import { Hono } from 'hono'
import {
  AttachmentNameParamSchema,
  CreateImportRequestSchema,
  IdParamSchema,
  ImportCheckRequestSchema,
  JobsNextRequestSchema,
  JobsRetryRequestSchema,
  MappingRequestSchema,
  type CreateImportResponse,
  type DeleteImportResult,
  type ImportCheckResponse,
  type ImportDetailResponse,
  type MappingResponse,
  type UploadAttachmentResponse,
} from '@/contracts'
import { getR2, requireUser, type AppEnv } from '@/server/context'
import { processNextJob, retryFailedJobs } from '@/server/extract'
import { checkDuplicate, createImport } from '@/server/import/create'
import { deleteImport } from '@/server/import/delete'
import { getImportDetail, uploadAttachment } from '@/server/import/detail'
import { applyMapping } from '@/server/import/mapping'
import { getAppLlm } from '@/server/llm'
import { validator } from '@/server/middleware/validate'

// owner: import. jobs/next and jobs/retry bodies are contractual (ARCHITECTURE §1.4).
const route = new Hono<AppEnv>()
  .post('/imports/check', validator('json', ImportCheckRequestSchema), async (c) => {
    const user = requireUser(c)
    return c.json((await checkDuplicate(c.var.db, user.id, c.req.valid('json').sha256)) satisfies ImportCheckResponse)
  })
  .post('/imports', validator('json', CreateImportRequestSchema), async (c) => {
    const user = requireUser(c)
    const res = await createImport(c.var.db, getR2(c), user.id, c.req.valid('json'))
    return c.json(res satisfies CreateImportResponse, 201)
  })
  .put('/imports/:id/attachments/:name', validator('param', AttachmentNameParamSchema), async (c) => {
    const user = requireUser(c)
    const { id, name } = c.req.valid('param')
    const len = c.req.header('content-length')
    const attachment = await uploadAttachment(
      c.var.db,
      getR2(c),
      user.id,
      id,
      name,
      () => c.req.arrayBuffer(),
      c.req.header('content-type') ?? null,
      len && /^\d+$/.test(len) ? Number(len) : null,
    )
    return c.json({ attachment } satisfies UploadAttachmentResponse)
  })
  .get('/imports/:id', validator('param', IdParamSchema), async (c) => {
    const user = requireUser(c)
    return c.json((await getImportDetail(c.var.db, user.id, c.req.valid('param').id)) satisfies ImportDetailResponse)
  })
  .delete('/imports/:id', validator('param', IdParamSchema), async (c) => {
    const user = requireUser(c)
    return c.json((await deleteImport(c.var.db, getR2(c), user.id, c.req.valid('param').id)) satisfies DeleteImportResult)
  })
  .post('/imports/:id/mapping', validator('param', IdParamSchema), validator('json', MappingRequestSchema), async (c) => {
    const user = requireUser(c)
    const res = await applyMapping(c.var.db, getR2(c), user.id, c.req.valid('param').id, c.req.valid('json'))
    return c.json(res satisfies MappingResponse)
  })
  .post('/imports/:id/jobs/next', validator('param', IdParamSchema), validator('json', JobsNextRequestSchema), async (c) => {
    const user = requireUser(c)
    const { id } = c.req.valid('param')
    const deadlineAt = Date.now() + 28_000
    return c.json(await processNextJob(c.var.db, await getAppLlm(c), user.id, id, { deadlineAt, env: c.var.env }))
  })
  .post('/imports/:id/jobs/retry', validator('param', IdParamSchema), validator('json', JobsRetryRequestSchema), async (c) => {
    const user = requireUser(c)
    const { id } = c.req.valid('param')
    return c.json(await retryFailedJobs(c.var.db, user.id, id, c.req.valid('json').jobIds))
  })

export default route
