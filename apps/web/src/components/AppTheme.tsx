import { useLayoutEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  createTheme,
  MantineProvider,
  useMantineColorScheme,
} from '@mantine/core'
import { usePreferences } from '../preferences/preferences'
import { getThemePreset } from '../preferences/themePresets'

interface AppThemeProps {
  children: ReactNode
}

/**
 * Drives Mantine's colour scheme from the persisted appearance preference. It
 * sits inside the MantineProvider so `auto` resolves against the OS setting and
 * updates `data-mantine-color-scheme`, which the app's own CSS keys off.
 */
function ColorSchemeSync() {
  const { preferences } = usePreferences()
  const { setColorScheme } = useMantineColorScheme()

  useLayoutEffect(() => {
    setColorScheme(preferences.appearance)
  }, [preferences.appearance, setColorScheme])

  return null
}

/**
 * Mantine theme derived from the persisted preferences. The focus-ring mode and
 * the theme preset's primary color are theme properties rather than plain CSS,
 * so the theme is rebuilt whenever either changes.
 */
export function AppTheme({ children }: AppThemeProps) {
  const { preferences } = usePreferences()
  const preset = getThemePreset(preferences.theme)
  const theme = useMemo(
    () =>
      createTheme({
        primaryColor: preset.primaryColor,
        focusRing: preferences.focusRing,
      }),
    [preset, preferences.focusRing],
  )
  return (
    <MantineProvider theme={theme} defaultColorScheme={preferences.appearance}>
      <ColorSchemeSync />
      {children}
    </MantineProvider>
  )
}
