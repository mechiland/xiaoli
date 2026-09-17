// Public entry `@/verify/lib` (ARCHITECTURE §8). Owner: verify-seed.
import type { ScenarioDefinition } from './types'

export type * from './types'
export { SCENARIO_ALIASES, median, parseServerTiming, sanitizeUrl } from './log-utils'
export { SEED_ACCOUNTS, SEED_PASSWORD } from '@/scripts/seed/accounts'

const ID = /^[a-z0-9_][a-z0-9_-]*(\/[a-z0-9_][a-z0-9_-]*)+$/

/** Declares a scenario. File: verify/scenarios/<dir>/<name>.scenario.ts with id '<dir>/<name>'. */
export function defineScenario(def: ScenarioDefinition): ScenarioDefinition {
  if (!ID.test(def.id)) throw new Error(`scenario id "${def.id}" must look like "<dir>/<name>" (lowercase, digits, - and _)`)
  if (typeof def.run !== 'function') throw new Error(`scenario ${def.id}: run() is required`)
  for (const w of def.widths ?? []) if (!Number.isInteger(w) || w < 320) throw new Error(`scenario ${def.id}: invalid width ${w}`)
  return def
}
