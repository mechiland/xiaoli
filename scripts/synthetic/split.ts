// Minimal SPEC §6 splitter used ONLY by the synthetic generator's self-check and by eval-synthetic tests.
// It is deliberately independent of lib/wechat-export (the parser module) so the fixtures can be validated
// before/without the parser. It does not classify kinds.

export const HEADER_TIME = /^\d{4}年\d{2}月\d{2}日 \d{2}:\d{2}$/

export interface SplitMessage {
  /** 0-based order in file */
  idx: number
  senderName: string
  /** 'YYYY年MM月DD日 HH:MM' as in the file */
  time: string
  /** 'YYYY-MM-DD HH:MM' */
  sentAt: string
  body: string
  /** 1-based line number of the `·sender` line */
  line: number
}

export function splitExportText(txt: string): SplitMessage[] {
  const lines = txt.replace(/^﻿/, '').split(/\r?\n/)
  const starts: number[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].startsWith('·') && HEADER_TIME.test(lines[i + 1])) {
      starts.push(i)
      i++ // the time line can never itself start a message
    }
  }
  const out: SplitMessage[] = []
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k]
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length
    const bodyLines = lines.slice(s + 2, end)
    while (bodyLines.length && bodyLines[0].trim() === '') bodyLines.shift()
    while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop()
    const time = lines[s + 1]
    const m = /^(\d{4})年(\d{2})月(\d{2})日 (\d{2}):(\d{2})$/.exec(time)!
    out.push({
      idx: k,
      senderName: lines[s].slice(1),
      time,
      sentAt: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`,
      body: bodyLines.join('\n'),
      line: s + 1,
    })
  }
  return out
}
