import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PREFERENCES,
  STORAGE_KEY,
  loadPreferences,
  savePreferences,
} from './preferences'
import type { Preferences } from './preferences'

const CUSTOM: Preferences = {
  panelPosition: 'left',
  fontSize: 18,
  language: 'es',
  helper: false,
  menuPosition: 'right',
  navBarPosition: 'bottom',
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('loadPreferences', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES)
  })

  it('round-trips a saved value', () => {
    savePreferences(CUSTOM)
    expect(loadPreferences()).toEqual(CUSTOM)
  })

  it('falls back to the defaults on malformed JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES)
  })

  it('falls back per field: an out-of-range font size resets only that field', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...CUSTOM, fontSize: 999 }),
    )
    expect(loadPreferences()).toEqual({
      ...CUSTOM,
      fontSize: DEFAULT_PREFERENCES.fontSize,
    })
  })

  it('falls back per field: an unknown language resets only that field', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...CUSTOM, language: 'xx' }),
    )
    expect(loadPreferences()).toEqual({
      ...CUSTOM,
      language: DEFAULT_PREFERENCES.language,
    })
  })

  it('fills in missing fields with their defaults', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ language: 'de' }))
    expect(loadPreferences()).toEqual({ ...DEFAULT_PREFERENCES, language: 'de' })
  })
})

describe('savePreferences', () => {
  it('writes the serialized preferences under the storage key', () => {
    savePreferences(CUSTOM)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(
      CUSTOM,
    )
  })

  it('swallows storage errors instead of throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => savePreferences(CUSTOM)).not.toThrow()
  })
})
