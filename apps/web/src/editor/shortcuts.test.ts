import { describe, expect, it } from 'vitest'
import { SHORTCUTS, formatCombo } from './shortcuts'

describe('SHORTCUTS registry', () => {
  it('has a unique action id per entry', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has a unique combo per entry (no two shortcuts share a key)', () => {
    const combos = SHORTCUTS.map((s) => s.combo)
    expect(new Set(combos).size).toBe(combos.length)
  })

  it('gives every entry a label, category and icon', () => {
    for (const s of SHORTCUTS) {
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.category).toBeTruthy()
      expect(s.icon).toBeTruthy()
    }
  })
})

describe('formatCombo', () => {
  // jsdom reports a non-mac platform, so the non-mac labels are used here.
  it('expands modifiers and uppercases the final key', () => {
    expect(formatCombo('mod+shift+Z')).toEqual(['Ctrl', 'Shift', 'Z'])
    expect(formatCombo('mod+O')).toEqual(['Ctrl', 'O'])
  })

  it('preserves the modifier order of the combo', () => {
    expect(formatCombo('shift+mod+Z')).toEqual(['Shift', 'Ctrl', 'Z'])
  })

  it('leaves single non-modifier keys as-is', () => {
    expect(formatCombo('1')).toEqual(['1'])
    expect(formatCombo('?')).toEqual(['?'])
  })
})
