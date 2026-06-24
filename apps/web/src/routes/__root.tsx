import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { EditorProvider } from '../editor/EditorProvider'

export const Route = createRootRoute({
  component: RootLayout,
})

/**
 * Application shell rendered around every route.
 */
function RootLayout() {
  return (
    <>
      <EditorProvider>
        <Outlet />
      </EditorProvider>
      <TanStackRouterDevtools />
    </>
  )
}
