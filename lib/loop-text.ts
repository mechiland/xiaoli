/**
 * How a 未结事项 is worded, shared (SPEC §7 交互层, §9.5, §9.9). Pure.
 *
 * It lives here rather than in either UI module because the person page and the import result page show the SAME
 * loop, and they must word it the same way — for one round they did not: the person page printed the raw extracted
 * fragment ("把露营装备清单发过去。") while the import result page read it as a sentence ("你答应把露营装备清单发
 * 过去"). Core-request import-result#4, resolved by sharing this rather than by making the prompt emit whole
 * sentences: the stored `loops.text` stays a bare fragment, so re-wording is a presentation change, not a re-extraction.
 */
import type { LoopDTO, LoopKind } from '@/contracts'

/** The gutter label of a loop chunk: what kind of unfinished thing it is, never the raw enum. */
export const LOOP_KIND_LABEL: Record<LoopKind, string> = {
  promise: '承诺',
  question: '问题',
  plan: '约定',
}

/** Handled loops say what happened to them instead of a bare 已确认. */
export function loopStateLabel(loop: Pick<LoopDTO, 'state' | 'status'>): string | null {
  if (loop.status === 'rejected' || loop.status === 'superseded') return null
  if (loop.state === 'done') return '已了结'
  if (loop.state === 'dropped') return '不用管了'
  return null
}

const startsWithAny = (t: string, heads: string[]) => heads.some((h) => t.startsWith(h))
const ANSWERED = /没回|未回|没有回|没答|未答|还没回复/

/**
 * A loop read as a sentence the user would say — "你答应帮她看简历", "她问你国庆有没有空，你没回", "约好下个月去成都".
 * `direction` and `kind` are never printed: they choose the subject and the verb around the extracted text, which is
 * a bare fragment ("把清单发过去"). `direction: 'mine'` is the user's own obligation — the user promised, or the user
 * owes the answer. The verb is left out when the text already starts with it, so nothing is said twice.
 */
export function loopSentence(loop: Pick<LoopDTO, 'direction' | 'kind' | 'text'>, personLabel: string): string {
  const text = loop.text.trim()
  if (!text) return ''
  const other = personLabel.trim() || '对方'
  switch (loop.kind) {
    case 'plan': {
      if (startsWithAny(text, ['约', '说好', '说定', '计划', '打算'])) return text
      // A plan that is `theirs` is the other person's own plan ("我四月底搬去深圳") — nobody agreed to it with
      // the user, so "约好" would put an agreement where there is none. It is still a loop: the user wants to
      // remember it. (Annotator finding, DECISIONS I18 #3.)
      if (loop.direction === 'theirs') return `${other}打算${text}`
      return `约好${text}`
    }
    case 'promise': {
      const subject = loop.direction === 'mine' ? '你' : loop.direction === 'theirs' ? other : '你们'
      const said = startsWithAny(text, ['答应', '说好', '说定', '承诺', '要'])
      const verb = said ? '' : loop.direction === 'mutual' ? '说好' : '答应'
      return subject + verb + text
    }
    case 'question': {
      // 'mine' = they asked, the answer is on the user; 'theirs' = the user asked and is still waiting
      const mine = loop.direction === 'mine'
      const asker = mine ? other : '你'
      const head = startsWithAny(text, ['问']) ? asker : `${asker}问${mine ? '你' : ''}`
      const tail = ANSWERED.test(text) ? '' : `，${mine ? '你' : other}没回`
      return head + text + tail
    }
  }
}
