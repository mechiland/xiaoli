import { describe, expect, it } from 'vitest'
import { applySensitiveGuard } from './sensitive'
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

  it('drops the generic student status next to a named school or "在…读书", but not next to a past school, a major or a teaching job', () => {
    const base = input(4, { chat: { title: '小羽毛', kind: 'private' } })
    base.messages[0].body = '一中成人典礼'
    base.messages[2].body = '儿子，啥时候返校'
    const student = claim({ statement: '在上学，是学生', category: 'education', evidence: [1, 3] })
    const statementsWith = (other: Record<string, unknown>) => {
      const r = validateOutput({ claims: [student, claim({ category: 'education', evidence: [1], ...other })] }, base)
      if ('error' in r) throw new Error('unexpected')
      return r.output.claims.map((c) => c.statement)
    }
    expect(statementsWith({ statement: '在云杉市第一中学读书' })).toEqual(['在云杉市第一中学读书'])
    expect(statementsWith({ statement: '在云杉上学' })).toEqual(['在云杉上学'])
    expect(statementsWith({ statement: '云杉市第一中学学生' })).toEqual(['云杉市第一中学学生'])
    expect(statementsWith({ statement: '之前在上海上学' })).toEqual(['在上学，是学生', '之前在上海上学'])
    expect(statementsWith({ statement: '武汉大学计算机系毕业' })).toEqual(['在上学，是学生', '武汉大学计算机系毕业'])
    expect(statementsWith({ statement: '学机械专业' })).toEqual(['在上学，是学生', '学机械专业'])
    expect(statementsWith({ statement: '在第一中学教物理', category: 'work' })).toEqual(['在上学，是学生', '在第一中学教物理'])

    // the school only in a shared post title: the text-supported status stays, the inferred school claim goes
    const shared = input(4, { chat: { title: '小羽毛', kind: 'private' } })
    shared.messages[0] = { ...shared.messages[0], kind: 'channels', body: '[视频号] 云杉市第一中学第十五届成人典礼' }
    shared.messages[2].body = '儿子，啥时候返校'
    const s = validateOutput({ claims: [student, claim({ statement: '在云杉市第一中学读书', category: 'education', evidence: [1] })] }, shared)
    if ('error' in s) throw new Error('unexpected')
    expect(s.output.claims.map((c) => c.statement)).toEqual(['在上学，是学生'])
    expect(s.dropped).toEqual([{ path: 'claims[1]', reason: 'redundant' }])
    // …unless the school is also said in text
    const said = validateOutput({ claims: [student, claim({ statement: '在云杉市第一中学读书', category: 'education', evidence: [1, 3] })] }, shared)
    if ('error' in said) throw new Error('unexpected')
    expect(said.output.claims.map((c) => c.statement)).toEqual(['在云杉市第一中学读书'])

    const known = base.known.map((p) => (p.personId === 2 ? { ...p, claims: [{ id: 52, statement: '在云杉市第一中学读书', category: 'education' as const }] } : p))
    const r = validateOutput({ claims: [student] }, { ...base, known })
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.claims).toEqual([])
    expect(r.dropped).toEqual([{ path: 'claims[0]', reason: 'redundant' }])
  })

  it('private chat: folds a new person that is only the other sender writing their own name (shipping block) into that sender', () => {
    const shipping = (over: Partial<WindowInput> = {}) => {
      const w = input(4, { chat: { title: '阿明', kind: 'private' }, ...over })
      w.messages[1].body = '收货人：王小明\n手机号：13900000000\n所在地区：浙江杭州市西湖区\n详细地址：某某小区1号楼101'
      w.messages[2].body = '我在京东为你下了一笔订单'
      return w
    }
    const output = (extra: Record<string, unknown[]> = {}) => ({
      newPersons: [{ tempId: 't1', label: '王小明', evidence: [2] }],
      handles: [{ person: { tempId: 't1' }, kind: 'real_name', value: '王小明', evidence: [2] }],
      claims: [
        claim({ statement: '提供过收货地址', category: 'other', sensitive: true, evidence: [2] }),
        claim({ person: { tempId: 't1' }, statement: '提供过手机号', category: 'other', sensitive: true, evidence: [2] }),
      ],
      ...extra,
    })

    const r = validateOutput(output(), shipping())
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.newPersons).toEqual([])
    expect(r.output.handles).toEqual([{ person: { personId: 2 }, kind: 'real_name', value: '王小明', evidence: [2] }])
    expect(r.output.claims.map((c) => [c.person, c.statement])).toEqual([
      [{ personId: 2 }, '提供过收货地址'],
      [{ personId: 2 }, '提供过手机号'],
    ])

    // group chat, extract.v7+ (X30): a name-only contact block person is dropped with its items, never folded into the poster
    const group = validateOutput(output(), shipping({ chat: { title: '阿明', kind: 'group' } }), { milestoneRules: true })
    if ('error' in group) throw new Error('unexpected')
    expect(group.output.newPersons).toEqual([])
    expect(group.output.handles).toEqual([])
    expect(group.output.claims.map((c) => [c.person, c.statement])).toEqual([[{ personId: 2 }, '提供过收货地址']])

    // not folded: the name also written by self; more is said about the person (relation, a real fact)
    const kept = (res: ReturnType<typeof validateOutput>) => ('error' in res ? [] : res.output.newPersons.map((p) => p.label))
    expect(kept(validateOutput(output(), shipping({ chat: { title: '阿明', kind: 'group' } })))).toEqual(['王小明']) // before extract.v7: group chats left alone
    expect(kept(validateOutput(output({ claims: [claim({ person: { tempId: 't1' }, statement: '住在杭州', category: 'location', evidence: [2] })] }), shipping({ chat: { title: '阿明', kind: 'group' } })))).toEqual(['王小明'])
    const selfWrites = shipping()
    selfWrites.messages[2].body = '王小明，订单下好了'
    expect(kept(validateOutput(output(), selfWrites))).toEqual(['王小明'])
    expect(kept(validateOutput(output({ relations: [{ from: { tempId: 't1' }, to: { personId: 2 }, type: 'parent', label: '妈妈', evidence: [2] }] }), shipping()))).toEqual(['王小明'])
    expect(kept(validateOutput(output({ claims: [claim({ person: { tempId: 't1' }, statement: '住在杭州', category: 'location', evidence: [2] })] }), shipping()))).toEqual(['王小明'])
  })

  it('extract.v7+, private chat: a new person whom self addresses is the other sender (X30)', () => {
    // messages: #1 self, #2 阿明, #3 self, #4 阿明
    const chat = (kind: 'private' | 'group' = 'private') => {
      const w = input(4, { chat: { title: '阿明', kind } })
      w.messages[2].body = '好的，小宝，早点睡'
      w.messages[3].body = '知道啦，下周回学校'
      return w
    }
    const output = (termEvidence = [3]) => ({
      newPersons: [{ tempId: 't1', label: '小宝', evidence: [3] }],
      handles: [{ person: { tempId: 't1' }, kind: 'address_term', value: '小宝', evidence: termEvidence }],
      relations: [
        { from: { personId: 1 }, to: { tempId: 't1' }, type: 'parent', label: '妈妈', evidence: [3] },
        { from: { personId: 2 }, to: { tempId: 't1' }, type: 'parent', label: '爸爸', evidence: [3] },
      ],
      claims: [claim({ person: { tempId: 't1' }, statement: '在杭州读大学', category: 'education', evidence: [4] })],
    })
    const r = validateOutput(output(), chat(), { milestoneRules: true })
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.newPersons).toEqual([])
    expect(r.output.handles).toEqual([{ person: { personId: 2 }, kind: 'address_term', value: '小宝', evidence: [3] }])
    expect(r.output.relations.map((x) => [x.from, x.to, x.type])).toEqual([[{ personId: 1 }, { personId: 2 }, 'parent']])
    expect(r.output.claims.map((c) => [c.person, c.statement])).toEqual([[{ personId: 2 }, '在杭州读大学']])

    const kept = (res: ReturnType<typeof validateOutput>) => ('error' in res ? [] : res.output.newPersons.map((p) => p.label))
    // said by the other sender (the listener is self), or in a group chat (the listener can be anyone): stays new
    const other = chat()
    other.messages[3].body = '小宝，你也早点睡'
    expect(kept(validateOutput(output([4]), other, { milestoneRules: true }))).toEqual(['小宝'])
    expect(kept(validateOutput(output(), chat('group'), { milestoneRules: true }))).toEqual(['小宝'])
    // before extract.v7 the rule is off
    expect(kept(validateOutput(output(), chat()))).toEqual(['小宝'])
  })

  it('extract.v7+: types partner `other` relations as spouse and drops items resting only on invisible messages (X30)', () => {
    const w = input(5)
    w.messages[1].kind = 'voice'
    w.messages[1].body = '[语音] 6"'
    const r = validateOutput(
      {
        relations: [
          { from: { personId: 2 }, to: { personId: 1 }, type: 'other', label: '带回家见家长的女朋友', evidence: [3] },
          { from: { personId: 2 }, to: { personId: 1 }, type: 'sibling', label: '弟弟', evidence: [2] },
        ],
        claims: [claim({ statement: '喜欢唱歌', evidence: [2] }), claim({ statement: '在上海做护士', evidence: [2, 4] })],
      },
      w,
      { milestoneRules: true },
    )
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.relations.map((x) => [x.type, x.label])).toEqual([['spouse', '带回家见家长的女朋友']])
    expect(r.output.claims.map((c) => c.statement)).toEqual(['在上海做护士'])
    expect(r.dropped).toEqual([
      { path: 'relations[1]', reason: 'invalid_item' },
      { path: 'claims[0]', reason: 'invalid_item' },
    ])
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

  it('extract.v7+: drops events that have not happened yet (plan words or a date after the last message), strips malformed dates', () => {
    const base = input(5)
    base.messages.forEach((m, i) => (m.sentAt = `2026-05-0${i + 1} 10:00`))
    const ev = (over: Record<string, unknown>) => ({ summary: '阿明和小禾在老家办婚礼', participants: [{ personId: 2 }], evidence: [2], ...over })
    const r = validateOutput(
      {
        events: [
          ev({ happenedAt: '2026-05-03' }),
          ev({ summary: '阿明打算下个月搬到杭州', evidence: [3] }),
          ev({ summary: '阿明的火锅店开业', happenedAt: '2026-06', evidence: [4] }),
          ev({ summary: '全家一起吃饭给周明庆生', happenedAt: '5月初', evidence: [5] }),
          ev({ summary: '周明从原公司离职', happenedAt: '2026-05', evidence: [1] }),
        ],
      },
      base,
      { milestoneRules: true },
    )
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.events.map((e) => [e.summary, e.happenedAt])).toEqual([
      ['阿明和小禾在老家办婚礼', '2026-05-03'],
      ['全家一起吃饭给周明庆生', undefined],
      ['周明从原公司离职', '2026-05'],
    ])
    expect(r.output.events[1]).not.toHaveProperty('happenedAt')
    expect(r.dropped).toEqual([
      { path: 'events[1]', reason: 'momentary' },
      { path: 'events[2]', reason: 'momentary' },
    ])
  })

  it('does not accept self when no self person exists', () => {
    const r = validateOutput({ claims: [claim({ person: { personId: 0 } })] }, input(5, { selfPersonId: 0 }))
    if ('error' in r) throw new Error('unexpected')
    expect(r.output.claims).toEqual([])
  })

  describe('safe defaults for omitted fields (overall critic r3 #1, X31)', () => {
    const privateChat = (): WindowInput => ({
      chat: { title: '周小舟', kind: 'private' },
      selfPersonId: 1,
      known: [
        { personId: 1, label: '我', handles: [{ kind: 'display_private', value: '我' }], claims: [] },
        { personId: 2, label: '周小舟', handles: [{ kind: 'display_private', value: '周小舟' }], claims: [] },
      ],
      messages: [
        { localSeq: 1, sentAt: '2026-08-26 06:46', senderName: '我', senderPersonId: 1, kind: 'text', body: '儿子，啥时候返校' },
        { localSeq: 2, sentAt: '2026-08-26 07:10', senderName: '周小舟', senderPersonId: 2, kind: 'text', body: '下周一返校，高二开学' },
        { localSeq: 3, sentAt: '2026-08-26 07:12', senderName: '周小舟', senderPersonId: 2, kind: 'text', body: '新号码 138 1234 5678，旧的别打了' },
        { localSeq: 4, sentAt: '2026-08-26 07:15', senderName: '我', senderPersonId: 1, kind: 'text', body: '你外婆农历三月初八生日，记得打电话' },
        { localSeq: 5, sentAt: '2026-08-26 07:16', senderName: '周小舟', senderPersonId: 2, kind: 'text', body: '同桌小安9月20号生日' },
      ],
    })
    const noSensitive = (over: Record<string, unknown>) => {
      const { sensitive: _s, ...c } = claim(over)
      return c
    }

    it('keeps a claim without `sensitive` as sensitive=false', () => {
      const r = validateOutput({ claims: [noSensitive({ statement: '在读高二', category: 'education', evidence: [2] })] }, privateChat())
      if ('error' in r) throw new Error('unexpected')
      expect(r.dropped).toEqual([])
      expect(r.output.claims).toEqual([{ person: { personId: 2 }, statement: '在读高二', category: 'education', confidence: 0.9, sensitive: false, evidence: [2] }])
    })

    it('a phone-number statement without `sensitive` is rewritten to 提供过手机号 and flagged by the guard', () => {
      const r = validateOutput({ claims: [noSensitive({ statement: '手机号是13812345678', category: 'other', evidence: [3] })] }, privateChat())
      if ('error' in r) throw new Error('unexpected')
      expect(r.output.claims).toHaveLength(1)
      const g = applySensitiveGuard(r.output)
      expect(g.output.claims).toEqual([expect.objectContaining({ statement: '提供过手机号', sensitive: true })])
      expect(g.rewritten).toBe(1)
    })

    it('reads "true"/"false" strings for `sensitive`; other bad values still drop the item', () => {
      const r = validateOutput({ claims: [claim({ statement: '在读高二', evidence: [2], sensitive: 'false' }), claim({ statement: '喜欢打篮球', evidence: [2], sensitive: 'maybe' })] }, privateChat())
      if ('error' in r) throw new Error('unexpected')
      expect(r.output.claims.map((c) => [c.statement, c.sensitive])).toEqual([['在读高二', false]])
      expect(r.dropped).toEqual([{ path: 'claims[1]', reason: 'invalid_item', fields: ['sensitive:invalid_type'] }])
    })

    it('defaults a missing date calendar from its evidence: lunar only when a message states a lunar date', () => {
      const r = validateOutput(
        {
          newPersons: [{ tempId: 't1', label: '外婆', evidence: [4] }, { tempId: 't2', label: '小安', evidence: [5] }],
          dates: [
            { person: { tempId: 't1' }, kind: 'birthday', month: 3, day: 8, evidence: [4] },
            { person: { tempId: 't2' }, kind: 'birthday', month: 9, day: 20, evidence: [5] },
          ],
        },
        privateChat(),
      )
      if ('error' in r) throw new Error('unexpected')
      expect(r.output.dates.map((d) => d.calendar)).toEqual(['lunar', 'solar'])
    })

    it('gives a new person without evidence the evidence of the items about it', () => {
      const r = validateOutput(
        { newPersons: [{ tempId: 't1', label: '小安' }], claims: [noSensitive({ person: { tempId: 't1' }, statement: '是周小舟的同桌', category: 'other', evidence: ['#5'] })] },
        privateChat(),
      )
      if ('error' in r) throw new Error('unexpected')
      expect(r.output.newPersons).toEqual([{ tempId: 't1', label: '小安', evidence: [5] }])
      expect(r.output.claims).toHaveLength(1)
    })

    it('does not default confidence or category; the drop names the failing fields without values', () => {
      const { confidence: _c, category: _k, ...bare } = claim({ statement: '在读高二', evidence: [2] })
      const r = validateOutput({ claims: [bare, claim({ statement: '在读高二', evidence: [2], mood: '开心' })] }, privateChat())
      if ('error' in r) throw new Error('unexpected')
      expect(r.output.claims).toEqual([])
      expect(r.dropped).toEqual([
        { path: 'claims[0]', reason: 'invalid_item', fields: ['category:invalid_value', 'confidence:invalid_type'] },
        { path: 'claims[1]', reason: 'invalid_item', fields: ['mood:unrecognized_keys'] },
      ])
      expect(JSON.stringify(r.dropped)).not.toContain('开心')
    })
  })
})

// The split (DECISIONS I17, ## extract X40): `validateOutput` is back to exactly what it was for extract.v8. The
// interaction keys are not in `ExtractionOutput` any more, so they fail the window like any other unknown key — and
// that is what makes the extraction call's cassettes replay byte-identically to the run that passed the gates.
describe('validateOutput: no interaction layer', () => {
  it('a `segment` / `loops` / `closes` key fails the window (v8 behaviour, unknown top-level key)', () => {
    for (const key of ['segment', 'loops', 'closes']) {
      const r = validateOutput({ claims: [claim()], [key]: key === 'segment' ? null : [] }, input())
      expect(r, key).toMatchObject({ error: 'validation_failed' })
      if ('error' in r) expect(r.issues[0]).toContain(key)
    }
  })

  it('takes no `interaction` option and produces the six extraction sections only', () => {
    const r = validateOutput({ claims: [claim()] }, input(), { milestoneRules: true })
    if ('error' in r) throw new Error('unexpected')
    expect(Object.keys(r.output).sort()).toEqual(['claims', 'dates', 'events', 'handles', 'newPersons', 'relations'])
  })
})
