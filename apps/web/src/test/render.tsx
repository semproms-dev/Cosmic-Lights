import { render as testingLibraryRender } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import type { ReactNode } from 'react'
import { EditorProvider } from '../editor/EditorProvider'

/**
 * Renders a component wrapped in the providers the app relies on (Mantine and
 * the editor store). Use this instead of React Testing Library's `render` for
 * any component that uses Mantine components/hooks or the editor store.
 */
export function render(ui: ReactNode) {
  return testingLibraryRender(ui, {
    wrapper: ({ children }) => (
      <MantineProvider defaultColorScheme="dark">
        <EditorProvider>{children}</EditorProvider>
      </MantineProvider>
    ),
  })
}

// Re-export everything else from RTL so tests import from a single module.
export * from '@testing-library/react'
