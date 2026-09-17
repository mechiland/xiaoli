import { readManifest } from '~/scripts/seed/manifest'
import type { SeedAccountName } from '~/scripts/seed/accounts'
import type { AccountName, ScenarioSeed, SeedRef } from './types'

type Group = 'persons' | 'imports' | 'chats' | 'claims' | 'segments' | 'loops'

const GROUP_BY_PREFIX: Record<string, Group> = { person: 'persons', import: 'imports', chat: 'chats', claim: 'claims', segment: 'segments', loop: 'loops' }

function isSeedAccount(a: AccountName): a is SeedAccountName {
  return a === 'seed' || a === 'seed2' || a === 'empty'
}

/** `['person:long-profile', 'import:delete-me']` all present for the account? */
export function manifestHasTags(root: string, account: AccountName, tags: string[]): boolean {
  if (!isSeedAccount(account)) return true
  const entry = readManifest(root)?.accounts[account]
  if (!entry) return false
  return tags.every((t) => {
    const [prefix, tag] = t.split(':')
    const group = GROUP_BY_PREFIX[prefix]
    return Boolean(group && tag && entry[group]?.[tag])
  })
}

export function createSeedAccessor(root: string, account: AccountName): ScenarioSeed {
  const lookup = async (group: Group, tag: string): Promise<SeedRef> => {
    if (!isSeedAccount(account)) throw new Error(`seed tags are only available for seed accounts (scenario account is "${account}")`)
    const manifest = readManifest(root)
    const entry = manifest?.accounts[account]
    if (!entry) throw new Error(`no seed manifest for account "${account}" — run \`pnpm seed\``)
    const ref = entry[group]?.[tag]
    if (!ref) throw new Error(`seed tag "${tag}" not found in ${group} for account "${account}" (known: ${Object.keys(entry[group] ?? {}).join(', ') || 'none'})`)
    return ref
  }
  return {
    person: (tag) => lookup('persons', tag),
    import: (tag) => lookup('imports', tag),
    chat: (tag) => lookup('chats', tag),
    claim: (tag) => lookup('claims', tag),
    segment: (tag) => lookup('segments', tag),
    loop: (tag) => lookup('loops', tag),
    manifest: async () => (isSeedAccount(account) ? (readManifest(root)?.accounts[account] ?? null) : null),
  }
}
