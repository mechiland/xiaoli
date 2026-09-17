'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ApiClientError } from '@/lib/api-client'

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Client errors (4xx) are not retried; transient ones once.
        retry: (failureCount, error) => {
          if (error instanceof ApiClientError && error.status < 500) return false
          return failureCount < 1
        },
      },
    },
  })
}

/** TanStack Query provider (one client per browser session). */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
