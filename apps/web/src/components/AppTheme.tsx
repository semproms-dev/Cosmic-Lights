import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { createTheme, MantineProvider } from '@mantine/core'
import { usePreferences } from '../preferences/preferences'

interface AppThemeProps {
  children: ReactNode
}

/**
 * Mantine theme derived from the persisted preferences. The focus-ring mode is
 * a theme property rather than plain CSS, so the theme is rebuilt whenever the
 * preference changes.
 */
export function AppTheme({ children }: AppThemeProps) {
  const { preferences } = usePreferences()
  const theme = useMemo(
    () => createTheme({ focusRing: preferences.focusRing }),
    [preferences.focusRing],
  )
  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      {children}
    </MantineProvider>
  )
}
