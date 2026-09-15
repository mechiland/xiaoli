// Gold freeze / change rule (ARCHITECTURE §7.6 required tests).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GoldLock } from '../src/gold-schema'
import { emptyLock, FreezeError, freezeGold, goldChangeLines, goldStatus, isAppendOf, lockKeyFor, readLock, serializeLock } from '../src/lock'
import { gatesPassed, sourceGates } from '../src/metrics'
import { tempRoot } from './helpers'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const MSG = 'c'.repeat(64)
const KEY = '聊天记录_20260405_223012'
const T0 = '2026-09-15T01:00:00.000Z'
const T1 = '2026-09-16T01:00:00.000Z'

const decisionsWith = (line: string, section = 'annotator') => `# DECISIONS\n\n## extract\n\nsomething\n\n## ${section}\n\n- ${line}\n\n## integrator\n\nx\n`
const twoVersions = (): GoldLock => ({
  lockVersion: 2,
  entries: { [KEY]: { source: 'synthetic', versions: [{ goldSha256: SHA_A, messagesSha256: MSG, frozenAt: T0 }, { goldSha256: SHA_B, messagesSha256: MSG, frozenAt: T1 }] } },
})
const gatesFor = (st: ReturnType<typeof goldStatus>) =>
  sourceGates({ source: 'synthetic', evaluated: true, metrics: null, zipsWithGold: 1, scoredZips: 0, problemZips: 0, gold: [st], judgeFallback: false, p95WindowMs: null, p95Enforced: false })

describe('lock keys and change lines', () => {
  it('synthetic key = basename, real key = hash only', () => {
    expect(lockKeyFor('synthetic', `fixtures/synthetic/${KEY}.zip`, SHA_A)).toBe(KEY)
    expect(lockKeyFor('real', 'fixtures/real/whatever.zip', '0123456789abcdef'.repeat(4))).toBe('real-0123456789abcdef')
  })
  it('only lines under ## annotator count', () => {
    expect(goldChangeLines(decisionsWith(`gold-change: ${KEY} ${SHA_B.slice(0, 12)} fixed a wrong evidence idx`)).has(`${KEY} ${SHA_B.slice(0, 12)}`)).toBe(true)
    expect(goldChangeLines(decisionsWith(`gold-change: ${KEY} ${SHA_B.slice(0, 12)} sneaky`, 'extract')).size).toBe(0)
  })
})

describe('freezeGold', () => {
  it('happy path: first freeze, change with DECISIONS line, noop on same sha', () => {
    const root = tempRoot()
    const lockPath = path.join(root, 'eval/gold/LOCK.json')
    expect(freezeGold({ lockPath, decisions: '', baseline: null, lockKey: KEY, source: 'synthetic', goldSha256: SHA_A, messagesSha256: MSG, now: T0 })).toEqual({ action: 'appended', versions: 1 })
    expect(freezeGold({ lockPath, decisions: '', baseline: null, lockKey: KEY, source: 'synthetic', goldSha256: SHA_A, messagesSha256: MSG, now: T1 })).toEqual({ action: 'noop', versions: 1 })
    const committed = readLock(lockPath)
    const st1 = goldStatus({ lock: committed, baseline: committed, decisions: '', lockKey: KEY, goldSha256: SHA_A })
    expect(st1).toMatchObject({ frozen: true, changeRecorded: null, lockAppendOnly: true, lockVersions: 1 })

    const decisions = decisionsWith(`gold-change: ${KEY} ${SHA_B.slice(0, 12)} evidence idx off by one`)
    expect(freezeGold({ lockPath, decisions, baseline: committed, lockKey: KEY, source: 'synthetic', goldSha256: SHA_B, messagesSha256: MSG, now: T1 })).toEqual({ action: 'appended', versions: 2 })
    const lock = readLock(lockPath)
    const st2 = goldStatus({ lock, baseline: committed, decisions, lockKey: KEY, goldSha256: SHA_B })
    expect(st2).toMatchObject({ frozen: true, changeRecorded: true, lockAppendOnly: true, lockVersions: 2 })
    expect(gatesPassed(gatesFor(st2).filter((g) => g.name.startsWith('gold.')))).toBe(true)
  })

  it('refuses a second version without the DECISIONS line', () => {
    const root = tempRoot()
    const lockPath = path.join(root, 'LOCK.json')
    freezeGold({ lockPath, decisions: '', baseline: null, lockKey: KEY, source: 'synthetic', goldSha256: SHA_A, messagesSha256: MSG, now: T0 })
    expect(() => freezeGold({ lockPath, decisions: '# DECISIONS\n', baseline: null, lockKey: KEY, source: 'synthetic', goldSha256: SHA_B, messagesSha256: MSG })).toThrow(FreezeError)
    expect(readLock(lockPath).entries[KEY].versions).toHaveLength(1)
  })

  it('refuses to write when the working LOCK already dropped a committed version', () => {
    const root = tempRoot()
    const lockPath = path.join(root, 'LOCK.json')
    const collapsed: GoldLock = { lockVersion: 2, entries: { [KEY]: { source: 'synthetic', versions: [twoVersions().entries[KEY].versions[1]] } } }
    writeFileSync(lockPath, serializeLock(collapsed))
    const before = readFileSync(lockPath, 'utf8')
    expect(() => freezeGold({ lockPath, decisions: '', baseline: twoVersions(), lockKey: 'other', source: 'synthetic', goldSha256: SHA_A, messagesSha256: MSG })).toThrow(/not an append/)
    expect(readFileSync(lockPath, 'utf8')).toBe(before)
  })

  it('never removes versions: result is always a strict append', () => {
    const root = tempRoot()
    const lockPath = path.join(root, 'LOCK.json')
    writeFileSync(lockPath, serializeLock(twoVersions()))
    freezeGold({ lockPath, decisions: '', baseline: twoVersions(), lockKey: 'another', source: 'real', goldSha256: SHA_A, messagesSha256: MSG, now: T1 })
    const after = readLock(lockPath)
    expect(isAppendOf(twoVersions(), after)).toBe(true)
    expect(Object.keys(after.entries)).toEqual(['another', KEY])
  })
})

describe('eval-side detection of rewritten gold', () => {
  it('gold and LOCK both rewritten with an appended version but no DECISIONS line → changeRecorded false, gates fail', () => {
    const lock = twoVersions()
    const st = goldStatus({ lock, baseline: null, decisions: decisionsWith('nothing relevant'), lockKey: KEY, goldSha256: SHA_B })
    expect(st).toMatchObject({ frozen: true, changeRecorded: false, lockAppendOnly: null })
    const gates = gatesFor(st)
    expect(gates.find((g) => g.name === 'gold.changeRecorded')!.passed).toBe(false)
    expect(gatesPassed(gates)).toBe(false)
  })

  it('history collapsed to one version vs a committed baseline with two → lockAppendOnly false, gates fail', () => {
    const collapsed: GoldLock = { lockVersion: 2, entries: { [KEY]: { source: 'synthetic', versions: [{ goldSha256: SHA_B, messagesSha256: MSG, frozenAt: T1 }] } } }
    const st = goldStatus({ lock: collapsed, baseline: twoVersions(), decisions: '', lockKey: KEY, goldSha256: SHA_B })
    expect(st).toMatchObject({ frozen: true, changeRecorded: null, lockAppendOnly: false })
    expect(gatesFor(st).find((g) => g.name === 'gold.lockAppendOnly')!.passed).toBe(false)
  })

  it('gold edited after freeze without re-freezing → frozen false', () => {
    const lock = twoVersions()
    const st = goldStatus({ lock, baseline: lock, decisions: '', lockKey: KEY, goldSha256: 'd'.repeat(64) })
    expect(st.frozen).toBe(false)
    expect(gatesFor(st).find((g) => g.name === 'gold.frozen')!.passed).toBe(false)
  })

  it('missing LOCK reads as empty', () => {
    expect(readLock(path.join(tempRoot(), 'nope.json'))).toEqual(emptyLock())
    expect(existsSync(path.join(tempRoot(), 'nope.json'))).toBe(false)
  })
})
