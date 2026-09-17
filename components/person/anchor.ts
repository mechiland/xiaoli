'use client'
// Person page anchors (ARCHITECTURE §1.7): #claim-/#relation-/#date-/#event-/#handle-<id> expands the containing
// collapsed region, scrolls the row to the viewport centre and highlights it for 2 s.

import { useEffect, useRef } from 'react'
import { parseAnchor } from './format'

export type AnchorTarget = NonNullable<ReturnType<typeof parseAnchor>>

const HIGHLIGHT_MS = 2000

/**
 * `expand(target)` is called first so the region holding the row renders (history, alias list, narrow infobox);
 * then the row is looked up for up to ~1.5 s (data may still be arriving) and scrolled + highlighted.
 */
export function useAnchorHighlight(expand: (target: AnchorTarget) => void, ready: boolean) {
  const expandRef = useRef(expand)
  expandRef.current = expand

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const timers: number[] = []

    const run = () => {
      const target = parseAnchor(window.location.hash)
      if (!target) return
      expandRef.current(target)
      const domId = `${target.type}-${target.id}`
      let tries = 0
      const attempt = () => {
        if (cancelled) return
        // ids are unique on the page; still pick a rendered element so a hidden copy can never swallow the anchor
        const el = [...document.querySelectorAll<HTMLElement>(`[id="${domId}"]`)].find((e) => e.getClientRects().length > 0)
        if (!el) {
          if (tries++ < 30) timers.push(window.setTimeout(attempt, 50))
          return
        }
        el.scrollIntoView({ block: 'center', behavior: 'auto' })
        el.setAttribute('data-highlight', 'true')
        timers.push(
          window.setTimeout(() => {
            el.removeAttribute('data-highlight')
          }, HIGHLIGHT_MS),
        )
      }
      // two frames: let the expanded region commit and lay out
      requestAnimationFrame(() => requestAnimationFrame(attempt))
    }

    run()
    window.addEventListener('hashchange', run)
    return () => {
      cancelled = true
      window.removeEventListener('hashchange', run)
      for (const t of timers) window.clearTimeout(t)
    }
  }, [ready])
}
