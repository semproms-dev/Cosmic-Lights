import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

export const Route = createRootRoute({
  component: RootLayout,
})

/**
 * Application shell rendered around every route.
 */
function RootLayout() {
  return (
    <>
      <Outlet />
      <TanStackRouterDevtools />
    </>
  )
}
