import { Hono } from 'hono'
import { PatchSettingsRequestSchema, type SettingsResponse } from '@/contracts'
import { requireUser, type AppEnv } from '@/server/context'
import { getUserSettings, updateUserSettings } from '@/server/db'
import { validator } from '@/server/middleware/validate'

// owner: core — GET/PATCH /api/settings
const route = new Hono<AppEnv>()
  .get('/settings', async (c) => {
    const user = requireUser(c)
    return c.json({ settings: await getUserSettings(c.var.db, user.id) } satisfies SettingsResponse)
  })
  .patch('/settings', validator('json', PatchSettingsRequestSchema), async (c) => {
    const user = requireUser(c)
    const settings = await updateUserSettings(c.var.db, user.id, c.req.valid('json'))
    return c.json({ settings } satisfies SettingsResponse)
  })

export default route
