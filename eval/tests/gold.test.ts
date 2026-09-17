// Gold schema, validate-gold checks, annotation tools (view/template/freeze) with the stand-in parser.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { annotateView, anchorsFor, checkGold, escapeBody, freezeGoldFiles, goldTemplate, intentDisagreements, validateGoldFile } from '../src/annotate'
import { GoldFileSchema, parseGold, type GoldFile } from '../src/gold-schema'
import { readLock } from '../src/lock'
import { evalPaths } from '../src/paths'
import { baseGold, fakeParser, makeZip, rawMessages, tempRoot } from './helpers'

const ZIP = '聊天记录_20260101_000000.zip'

async function setup(opts: { git?: boolean } = {}) {
  const root = tempRoot()
  const paths = evalPaths(root)
  mkdirSync(paths.fixtures.synthetic, { recursive: true })
  mkdirSync(paths.fixtures.real, { recursive: true })
  const lines = rawMessages(12)
  lines[4] = ['阿青', '2026-09-01 10:04', '第一行\n·第二行以点开头\n\t带制表符']
  const zipBytes = makeZip(lines)
  writeFileSync(path.join(paths.fixtures.synthetic, ZIP), zipBytes)
  if (opts.git) {
    execFileSync('git', ['init', '-q'], { cwd: root })
    writeFileSync(path.join(root, '.gitignore'), 'eval/gold/real/\neval/reports/real/\n.dev/\n')
  }
  const parsed = await fakeParser.parseExportZip(zipBytes, { fileName: ZIP })
  const digest = await fakeParser.messagesDigest(parsed.messages)
  const gold: GoldFile = baseGold({
    zip: ZIP,
    messageCount: parsed.messages.length,
    messagesSha256: digest,
    anchors: anchorsFor(parsed),
    claims: [{ id: 'c1', person: 'a', statement: '在云杉医院当护士', category: 'work', sensitive: false, evidence: [1] }],
    negatives: [{ id: 'n1', kind: 'coordination', evidence: [3], description: '我在门口' }],
  })
  return { root, paths, parsed, digest, gold, zipBytes }
}

describe('gold schema', () => {
  it('accepts a complete file and rejects unknown keys / bad values', () => {
    expect(parseGold(baseGold()).ok).toBe(true)
    const extra = parseGold({ ...baseGold(), surprise: 1 })
    expect(extra.ok).toBe(false)
    const badClaim = parseGold(baseGold({ claims: [{ id: 'c', person: 'a', statement: 'x', category: 'work', sensitive: false, evidence: [] } as never] }))
    expect(badClaim.ok).toBe(false)
    if (!badClaim.ok) expect(badClaim.issues.join('\n')).toMatch(/claims\.0\.(statement|evidence)/)
    expect(GoldFileSchema.safeParse({ ...baseGold(), messagesSha256: 'xyz' }).success).toBe(false)
  })
})

describe('checkGold (validate-gold rules)', () => {
  it('passes a consistent gold file', async () => {
    const { gold, parsed, digest } = await setup()
    expect(checkGold(gold, parsed, digest, ZIP)).toEqual({ errors: [], warnings: [] })
  })

  it('treats a stale anchor as a warning when messageCount and messagesSha256 match (no drift)', async () => {
    const { gold, parsed, digest } = await setup()
    const stale: GoldFile = { ...gold, anchors: [{ idx: 0, fingerprint: 'stale' }, ...gold.anchors.slice(1)] }
    const r = checkGold(stale, parsed, digest, ZIP)
    expect(r.errors).toEqual([])
    expect(r.warnings.join('\n')).toContain('anchor idx 0 fingerprint differs')
  })

  it('reports every rule violation', async () => {
    const { gold, parsed, digest } = await setup()
    const bad: GoldFile = {
      ...gold,
      messageCount: 99,
      anchors: [{ idx: 0, fingerprint: 'nope' }],
      mapping: { chat: { title: '豆豆', kind: 'group' }, senders: [{ senderName: '小满', person: 'me' }, { senderName: '阿青', person: '' }, { senderName: '陌生人', person: 'x' }], self: 'b' },
      persons: [...gold.persons, { key: 'kid', label: '豆豆', inChat: false }],
      claims: [
        { id: 'c1', person: 'ghost', statement: '在云杉医院当护士', category: 'work', sensitive: false, evidence: [500] },
        { id: 'c1', person: 'a', statement: '重复 id', category: 'work', sensitive: false, evidence: [1], supersedes: 'c9' },
      ],
      negatives: [{ id: 'n1', kind: 'sensitive', evidence: [3], description: '手机号' }],
      sensitiveValues: [],
    }
    const { errors } = checkGold(bad, parsed, 'f'.repeat(64), 'other.zip')
    const text = errors.join('\n')
    for (const needle of [
      'zip field',
      'messageCount 99',
      'messagesSha256',
      'anchor idx 0 fingerprint',
      'evidence idx 500',
      'unknown person key "ghost"',
      'duplicate item id c1',
      'supersedes unknown claim c9',
      'sender "阿青" has no person key',
      'mapping sender "陌生人" is not a sender',
      'sender "老周" is not mapped',
      'mapping.self is not the person of any sender',
      'mapping.chat.title equals a gold person label',
      'require non-empty sensitiveValues',
    ]) expect(text).toContain(needle)
    expect(digest).not.toBe('f'.repeat(64))
  })
})

describe('annotation tools', () => {
  it('annotate-view writes the idx/tab view with escaped bodies', async () => {
    const { paths, parsed, digest } = await setup()
    const r = await annotateView({ paths, parser: fakeParser, zipPath: path.join(paths.fixtures.synthetic, ZIP), source: 'synthetic' })
    expect(r).toMatchObject({ messageCount: 12, senders: 3 })
    const lines = readFileSync(r.file, 'utf8').split('\n')
    expect(lines[0]).toBe('# messageCount\t12')
    expect(lines[1]).toBe(`# messagesSha256\t${digest}`)
    expect(lines).toContain(`4\t2026-09-01 10:04\t阿青\ttext\t${escapeBody(parsed.messages[4].body)}`)
    expect(escapeBody('a\nb\tc\\')).toBe('a\\nb\\tc\\\\')
  })

  it('refuses to write real-data views unless git confirms the path is ignored', async () => {
    const { paths, zipBytes } = await setup()
    writeFileSync(path.join(paths.fixtures.real, ZIP), zipBytes)
    await expect(annotateView({ paths, parser: fakeParser, zipPath: path.join(paths.fixtures.real, ZIP), source: 'real' })).rejects.toThrow(/refusing/)
    const withGit = await setup({ git: true })
    writeFileSync(path.join(withGit.paths.fixtures.real, ZIP), withGit.zipBytes)
    const r = await annotateView({ paths: withGit.paths, parser: fakeParser, zipPath: path.join(withGit.paths.fixtures.real, ZIP), source: 'real' })
    expect(r.file).toContain(path.join('.dev', 'annotate', 'real'))
  })

  it('gold-template writes a skeleton with digest/anchors/senders and never overwrites', async () => {
    const { paths, digest } = await setup()
    const zipPath = path.join(paths.fixtures.synthetic, ZIP)
    const { file } = await goldTemplate({ paths, parser: fakeParser, zipPath, source: 'synthetic', now: new Date('2026-09-15T00:00:00Z') })
    expect(path.basename(file)).toBe('聊天记录_20260101_000000.zip.json')
    const t = JSON.parse(readFileSync(file, 'utf8'))
    expect(t).toMatchObject({ goldVersion: 2, zip: ZIP, messageCount: 12, messagesSha256: digest, mapping: { chat: { kind: 'group' }, self: '' }, loops: [], conversations: [] })
    expect(t.anchors.map((a: { idx: number }) => a.idx)).toEqual([0, 11])
    expect(t.mapping.senders.map((s: { person: string }) => s.person)).toEqual(['', '', ''])
    await expect(goldTemplate({ paths, parser: fakeParser, zipPath, source: 'synthetic' })).rejects.toThrow(/overwrite/)
  })

  it('validate-gold reads intent.json only after freeze; freeze-gold appends to LOCK', async () => {
    const { root, paths, gold } = await setup()
    mkdirSync(paths.gold.synthetic, { recursive: true })
    const goldPath = path.join(paths.gold.synthetic, '聊天记录_20260101_000000.json')
    writeFileSync(goldPath, JSON.stringify(gold, null, 2))
    const intent = { planted: [{ id: 'p-work', type: 'claim', idx: [1] }, { id: 'p-date', type: 'date', idx: [7] }, { id: 'p-opt', type: 'handle', idx: [2], optional: true }], negatives: [{ id: 'x-tx', idx: [9] }] }
    writeFileSync(path.join(paths.fixtures.synthetic, '聊天记录_20260101_000000.intent.json'), JSON.stringify(intent))

    const before = await validateGoldFile({ paths, parser: fakeParser, source: 'synthetic', goldPath, lock: readLock(paths.lock), baseline: null, decisions: '' })
    expect(before).toMatchObject({ errors: [], warnings: [], frozen: false })

    const frozen = await freezeGoldFiles({ paths, parser: fakeParser, source: 'synthetic', baseline: null, readDecisions: () => '' })
    expect(frozen.exitCode).toBe(0)
    expect(frozen.results[0].action).toMatch(/appended/)
    expect(readLock(paths.lock).entries['聊天记录_20260101_000000'].versions).toHaveLength(1)

    const after = await validateGoldFile({ paths, parser: fakeParser, source: 'synthetic', goldPath, lock: readLock(paths.lock), baseline: null, decisions: '' })
    expect(after.frozen).toBe(true)
    expect(after.warnings).toEqual(['intent date "p-date" has no gold date with overlapping evidence', 'intent negative "x-tx" has no gold negative with overlapping evidence'])

    writeFileSync(goldPath, JSON.stringify({ ...gold, notes: 'edited' }, null, 2))
    const refused = await freezeGoldFiles({ paths, parser: fakeParser, source: 'synthetic', baseline: null, readDecisions: () => '' })
    expect(refused.exitCode).toBe(1)
    expect(refused.results[0].error).toMatch(/gold-change/)
    expect(existsSync(path.join(root, 'eval/gold/LOCK.json'))).toBe(true)
  })

  it('freeze-gold refuses gold that fails validation', async () => {
    const { paths, gold } = await setup()
    mkdirSync(paths.gold.synthetic, { recursive: true })
    writeFileSync(path.join(paths.gold.synthetic, '聊天记录_20260101_000000.json'), JSON.stringify({ ...gold, messageCount: 1 }))
    const r = await freezeGoldFiles({ paths, parser: fakeParser, source: 'synthetic', baseline: null, readDecisions: () => '' })
    expect(r).toMatchObject({ exitCode: 1, results: [{ action: 'refused' }] })
    expect(existsSync(paths.lock)).toBe(false)
  })

  it('intentDisagreements ignores optional planted items', () => {
    expect(intentDisagreements(baseGold(), { planted: [{ id: 'o', type: 'claim', idx: [1], optional: true }] })).toEqual([])
  })
})
