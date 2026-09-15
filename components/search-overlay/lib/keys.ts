// Pure keyboard helpers shared by the search overlay and PersonPicker (unit-tested without a DOM).

export interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  isComposing?: boolean
  keyCode?: number
}

export interface TargetLike {
  tagName?: string
  isContentEditable?: boolean
  type?: string
  closest?: (selector: string) => unknown
}

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'])

/** Focus is somewhere the user types: text inputs, textarea, select, contenteditable. */
export function isTypingTarget(t: TargetLike | null | undefined): boolean {
  if (!t) return false
  const tag = (t.tagName ?? '').toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((t.type ?? 'text').toLowerCase())
  if (t.isContentEditable) return true
  return false
}

/** IME composition in progress (Chinese input): Enter/arrows belong to the IME, not to us. */
export function isComposingKey(e: KeyLike): boolean {
  return Boolean(e.isComposing) || e.keyCode === 229
}

/**
 * Global overlay hotkeys (SPEC §9.8): ⌘K / Ctrl K toggles from anywhere; "/" opens only when focus is not in a text field.
 */
export function hotkeyAction(e: KeyLike, target: TargetLike | null | undefined): 'toggle' | 'open' | null {
  if (isComposingKey(e)) return null
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') return 'toggle'
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(target)) return 'open'
  return null
}

/** Next active index for ↑/↓ with wrap-around; -1 when the list is empty. */
export function moveIndex(current: number, delta: 1 | -1, length: number): number {
  if (length <= 0) return -1
  if (current < 0 || current >= length) return delta > 0 ? 0 : length - 1
  return (current + delta + length) % length
}

/** Index of the active key in a list, defaulting to the first item. */
export function activeIndexOf(keys: string[], activeKey: string | null): number {
  if (!keys.length) return -1
  const i = activeKey == null ? -1 : keys.indexOf(activeKey)
  return i < 0 ? 0 : i
}
