// Annotation tools (ARCHITECTURE §7.6): annotate-view, gold-template, validate-gold, freeze-gold.
// Real-source outputs go only to gitignored paths and print numbers only.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ParsedExport, ParserApi } from './entries'
import { GOLD_VERSION, INTERACTION_GOLD_VERSION, parseGold, type GoldFile, type GoldLock } from './gold-schema'
import { freezeGold, goldStatus, lockKeyFor, readLock, sha256Hex } from './lock'
import { goldPathFor, SOURCES, zipBase, zipBaseOfGoldFile, type EvalPaths, type Source } from './paths'
import { isGitIgnored } from './report'

export function escapeBody(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')
}

export async function loadExport(parser: ParserApi, zipPath: string): Promise<{ parsed: ParsedExport; bytes: Uint8Array; digest: string }> {
  const bytes = new Uint8Array(readFileSync(zipPath))
  const parsed = await parser.parseExportZip(bytes, { fileName: path.basename(zipPath) })
  return { parsed, bytes, digest: await parser.messagesDigest(parsed.messages) }
}

function assertIgnoredForReal(paths: EvalPaths, source: Source, file: string) {
  if (source === 'real' && isGitIgnored(paths.root, file) !== true) throw new Error('refusing to write real-data file to a path git does not ignore')
}

// ---------------------------------------------------------------- annotate-view
export async function annotateView(args: { paths: EvalPaths; parser: ParserApi; zipPath: string; source: Source }): Promise<{ file: string; messageCount: number; senders: number }> {
  const { parsed, digest } = await loadExport(args.parser, args.zipPath)
  const file = path.join(args.paths.annotate[args.source], `${zipBase(args.zipPath)}.txt`)
  assertIgnoredForReal(args.paths, args.source, file)
  const lines = [
    `# messageCount\t${parsed.messages.length}`,
    `# messagesSha256\t${digest}`,
    `# parserVersion\t${args.parser.PARSER_VERSION}`,
    `# zip\t${path.basename(args.zipPath)}`,
    `# senders (name\tcount)`,
    ...parsed.senders.map((s) => `#\t${s.name}\t${s.count}`),
    `# columns: idx\tsentAt\tsenderName\tkind\tbody (\\n = newline inside body)`,
    ...parsed.messages.map((m) => `${m.idx}\t${m.sentAt}\t${m.senderName}\t${m.kind}\t${escapeBody(m.body)}`),
  ]
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, lines.join('\n') + '\n')
  return { file, messageCount: parsed.messages.length, senders: parsed.senders.length }
}

// ---------------------------------------------------------------- gold-template
export function anchorsFor(parsed: ParsedExport): { idx: number; fingerprint: string }[] {
  const n = parsed.messages.length
  const idx = new Set<number>()
  for (let i = 0; i < n; i += 50) idx.add(i)
  if (n) idx.add(n - 1)
  return [...idx].sort((a, b) => a - b).map((i) => ({ idx: i, fingerprint: parsed.messages[i].fingerprint }))
}

export async function goldTemplate(args: { paths: EvalPaths; parser: ParserApi; zipPath: string; source: Source; now?: Date }): Promise<{ file: string }> {
  const { parsed, digest } = await loadExport(args.parser, args.zipPath)
  const file = goldPathFor(args.paths, args.source, args.zipPath)
  if (existsSync(file)) throw new Error(`refusing to overwrite existing gold file ${path.relative(args.paths.root, file)}`)
  assertIgnoredForReal(args.paths, args.source, file)
  const skeleton = {
    goldVersion: GOLD_VERSION,
    zip: path.basename(args.zipPath),
    annotator: 'annotator',
    annotatedAt: (args.now ?? new Date()).toISOString(),
    notes: '',
    parserVersion: args.parser.PARSER_VERSION,
    messageCount: parsed.messages.length,
    messagesSha256: digest,
    anchors: anchorsFor(parsed),
    mapping: { chat: { title: '', kind: parsed.senders.length > 2 ? 'group' : 'private' }, senders: parsed.senders.map((s) => ({ senderName: s.name, person: '' })), self: '' },
    persons: [],
    handles: [],
    relations: [],
    claims: [],
    dates: [],
    events: [],
    loops: [],
    conversations: [],
    negatives: [],
    sensitiveValues: [],
  }
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(skeleton, null, 2) + '\n')
  return { file }
}

// ---------------------------------------------------------------- validate-gold
/** Pure checks against the parsed export (no filesystem). */
export function checkGold(gold: GoldFile, parsed: ParsedExport, digest: string, zipFile: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const n = parsed.messages.length
  if (gold.zip !== path.basename(zipFile)) errors.push(`zip field "${gold.zip}" does not match file name`)
  if (gold.messageCount !== n) errors.push(`messageCount ${gold.messageCount} != parsed ${n}`)
  if (gold.messagesSha256 !== digest) errors.push('messagesSha256 does not match the current parser output')
  // §7.2/§7.6: anchors only locate drift. Compare them as errors only when messageCount or messagesSha256 differ; a
  // fingerprint-only parser change (e.g. wechat-export@2 media names) leaves a stale anchor as a warning.
  const drift = gold.messageCount !== n || gold.messagesSha256 !== digest
  for (const a of gold.anchors) {
    if (a.idx >= n) (drift ? errors : warnings).push(`anchor idx ${a.idx} out of range`)
    else if (parsed.messages[a.idx].fingerprint !== a.fingerprint) (drift ? errors : warnings).push(`anchor idx ${a.idx} fingerprint differs`)
  }
  const ids = new Map<string, number>()
  const persons = new Set<string>()
  for (const p of gold.persons) {
    if (persons.has(p.key)) errors.push(`duplicate person key ${p.key}`)
    persons.add(p.key)
  }
  const needPerson = (key: string, where: string) => {
    if (!persons.has(key)) errors.push(`${where}: unknown person key "${key}"`)
  }
  const evidence = (ev: number[], where: string) => {
    for (const e of ev) if (e < 0 || e >= n) errors.push(`${where}: evidence idx ${e} out of range [0, ${n})`)
  }
  const item = (id: string, where: string, ev: number[]) => {
    ids.set(id, (ids.get(id) ?? 0) + 1)
    evidence(ev, `${where} ${id}`)
  }
  for (const h of gold.handles) {
    item(h.id, 'handle', h.evidence)
    needPerson(h.person, `handle ${h.id}`)
  }
  for (const r of gold.relations) {
    item(r.id, 'relation', r.evidence)
    needPerson(r.from, `relation ${r.id}`)
    needPerson(r.to, `relation ${r.id}`)
  }
  const claimIds = new Set(gold.claims.map((c) => c.id))
  for (const c of gold.claims) {
    item(c.id, 'claim', c.evidence)
    needPerson(c.person, `claim ${c.id}`)
    if (c.supersedes && !claimIds.has(c.supersedes)) errors.push(`claim ${c.id}: supersedes unknown claim ${c.supersedes}`)
  }
  for (const d of gold.dates) {
    item(d.id, 'date', d.evidence)
    needPerson(d.person, `date ${d.id}`)
  }
  for (const e of gold.events) {
    item(e.id, 'event', e.evidence)
    for (const p of e.participants) needPerson(p, `event ${e.id}`)
  }
  // ---- interaction (goldVersion 2, additive). Absent arrays are "not annotated", not "none" (§7.2).
  if ((gold.loops !== undefined || gold.conversations !== undefined) && gold.goldVersion < INTERACTION_GOLD_VERSION) {
    errors.push(`goldVersion ${gold.goldVersion} cannot carry loops/conversations; use goldVersion ${INTERACTION_GOLD_VERSION}`)
  }
  for (const l of gold.loops ?? []) {
    item(l.id, 'loop', l.evidence)
    needPerson(l.person, `loop ${l.id}`)
    if (l.closedBy !== undefined) {
      if (l.closedBy < 0 || l.closedBy >= n) errors.push(`loop ${l.id}: closedBy idx ${l.closedBy} out of range [0, ${n})`)
      else if (l.closedBy <= Math.min(...l.evidence)) errors.push(`loop ${l.id}: closedBy idx ${l.closedBy} is not after the message that opens it`)
    }
    if (l.closedReason !== undefined && l.closedBy === undefined) errors.push(`loop ${l.id}: closedReason without closedBy`)
  }
  for (const c of gold.conversations ?? []) {
    ids.set(c.id, (ids.get(c.id) ?? 0) + 1)
    if (c.startIdx >= n) errors.push(`conversation ${c.id}: startIdx ${c.startIdx} out of range [0, ${n})`)
    if (c.endIdx >= n) errors.push(`conversation ${c.id}: endIdx ${c.endIdx} out of range [0, ${n})`)
    if (c.endIdx < c.startIdx) errors.push(`conversation ${c.id}: endIdx ${c.endIdx} < startIdx ${c.startIdx}`)
  }
  const convs = [...(gold.conversations ?? [])].sort((a, b) => a.startIdx - b.startIdx)
  for (let i = 1; i < convs.length; i++) {
    if (convs[i].startIdx <= convs[i - 1].endIdx) errors.push(`conversation ${convs[i].id} overlaps ${convs[i - 1].id} (a message belongs to one conversation)`)
  }
  for (const x of gold.negatives) item(x.id, 'negative', x.evidence)
  for (const [id, count] of ids) if (count > 1) errors.push(`duplicate item id ${id}`)

  const parsedSenders = new Set(parsed.senders.map((s) => s.name))
  const mapped = new Set<string>()
  for (const s of gold.mapping.senders) {
    if (mapped.has(s.senderName)) errors.push(`sender "${s.senderName}" mapped twice`)
    mapped.add(s.senderName)
    if (!parsedSenders.has(s.senderName)) errors.push(`mapping sender "${s.senderName}" is not a sender in the export`)
    if (!s.person) errors.push(`sender "${s.senderName}" has no person key`)
    else needPerson(s.person, `mapping sender "${s.senderName}"`)
  }
  for (const name of parsedSenders) if (!mapped.has(name)) errors.push(`sender "${name}" is not mapped`)
  if (!gold.mapping.self) errors.push('mapping.self is empty')
  else if (!gold.mapping.senders.some((s) => s.person === gold.mapping.self)) errors.push('mapping.self is not the person of any sender')
  const senderNames = new Set(gold.mapping.senders.map((s) => s.senderName))
  if (gold.persons.some((p) => p.label === gold.mapping.chat.title) && !senderNames.has(gold.mapping.chat.title)) {
    errors.push('mapping.chat.title equals a gold person label that is not a sender name (gold knowledge would leak into the prompt)')
  }
  if (gold.negatives.some((x) => x.kind === 'sensitive') && gold.sensitiveValues.length === 0) errors.push('negatives of kind "sensitive" require non-empty sensitiveValues')
  if (gold.parserVersion !== undefined && parsed.parserVersion !== gold.parserVersion) warnings.push(`annotated with parser ${gold.parserVersion}, current ${parsed.parserVersion}`)
  return { errors, warnings }
}

/** Synthetic only, after freeze: planted intent items with no overlapping gold item (warnings, ids only). */
export function intentDisagreements(gold: GoldFile, intent: { planted?: { id: string; type: string; idx: number[]; optional?: boolean }[]; negatives?: { id: string; idx: number[] }[] }): string[] {
  const out: string[] = []
  const overlaps = (a: number[], b: number[]) => a.some((x) => b.includes(x))
  const byType: Record<string, { evidence: number[] }[]> = { claim: gold.claims, handle: gold.handles, relation: gold.relations, date: gold.dates, event: gold.events }
  // Interaction: a gold file that does not carry the array was not annotated for that type at all, so a planted
  // loop/conversation is not a disagreement — the same "absent ≠ empty" rule the metrics use (§7.4).
  if (gold.loops) byType.loop = gold.loops
  if (gold.conversations) byType.conversation = gold.conversations.map((c) => ({ evidence: [c.startIdx, c.endIdx] }))
  for (const p of intent.planted ?? []) {
    if (p.optional) continue
    if (p.type === 'loop' && !gold.loops) continue
    if (p.type === 'conversation' && !gold.conversations) continue
    if (p.type === 'conversation') {
      const spans = gold.conversations ?? []
      const lo = Math.min(...p.idx)
      const hi = Math.max(...p.idx)
      if (!spans.some((c) => c.startIdx <= hi && c.endIdx >= lo)) out.push(`intent conversation "${p.id}" has no gold conversation overlapping idx ${lo}..${hi}`)
      continue
    }
    if (!(byType[p.type] ?? []).some((g) => overlaps(g.evidence, p.idx))) out.push(`intent ${p.type} "${p.id}" has no gold ${p.type} with overlapping evidence`)
  }
  for (const x of intent.negatives ?? []) {
    if (!gold.negatives.some((g) => overlaps(g.evidence, x.idx))) out.push(`intent negative "${x.id}" has no gold negative with overlapping evidence`)
  }
  return out
}

export interface GoldValidation {
  source: Source
  zip: string
  goldPath: string
  errors: string[]
  warnings: string[]
  frozen: boolean
  lockKey: string | null
}

export function listGoldFiles(paths: EvalPaths, source?: Source, zip?: string): { source: Source; goldPath: string }[] {
  const out: { source: Source; goldPath: string }[] = []
  for (const s of source ? [source] : SOURCES) {
    const dir = paths.gold[s]
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      if (zip && zipBase(zip) !== zipBaseOfGoldFile(f)) continue
      out.push({ source: s, goldPath: path.join(dir, f) })
    }
  }
  return out
}

export async function validateGoldFile(args: { paths: EvalPaths; parser: ParserApi; source: Source; goldPath: string; lock: GoldLock; baseline: GoldLock | null; decisions: string }): Promise<GoldValidation> {
  const rel = path.relative(args.paths.root, args.goldPath)
  const res: GoldValidation = { source: args.source, zip: `${zipBaseOfGoldFile(args.goldPath)}.zip`, goldPath: rel, errors: [], warnings: [], frozen: false, lockKey: null }
  const goldBytes = new Uint8Array(readFileSync(args.goldPath))
  let json: unknown
  try {
    json = JSON.parse(Buffer.from(goldBytes).toString('utf8'))
  } catch (e) {
    res.errors.push(`invalid JSON: ${(e as Error).message}`)
    return res
  }
  const parsedGold = parseGold(json)
  if (!parsedGold.ok) {
    res.errors.push(...parsedGold.issues)
    return res
  }
  const gold = parsedGold.gold
  res.zip = gold.zip
  const zipPath = path.join(args.paths.fixtures[args.source], gold.zip)
  if (!existsSync(zipPath)) {
    res.errors.push(`zip ${gold.zip} not found in fixtures/${args.source}`)
    return res
  }
  if (zipBase(gold.zip) !== zipBaseOfGoldFile(args.goldPath)) res.errors.push('gold file name does not match its zip field')
  const { parsed, bytes, digest } = await loadExport(args.parser, zipPath)
  const checked = checkGold(gold, parsed, digest, zipPath)
  res.errors.push(...checked.errors)
  res.warnings.push(...checked.warnings)
  res.lockKey = lockKeyFor(args.source, gold.zip, sha256Hex(bytes))
  const st = goldStatus({ lock: args.lock, baseline: args.baseline, decisions: args.decisions, lockKey: res.lockKey, goldSha256: sha256Hex(goldBytes) })
  res.frozen = st.frozen
  if (args.source === 'synthetic' && st.frozen) {
    const intentPath = path.join(args.paths.fixtures.synthetic, `${zipBase(gold.zip)}.intent.json`)
    if (existsSync(intentPath)) res.warnings.push(...intentDisagreements(gold, JSON.parse(readFileSync(intentPath, 'utf8'))))
  }
  if (args.source === 'real') res.zip = res.lockKey
  return res
}

export async function freezeGoldFiles(args: { paths: EvalPaths; parser: ParserApi; source: Source; zip?: string; baseline: GoldLock | null; readDecisions: () => string; now?: () => Date }): Promise<{ results: { zip: string; action: string; error?: string }[]; exitCode: number }> {
  const results: { zip: string; action: string; error?: string }[] = []
  let exitCode = 0
  for (const { source, goldPath } of listGoldFiles(args.paths, args.source, args.zip)) {
    const v = await validateGoldFile({ paths: args.paths, parser: args.parser, source, goldPath, lock: readLock(args.paths.lock), baseline: args.baseline, decisions: args.readDecisions() })
    const label = v.lockKey ?? (source === 'real' ? 'real-?' : v.zip)
    if (v.errors.length) {
      results.push({ zip: label, action: 'refused', error: `validate-gold has ${v.errors.length} error(s)` })
      exitCode = 1
      continue
    }
    const gold = JSON.parse(readFileSync(goldPath, 'utf8')) as GoldFile
    try {
      const r = freezeGold({
        lockPath: args.paths.lock,
        decisions: args.readDecisions(),
        baseline: args.baseline,
        lockKey: v.lockKey!,
        source,
        goldSha256: sha256Hex(new Uint8Array(readFileSync(goldPath))),
        messagesSha256: gold.messagesSha256,
        now: args.now?.().toISOString(),
      })
      results.push({ zip: label, action: `${r.action} (versions ${r.versions})` })
    } catch (e) {
      results.push({ zip: label, action: 'refused', error: (e as Error).message })
      exitCode = 1
    }
  }
  if (!results.length) {
    results.push({ zip: '-', action: 'none', error: 'no gold files found' })
    exitCode = 1
  }
  return { results, exitCode }
}
