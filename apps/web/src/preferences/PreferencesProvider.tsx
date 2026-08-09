import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import i18n from '../i18n'
import {
  DEFAULT_PREFERENCES,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  loadPreferences,
  savePreferences,
  PreferencesContext,
} from './preferences'
import type {
  Appearance,
  FocusRing,
  HighContrast,
  Language,
  MenuPosition,
  NavBarPosition,
  PanelPosition,
  Preferences,
  PreferencesStore,
} from './preferences'
import type { ThemePresetId } from './themePresets'

interface PreferencesProviderProps {
  children: ReactNode
  /** Overrides the initial values, mainly for tests. Defaults to storage. */
  initialPreferences?: Preferences
}

/**
 * Provides the persisted {@link PreferencesStore} to the component tree. Seeds
 * from localStorage (or `initialPreferences` when given) and writes every
 * change straight back to storage so preferences survive reloads.
 */
export function PreferencesProvider({
  children,
  initialPreferences,
}: PreferencesProviderProps) {
  const [preferences, setPreferences] = useState<Preferences>(
    () => initialPreferences ?? loadPreferences(),
  )

  const update = useCallback((patch: Partial<Preferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...patch }
      savePreferences(next)
      return next
    })
  }, [])

  useEffect(() => {
    void i18n.changeLanguage(preferences.language)
  }, [preferences.language])

  // Accessibility state lives on the document root so plain CSS can react to
  // it. Mantine sizes everything in rem resolved against the html font-size,
  // so the base font preference must also live here to scale the UI. A layout
  // effect applies everything before first paint, avoiding a flash at the
  // browser defaults on load.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.style.fontSize = `${preferences.fontSize}px`
    root.toggleAttribute('data-reduce-motion', preferences.reduceMotion)
    root.setAttribute('data-high-contrast', preferences.highContrast)
    root.setAttribute('data-focus-ring', preferences.focusRing)
    root.setAttribute('data-theme', preferences.theme)
  }, [
    preferences.fontSize,
    preferences.reduceMotion,
    preferences.highContrast,
    preferences.focusRing,
    preferences.theme,
  ])

  const setPanelPosition = useCallback(
    (position: PanelPosition) => update({ panelPosition: position }),
    [update],
  )

  const setFontSize = useCallback(
    (size: number) =>
      update({
        fontSize: Math.min(
          MAX_FONT_SIZE,
          Math.max(MIN_FONT_SIZE, Math.round(size)),
        ),
      }),
    [update],
  )

  const setLanguage = useCallback(
    (language: Language) => {
      update({ language })
      void i18n.changeLanguage(language)
    },
    [update],
  )

  const setHelpers = useCallback(
    (helper: boolean) => update({ helper }),
    [update],
  )

  const setMenuPosition = useCallback(
    (menuPosition: MenuPosition) => update({ menuPosition }),
    [update],
  )

  const setNavBarPosition = useCallback(
    (navBarPosition: NavBarPosition) => update({ navBarPosition }),
    [update],
  )

  const setReduceMotion = useCallback(
    (reduceMotion: boolean) => update({ reduceMotion }),
    [update],
  )

  const setHighContrast = useCallback(
    (highContrast: HighContrast) => update({ highContrast }),
    [update],
  )

  const setFocusRing = useCallback(
    (focusRing: FocusRing) => update({ focusRing }),
    [update],
  )

  const setAppearance = useCallback(
    (appearance: Appearance) => update({ appearance }),
    [update],
  )

  const setTheme = useCallback(
    (theme: ThemePresetId) => update({ theme }),
    [update],
  )

  const store = useMemo<PreferencesStore>(
    () => ({
      preferences,
      setPanelPosition,
      setFontSize,
      setLanguage,
      setHelpers,
      setMenuPosition,
      setNavBarPosition,
      setReduceMotion,
      setHighContrast,
      setFocusRing,
      setAppearance,
      setTheme,
    }),
    [
      preferences,
      setPanelPosition,
      setFontSize,
      setLanguage,
      setHelpers,
      setMenuPosition,
      setNavBarPosition,
      setReduceMotion,
      setHighContrast,
      setFocusRing,
      setAppearance,
      setTheme,
    ],
  )

  return (
    <PreferencesContext value={store}>{children}</PreferencesContext>
  )
}

export { DEFAULT_PREFERENCES }
