import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import './i18n'
import { MantineProvider } from '@mantine/core'
import { ModalsProvider } from '@mantine/modals'
import { ContextMenuProvider } from 'mantine-contextmenu'
import { PreferencesProvider } from './preferences/PreferencesProvider'
import '@mantine/core/styles.css'
import 'mantine-contextmenu/styles.css'
import './index.css'
import { routeTree } from './routeTree.gen'
import { logger } from './logger'

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  logger.error('Root element #root not found in the DOM')
} else {
  logger.info('Mounting CosmicLights application')
  createRoot(rootElement).render(
    <StrictMode>
      <MantineProvider defaultColorScheme="dark">
        <PreferencesProvider>
          <ModalsProvider>
            <ContextMenuProvider>
              <RouterProvider router={router} />
            </ContextMenuProvider>
          </ModalsProvider>
        </PreferencesProvider>
      </MantineProvider>
    </StrictMode>,
  )
}
