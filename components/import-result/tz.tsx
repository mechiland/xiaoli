'use client'
// APP_TZ for this page (read by the server page from env, ARCHITECTURE §3), so IsoString dates show the local day.

import { createContext, useContext, type ReactNode } from 'react'
import { DEFAULT_TZ } from '@/lib/time'

const AppTzContext = createContext<string>(DEFAULT_TZ)

export function AppTzProvider({ tz, children }: { tz?: string; children: ReactNode }) {
  return <AppTzContext.Provider value={tz || DEFAULT_TZ}>{children}</AppTzContext.Provider>
}

export const useAppTz = () => useContext(AppTzContext)
