import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import i18n from '../i18n'
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  PreferencesContext,
} from './preferences'
import type {
  Language,
  PanelPosition,
  Preferences,
  PreferencesStore,
} from './preferences'

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

  const setPanelPosition = useCallback(
    (position: PanelPosition) => update({ panelPosition: position }),
    [update],
  )

  const setFontSize = useCallback(
    (size: number) => update({ fontSize: Math.round(size) }),
    [update],
  )

  const setLanguage = useCallback(
    (language: Language) => {
      update({ language })
      void i18n.changeLanguage(language)
    },
    [update],
  )

  useEffect(() => {
    void i18n.changeLanguage(preferences.language)
  }, [preferences.language])

  const setHelpers = useCallback(
    (helper: boolean) => update({ helper }),
    [update],
  )

  const store = useMemo<PreferencesStore>(
    () => ({ preferences, setPanelPosition, setFontSize, setLanguage, setHelpers }),
    [preferences, setPanelPosition, setFontSize, setLanguage, setHelpers],
  )

  return (
    <PreferencesContext value={store}>{children}</PreferencesContext>
  )
}

export { DEFAULT_PREFERENCES }
