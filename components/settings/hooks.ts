'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PatchSettingsRequest, SettingsDTO } from '@/contracts'
import { api, unwrap } from '@/lib/api-client'
import { queryKeys } from '@/lib/query'

/**
 * GET /api/settings. Each consuming block renders its own BlockError from `isError` (per-block error state);
 * not thrown into BlockBoundary, because React 19 logs every boundary-caught error as a console error.
 */
export function useSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: async () => (await unwrap(await api.settings.$get())).settings,
  })
}

/** GET /api/me (email for the account block). Errors are rendered inline by the caller. */
export function useMeQuery() {
  return useQuery({
    queryKey: queryKeys.me(),
    queryFn: async () => unwrap(await api.me.$get()),
  })
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * PATCH /api/settings with an optimistic cache update and a per-field quiet status:
 * saving → saved (fades back to idle after 2.4 s) or error (cache rolled back; `retry` re-sends the last patch).
 */
export function usePatchSettings() {
  const qc = useQueryClient()
  const [state, setState] = useState<SaveState>('idle')
  const last = useRef<PatchSettingsRequest | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const mutation = useMutation({
    mutationFn: async (patch: PatchSettingsRequest) => (await unwrap(await api.settings.$patch({ json: patch }))).settings,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: queryKeys.settings() })
      const previous = qc.getQueryData<SettingsDTO>(queryKeys.settings())
      if (previous) {
        const { onboarded: _ignored, ...rest } = patch
        qc.setQueryData<SettingsDTO>(queryKeys.settings(), { ...previous, ...rest })
      }
      return { previous }
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.settings(), ctx.previous)
    },
    onSuccess: (settings) => {
      qc.setQueryData(queryKeys.settings(), settings)
      void qc.invalidateQueries({ queryKey: queryKeys.me() })
    },
  })

  const save = useCallback(
    (patch: PatchSettingsRequest) => {
      last.current = patch
      if (timer.current) clearTimeout(timer.current)
      setState('saving')
      mutation.mutate(patch, {
        onSuccess: () => {
          setState('saved')
          timer.current = setTimeout(() => setState('idle'), 2400)
        },
        onError: () => setState('error'),
      })
    },
    [mutation],
  )

  const retry = useCallback(() => {
    if (last.current) save(last.current)
  }, [save])

  return { save, retry, state, pending: mutation.isPending }
}
