import { describe, expect, it } from 'vitest'
import type { WindowInput } from './types'
import { validateOutput } from './validate'

// Invented names only.
function input(n = 5, extra: Partial<WindowInput> = {}): WindowInput {
  return {
    chat: { title: '周末徒步', kind: 'group' },
    selfPersonId: 1,
    known: [
      { personId: 1, label: '我', handles: [{ kind: 'display_group', value: '山野' }], claims: [] },
      { personId: 2, label: '周明', handles: [{ kind: 'display_group', value: '阿明' }], claims: [{ id: 50, statement: '住在成都', category: 'location' }] },
    ],
    messages: Array.from({ length: n }, (_, i) => ({ localSeq: i + 1, sentAt: '2026-05-01 10:00', senderName: i % 2 ? '阿明' : '山野', senderPersonId: i % 2 ? 2 : 1, kind: 'text' as const, body: `消息${i + 1}` })),
    ...extra,
  }
}
const claim = (over: Record<string, unknown> = {}) => ({ person: { personId: 2 }, statement: '在成都做护士', category: 'work', confidence: 0.9, sensitive: false, evidence: [2], ...over })

describe('validateOutput', () => {
  it('rejects non-objects, unknown keys and non-array values as validation_failed', () => {
    expect(validateOutput('nope', input())).toMatchObject({ error: 'validation_failed' })
    expect(validateOutput([], input())).toMatchObject({ error: 'validation_failed' })
    expect(validateOutput({ claims: [], notes: 'x' }, input())).toMatchObject({ error: 'validation_failed' })
    expect(validateOutput({ claims: {} }, input())).toMatchObject({ error: 'validation_failed' })
  })

  it('accepts missing keys as empty and counts raw items', () => {
    const r = validateOutput({ claims: [claim()] }, input())
    if ('error' in r) throw new Error('unexpected')
    expect(r.rawItemCount).toBe(1)
    expect(r.output.claims).toHaveLength(1)
    expect(r.output.handles).toEqual([])
  })

  it('drops invalid items individually (strict item schema) and normalises nulls and "#n" evidence', () => {
    const r = validateOutput(
      {
        claims: [claim({ validFrom: null, supersedesClaimId: null, evidence: ['#2', 3] }), claim({ category: 'job' }), claim({ extraField: 1 }), claim({ evidence: [] })],
      },
      input(),
    )
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.claims).toHaveLength(1)
    expect(r.output.claims[0].evidence).toEqual([2, 3])
    expect(r.output.claims[0]).not.toHaveProperty('validFrom')
    expect(r.dropped.map((d) => d.reason)).toEqual(['invalid_item', 'invalid_item', 'invalid_item'])
  })

  it('drops items whose evidence is outside the window', () => {
    const r = validateOutput({ claims: [claim({ evidence: [2, 6] }), claim({ statement: '喜欢爬山', evidence: [0] }), claim({ statement: '会做饭', evidence: [5] })] }, input(5))
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.claims.map((c) => c.statement)).toEqual(['会做饭'])
    expect(r.dropped.filter((d) => d.reason === 'evidence_out_of_window')).toHaveLength(2)
  })

  it('drops items resting only on context messages', () => {
    const base = input(4)
    base.messages[0].context = true
    base.messages[1].context = true
    const r = validateOutput({ claims: [claim({ evidence: [1, 2] }), claim({ statement: '会做饭', evidence: [2, 3] })] }, base)
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.claims.map((c) => c.statement)).toEqual(['会做饭'])
    expect(r.dropped).toEqual([{ path: 'claims[0]', reason: 'context_only' }])
  })

  it('drops unknown persons and tempIds, maps a "new" person with a known name to that person', () => {
    const r = validateOutput(
      {
        newPersons: [
          { tempId: 't1', label: '阿明', evidence: [2] },
          { tempId: 't2', label: '小林', evidence: [3] },
        ],
        claims: [claim({ person: { personId: 99 } }), claim({ person: { tempId: 't9' } }), claim({ person: { tempId: 't1' }, statement: '会弹吉他' }), claim({ person: { tempId: 't2' }, statement: '在读研' })],
      },
      input(),
    )
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.newPersons.map((p) => p.tempId)).toEqual(['t2'])
    expect(r.output.claims.map((c) => [c.person, c.statement])).toEqual([
      [{ personId: 2 }, '会弹吉他'],
      [{ tempId: 't2' }, '在读研'],
    ])
    expect(r.dropped.filter((d) => d.reason === 'unknown_person')).toHaveLength(2)
  })

  it('strips a supersedesClaimId that is not a known confirmed claim, keeps a valid one', () => {
    const r = validateOutput({ claims: [claim({ statement: '搬到了重庆', category: 'location', supersedesClaimId: 50 }), claim({ statement: '在重庆工作', supersedesClaimId: 777 })] }, input())
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.claims[0].supersedesClaimId).toBe(50)
    expect(r.output.claims[1].supersedesClaimId).toBeUndefined()
    expect(r.dropped).toEqual([{ path: 'claims[1].supersedesClaimId', reason: 'unknown_supersedes' }])
  })

  it("never lets a claim supersede another person's claim", () => {
    const known = [
      { personId: 1, label: '我', handles: [], claims: [] },
      { personId: 2, label: '周明', handles: [], claims: [{ id: 50, statement: '住在成都', category: 'location' as const }] },
      { personId: 3, label: '许青', handles: [], claims: [{ id: 60, statement: '在银行上班', category: 'work' as const }] },
    ]
    const r = validateOutput(
      {
        newPersons: [{ tempId: 't1', label: '小禾', evidence: [1] }],
        claims: [
          claim({ statement: '在医院上班', supersedesClaimId: 60 }),
          claim({ person: { personId: 3 }, statement: '在学校上班', supersedesClaimId: 60 }),
          claim({ person: { tempId: 't1' }, statement: '住在重庆', supersedesClaimId: 50 }),
        ],
      },
      input(5, { known }),
    )
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.claims.map((c) => c.supersedesClaimId)).toEqual([undefined, 60, undefined])
    expect(r.dropped).toEqual([
      { path: 'claims[0].supersedesClaimId', reason: 'unknown_supersedes' },
      { path: 'claims[2].supersedesClaimId', reason: 'unknown_supersedes' },
    ])
  })

  it('drops handles equal to names the person already has, self-loop relations, merges duplicates in a window', () => {
    const r = validateOutput(
      {
        handles: [
          { person: { personId: 2 }, kind: 'mentioned', value: '阿明', evidence: [2] },
          { person: { personId: 2 }, kind: 'address_term', value: '周老师', evidence: [2] },
          { person: { personId: 2 }, kind: 'address_term', value: '周老师', evidence: [4] },
        ],
        relations: [
          { from: { personId: 2 }, to: { personId: 2 }, type: 'friend', evidence: [1] },
          { from: { personId: 2 }, to: { personId: 1 }, type: 'Parent', label: '妈妈', evidence: [3] },
        ],
        claims: [claim({ evidence: [2], confidence: 0.85 }), claim({ evidence: [4], confidence: 0.9 })],
      },
      input(),
    )
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.handles).toEqual([{ person: { personId: 2 }, kind: 'address_term', value: '周老师', evidence: [2, 4] }])
    expect(r.output.relations).toEqual([{ from: { personId: 2 }, to: { personId: 1 }, type: 'parent', label: '妈妈', evidence: [3] }])
    expect(r.output.claims).toHaveLength(1)
    expect(r.output.claims[0]).toMatchObject({ evidence: [2, 4], confidence: 0.9 })
    expect(r.dropped).toEqual([{ path: 'relations[0]', reason: 'self_loop' }])
  })

  it('types grandparent/uncle/in-law relations as relative and drops `other` relations without a relation word', () => {
    const r = validateOutput(
      {
        newPersons: [{ tempId: 't1', label: '小禾', evidence: [1] }],
        relations: [
          { from: { personId: 2 }, to: { tempId: 't1' }, type: 'parent', label: '外婆', evidence: [1] },
          { from: { tempId: 't1' }, to: { personId: 2 }, type: 'child', label: '孙女', evidence: [1] },
          { from: { personId: 2 }, to: { personId: 1 }, type: 'parent', label: '妈妈', evidence: [2] },
          { from: { personId: 2 }, to: { personId: 1 }, type: 'other', label: '阿明', evidence: [3] },
          { from: { personId: 1 }, to: { tempId: 't1' }, type: 'other', label: '小禾', evidence: [3] },
          { from: { personId: 1 }, to: { personId: 2 }, type: 'other', evidence: [3] },
          { from: { personId: 1 }, to: { personId: 2 }, type: 'other', label: '邻居', evidence: [4] },
        ],
      },
      input(),
    )
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.relations.map((x) => [x.type, x.label])).toEqual([
      ['relative', '外婆'],
      ['relative', '孙女'],
      ['parent', '妈妈'],
      ['other', '邻居'],
    ])
    expect(r.dropped).toEqual([
      { path: 'relations[3]', reason: 'invalid_item' },
      { path: 'relations[4]', reason: 'invalid_item' },
      { path: 'relations[5]', reason: 'invalid_item' },
    ])
  })

  it('merges a claim contained in a more specific claim about the same person into it', () => {
    const r = validateOutput(
      {
        claims: [
          claim({ statement: '住在重庆', category: 'location', evidence: [1], supersedesClaimId: 50 }),
          claim({ statement: '住在重庆渝北区', category: 'location', evidence: [3] }),
          claim({ person: { personId: 1 }, statement: '住在重庆', category: 'location', evidence: [4] }),
          claim({ statement: '会游泳', category: 'preference', evidence: [5] }),
        ],
      },
      input(),
    )
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.claims.map((c) => [c.person, c.statement, c.evidence, c.supersedesClaimId])).toEqual([
      [{ personId: 2 }, '住在重庆渝北区', [1, 3], 50],
      [{ personId: 1 }, '住在重庆', [4], undefined],
      [{ personId: 2 }, '会游泳', [5], undefined],
    ])
  })

  it('drops speaker-relative parent/child vocatives as handles in group chats only', () => {
    const out = {
      handles: [
        { person: { personId: 2 }, kind: 'address_term', value: '妈', evidence: [1] },
        { person: { personId: 2 }, kind: 'address_term', value: '老爸', evidence: [1] },
        { person: { personId: 2 }, kind: 'address_term', value: '郑老师', evidence: [1] },
      ],
    }
    const g = validateOutput(out, input())
    if ('error' in g) throw new Error('unexpected')
    expect(g.output.handles.map((h) => h.value)).toEqual(['郑老师'])
    expect(g.dropped.filter((d) => d.reason === 'ambiguous_handle')).toHaveLength(2)
    const p = validateOutput(out, input(5, { chat: { title: '周明', kind: 'private' } }))
    if ('error' in p) throw new Error('unexpected')
    expect(p.output.handles.map((h) => h.value)).toEqual(['妈', '老爸', '郑老师'])
  })

  it('drops low-confidence, momentary and not-yet-happened claims', () => {
    const r = validateOutput(
      {
        claims: [
          claim({ statement: '住在老街附近', confidence: 0.6 }),
          claim({ statement: '喜欢穿红衣服', confidence: 0.8 }),
          claim({ statement: '这两天感冒', confidence: 0.9 }),
          claim({ statement: '将搬去杭州', confidence: 0.9 }),
          claim({ statement: '在成都做护士', confidence: 0.85 }),
        ],
      },
      input(),
    )
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.claims.map((c) => c.statement)).toEqual(['在成都做护士'])
    expect(r.dropped.map((d) => d.reason)).toEqual(['low_confidence', 'low_confidence', 'momentary', 'momentary'])
  })

  it('drops an `other` relation whose label contains a person name, together with the same claim on those messages', () => {
    const r = validateOutput(
      {
        newPersons: [{ tempId: 't1', label: '豆包', evidence: [3] }],
        relations: [{ from: { personId: 2 }, to: { tempId: 't1' }, type: 'other', label: '照顾豆包', evidence: [3] }],
        claims: [claim({ statement: '照顾豆包', category: 'family', evidence: [3] }), claim({ statement: '照顾豆包', category: 'family', evidence: [5] })],
      },
      input(),
    )
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.relations).toEqual([])
    expect(r.output.claims.map((c) => c.evidence)).toEqual([[5]])
  })

  it("moves a child's fact phrased on the parent to the only child named in the window", () => {
    const one = validateOutput(
      {
        newPersons: [{ tempId: 't1', label: '小禾', evidence: [1] }],
        relations: [{ from: { personId: 2 }, to: { tempId: 't1' }, type: 'parent', label: '爸爸', evidence: [1] }],
        claims: [claim({ statement: '儿子喜欢下围棋', category: 'preference', evidence: [3] })],
      },
      input(),
    )
    if ('error' in one) throw new Error('unexpected')
    expect(one.output.claims.map((c) => [c.person, c.statement])).toEqual([[{ tempId: 't1' }, '喜欢下围棋']])

    const two = validateOutput(
      {
        newPersons: [
          { tempId: 't1', label: '小禾', evidence: [1] },
          { tempId: 't2', label: '小苗', evidence: [1] },
        ],
        relations: [
          { from: { personId: 2 }, to: { tempId: 't1' }, type: 'parent', evidence: [1] },
          { from: { tempId: 't2' }, to: { personId: 2 }, type: 'child', evidence: [1] },
        ],
        claims: [claim({ statement: '儿子喜欢下围棋', category: 'preference', evidence: [3] })],
      },
      input(),
    )
    if ('error' in two) throw new Error('unexpected')
    expect(two.output.claims.map((c) => [c.person, c.statement])).toEqual([[{ personId: 2 }, '儿子喜欢下围棋']])
  })

  it('drops the generic student status next to a grade, or without any schooling cue in its messages', () => {
    const base = input(4)
    base.messages[0].body = '暑假留在学校做实验'
    base.messages[1].body = '这个月生活费到了'
    const student = (evidence: number[], personId = 2) => claim({ person: { personId }, statement: '在上学，是学生', category: 'education', evidence })

    const withGrade = validateOutput({ claims: [student([1]), claim({ statement: '读大二', category: 'education', evidence: [1] })] }, base)
    const noCue = validateOutput({ claims: [student([2])] }, base)
    const kept = validateOutput({ claims: [student([1])] }, base)
    const knownGrade = validateOutput({ claims: [student([1])] }, { ...base, known: base.known.map((p) => (p.personId === 2 ? { ...p, claims: [{ id: 51, statement: '上初二', category: 'education' as const }] } : p)) })
    for (const r of [withGrade, noCue, kept, knownGrade]) if ('error' in r) throw new Error('unexpected')
    const statements = (r: typeof kept) => ('error' in r ? [] : r.output.claims.map((c) => c.statement))
    expect(statements(withGrade)).toEqual(['读大二'])
    expect(statements(noCue)).toEqual([])
    expect(statements(kept)).toEqual(['在上学，是学生'])
    expect(statements(knownGrade)).toEqual([])
  })

  it('drops a solar date the model converted from a lunar date on the same messages', () => {
    const r = validateOutput(
      {
        dates: [
          { person: 2, kind: 'birthday', month: 3, day: 8, calendar: 'lunar', evidence: [2] },
          { person: 2, kind: 'birthday', month: 4, day: 24, calendar: 'solar', evidence: [2, 3] },
          { person: 2, kind: 'anniversary', month: 5, day: 1, calendar: 'solar', evidence: [2] },
          { person: 1, kind: 'birthday', month: 4, day: 24, calendar: 'solar', evidence: [2] },
        ],
      },
      input(),
    )
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.dates.map((d) => [d.person, d.kind, d.calendar])).toEqual([
      [{ personId: 2 }, 'birthday', 'lunar'],
      [{ personId: 2 }, 'anniversary', 'solar'],
      [{ personId: 1 }, 'birthday', 'solar'],
    ])
    expect(r.dropped).toEqual([{ path: 'dates[1]', reason: 'invalid_item' }])
  })

  it('accepts bare person ids as refs and removes unknown event participants', () => {
    const r = validateOutput({ events: [{ summary: '一起去露营', participants: [2, 1, 42], evidence: [3] }], dates: [{ person: 2, kind: 'birthday', month: 3, day: 8, calendar: 'lunar', evidence: [5] }] }, input())
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.events[0].participants).toEqual([{ personId: 2 }, { personId: 1 }])
    expect(r.output.dates[0].person).toEqual({ personId: 2 })
  })

  it('does not accept self when no self person exists', () => {
    const r = validateOutput({ claims: [claim({ person: { personId: 0 } })] }, input(5, { selfPersonId: 0 }))
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.claims).toEqual([])
  })
})
