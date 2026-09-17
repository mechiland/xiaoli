import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  // Secrets are read from the Cloudflare env binding at request time; nothing is inlined here.
  devIndicators: false,
}

export default nextConfig

// Makes D1/R2 bindings (wrangler.jsonc + .dev.vars) available to `next dev` via getCloudflareContext().
initOpenNextCloudflareForDev()
