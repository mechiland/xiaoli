import { Hono } from 'hono'
import type { AppEnv } from '@/server/context'
import { notImplemented } from './_stub'

// owner: home (core bootstrap stub)
const route = new Hono<AppEnv>().get('/home', (c) => notImplemented(c))

export default route
