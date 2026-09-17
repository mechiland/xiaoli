import { app } from '@/server/app'

// Hono entry (SPEC §4). Node runtime (OpenNext Cloudflare); no `export const runtime = 'edge'`.
const handler = (req: Request) => app.fetch(req)

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const OPTIONS = handler
export const HEAD = handler
