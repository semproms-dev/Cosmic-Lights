import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PreferencesProvider } from './PreferencesProvider'
import { MAX_FONT_SIZE, MIN_FONT_SIZE, usePreferences } from './preferences'

afterEach(() => {
  localStorage.clear()
})

describe('PreferencesProvider setFontSize', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PreferencesProvider>{children}</PreferencesProvider>
  )

  it('clamps the font size to the allowed range', () => {
    const { result } = renderHook(() => usePreferences(), { wrapper })

    act(() => result.current.setFontSize(999))
    expect(result.current.preferences.fontSize).toBe(MAX_FONT_SIZE)

    act(() => result.current.setFontSize(1))
    expect(result.current.preferences.fontSize).toBe(MIN_FONT_SIZE)
  })

  it('rounds fractional font sizes', () => {
    const { result } = renderHook(() => usePreferences(), { wrapper })

    act(() => result.current.setFontSize(16.6))
    expect(result.current.preferences.fontSize).toBe(17)
  })
})
