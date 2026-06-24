import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { render, screen } from '../test/render'
import { routeTree } from '../routeTree.gen'

describe('home route', () => {
  it('mounts the navigation on the index route', async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })

    render(<RouterProvider router={router} />)

    expect(
      await screen.findByRole('button', { name: 'File' }),
    ).toBeInTheDocument()
  })
})
