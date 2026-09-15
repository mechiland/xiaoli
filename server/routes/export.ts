import { Hono } from 'hono'
import { DeleteAllRequestSchema, type DeleteAllResponse } from '@/contracts'
import { requireUser, type AppEnv } from '@/server/context'
import { validator } from '@/server/middleware/validate'
import { buildExportDump, deleteAllData, exportFileName } from '@/server/settings'

// owner: settings — GET /api/export, DELETE /api/data (ARCHITECTURE §2.4, §11)
const route = new Hono<AppEnv>()
  .get('/export', async (c) => {
    const user = requireUser(c)
    const dump = await buildExportDump(c.var.db, user)
    c.header('content-disposition', `attachment; filename="${exportFileName()}"`)
    c.header('cache-control', 'no-store')
    return c.json(dump)
  })
  .delete('/data', validator('json', DeleteAllRequestSchema), async (c) => {
    const user = requireUser(c)
    const r2 = c.get('env').R2
    const result = await deleteAllData(c.var.db, r2, user.id)
    console.log(JSON.stringify({ level: 'info', msg: 'delete_all_data', r2Objects: result.r2Objects }))
    return c.json(result satisfies DeleteAllResponse)
  })

export default route
