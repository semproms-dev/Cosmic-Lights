import { render as testingLibraryRender } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import type { ReactNode } from 'react'

/**
 * Renders a component wrapped in the providers the app relies on (Mantine).
 * Use this instead of React Testing Library's `render` for any component that
 * uses Mantine components or hooks.
 */
export function render(ui: ReactNode) {
  return testingLibraryRender(ui, {
    wrapper: ({ children }) => (
      <MantineProvider defaultColorScheme="dark">{children}</MantineProvider>
    ),
  })
}

// Re-export everything else from RTL so tests import from a single module.
export * from '@testing-library/react'
