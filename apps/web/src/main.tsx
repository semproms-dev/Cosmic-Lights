import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { MantineProvider } from '@mantine/core'
import '@mantine/core/styles.css'
import './index.css'
import { routeTree } from './routeTree.gen'

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="dark">
      <RouterProvider router={router} />
    </MantineProvider>
  </StrictMode>,
)
