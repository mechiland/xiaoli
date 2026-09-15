import { Fragment } from 'react'
import { highlightRanges, segmentsFor } from '@/server/search/text'

/** Renders text with keyword marks: pass server `ranges`, or `terms` to compute them the same way the server does. */
export function Highlight({ text, ranges, terms }: { text: string; ranges?: [number, number][]; terms?: string[] }) {
  const r = ranges ?? (terms?.length ? highlightRanges(text, terms) : [])
  return (
    <>
      {segmentsFor(text, r).map((s, i) =>
        s.hit ? (
          <mark key={i} className="border-b border-line-strong bg-highlight px-[1px] text-ink [box-decoration-break:clone]">
            {s.text}
          </mark>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  )
}
