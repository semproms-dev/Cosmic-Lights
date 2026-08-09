import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PreferencesProvider } from './PreferencesProvider'
import {
  DEFAULT_PREFERENCES,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  usePreferences,
} from './preferences'

afterEach(() => {
  localStorage.clear()
  document.documentElement.style.fontSize = ''
  document.documentElement.removeAttribute('data-reduce-motion')
  document.documentElement.removeAttribute('data-high-contrast')
  document.documentElement.removeAttribute('data-focus-ring')
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

  it('applies the font size to the document root on mount', () => {
    renderHook(() => usePreferences(), { wrapper })

    expect(document.documentElement.style.fontSize).toBe(
      `${DEFAULT_PREFERENCES.fontSize}px`,
    )
  })

  it('scales the document root when the font size changes', () => {
    const { result } = renderHook(() => usePreferences(), { wrapper })

    act(() => result.current.setFontSize(20))

    expect(document.documentElement.style.fontSize).toBe('20px')
  })
})

describe('PreferencesProvider accessibility attributes', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PreferencesProvider>{children}</PreferencesProvider>
  )

  it('mirrors the defaults onto the document root on mount', () => {
    renderHook(() => usePreferences(), { wrapper })

    expect(document.documentElement).not.toHaveAttribute('data-reduce-motion')
    expect(document.documentElement).toHaveAttribute(
      'data-high-contrast',
      DEFAULT_PREFERENCES.highContrast,
    )
    expect(document.documentElement).toHaveAttribute(
      'data-focus-ring',
      DEFAULT_PREFERENCES.focusRing,
    )
  })

  it('toggles the accessibility attributes when the preferences change', () => {
    const { result } = renderHook(() => usePreferences(), { wrapper })

    act(() => result.current.setReduceMotion(true))
    act(() => result.current.setHighContrast('off'))
    act(() => result.current.setFocusRing('never'))

    expect(document.documentElement).toHaveAttribute('data-reduce-motion')
    expect(document.documentElement).toHaveAttribute('data-high-contrast', 'off')
    expect(document.documentElement).toHaveAttribute('data-focus-ring', 'never')
  })
})
