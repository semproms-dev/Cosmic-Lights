import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { MantineProvider } from '@mantine/core'
import '@mantine/core/styles.css'
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
        <RouterProvider router={router} />
      </MantineProvider>
    </StrictMode>,
  )
}
