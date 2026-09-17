import { describe, expect, it } from 'vitest'
import { activeIndexOf, hotkeyAction, isTypingTarget, moveIndex, type KeyLike } from './keys'

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods })

describe('search overlay keyboard', () => {
  it('⌘K and Ctrl K toggle from anywhere, including text fields', () => {
    expect(hotkeyAction(key('k', { metaKey: true }), null)).toBe('toggle')
    expect(hotkeyAction(key('K', { ctrlKey: true }), { tagName: 'INPUT', type: 'text' })).toBe('toggle')
    expect(hotkeyAction(key('k', { ctrlKey: true, altKey: true }), null)).toBeNull()
    expect(hotkeyAction(key('k'), null)).toBeNull()
  })

  it('"/" opens only when not typing', () => {
    expect(hotkeyAction(key('/'), { tagName: 'BODY' })).toBe('open')
    expect(hotkeyAction(key('/'), { tagName: 'BUTTON' })).toBe('open')
    expect(hotkeyAction(key('/'), { tagName: 'INPUT', type: 'checkbox' })).toBe('open')
    expect(hotkeyAction(key('/'), { tagName: 'INPUT' })).toBeNull()
    expect(hotkeyAction(key('/'), { tagName: 'INPUT', type: 'search' })).toBeNull()
    expect(hotkeyAction(key('/'), { tagName: 'TEXTAREA' })).toBeNull()
    expect(hotkeyAction(key('/'), { tagName: 'DIV', isContentEditable: true })).toBeNull()
    expect(hotkeyAction(key('/', { metaKey: true }), { tagName: 'BODY' })).toBeNull()
  })

  it('ignores keys during IME composition', () => {
    expect(hotkeyAction(key('k', { metaKey: true, isComposing: true }), null)).toBeNull()
    expect(hotkeyAction(key('/', { keyCode: 229 }), { tagName: 'BODY' })).toBeNull()
  })

  it('classifies typing targets', () => {
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget({ tagName: 'select' })).toBe(true)
    expect(isTypingTarget({ tagName: 'INPUT', type: 'range' })).toBe(false)
  })

  it('↑/↓ wrap around and start from the ends', () => {
    expect(moveIndex(0, 1, 3)).toBe(1)
    expect(moveIndex(2, 1, 3)).toBe(0)
    expect(moveIndex(0, -1, 3)).toBe(2)
    expect(moveIndex(-1, 1, 3)).toBe(0)
    expect(moveIndex(-1, -1, 3)).toBe(2)
    expect(moveIndex(5, 1, 3)).toBe(0)
    expect(moveIndex(0, 1, 0)).toBe(-1)
  })

  it('active key falls back to the first item', () => {
    expect(activeIndexOf(['a', 'b'], 'b')).toBe(1)
    expect(activeIndexOf(['a', 'b'], 'gone')).toBe(0)
    expect(activeIndexOf(['a', 'b'], null)).toBe(0)
    expect(activeIndexOf([], 'a')).toBe(-1)
  })
})
