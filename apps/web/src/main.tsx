import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import './i18n'
import { ModalsProvider } from '@mantine/modals'
import { ContextMenuProvider } from 'mantine-contextmenu'
import { PreferencesProvider } from './preferences/PreferencesProvider'
import { AppTheme } from './components/AppTheme'
import '@mantine/core/styles.css'
import 'mantine-contextmenu/styles.css'
import './index.css'
import { routeTree } from './routeTree.gen'
import { logger } from './logger'

const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL.replace(/\/$/, ''),
})

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
      <PreferencesProvider>
        <AppTheme>
          <ModalsProvider>
            <ContextMenuProvider>
              <RouterProvider router={router} />
            </ContextMenuProvider>
          </ModalsProvider>
        </AppTheme>
      </PreferencesProvider>
    </StrictMode>,
  )
}
