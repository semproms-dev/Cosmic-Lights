import { render as testingLibraryRender } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { ModalsProvider } from '@mantine/modals'
import { ContextMenuProvider } from 'mantine-contextmenu'
import type { ReactNode } from 'react'
import { EditorProvider } from '../editor/EditorProvider'
import { PreferencesProvider } from '../preferences/PreferencesProvider'
import '../i18n'

/**
 * Renders a component wrapped in the providers the app relies on (Mantine,
 * Mantine modals and the editor store). Use this instead of React Testing
 * Library's `render` for any component that uses Mantine components/hooks,
 * modals or the editor store.
 */
export function render(ui: ReactNode) {
  return testingLibraryRender(ui, {
    wrapper: ({ children }) => (
      <MantineProvider defaultColorScheme="dark">
        <PreferencesProvider>
          <ModalsProvider>
            <ContextMenuProvider>
              <EditorProvider>{children}</EditorProvider>
            </ContextMenuProvider>
          </ModalsProvider>
        </PreferencesProvider>
      </MantineProvider>
    ),
  })
}

// Re-export everything else from RTL so tests import from a single module.
export * from '@testing-library/react'
