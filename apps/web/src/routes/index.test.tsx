import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { render, screen } from '../test/render'
import { routeTree } from '../routeTree.gen'

function renderHome() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(<RouterProvider router={router} />)
}

describe('home route', () => {
  it('mounts the navigation on the index route', async () => {
    renderHome()

    expect(
      await screen.findByRole('button', { name: 'File' }),
    ).toBeInTheDocument()
  })

  it('opens the Adjustments panel by default', async () => {
    renderHome()

    expect(
      await screen.findByRole('slider', { name: 'Exposure' }),
    ).toBeInTheDocument()
  })

  it('toggles the active tool panel closed when reselected', async () => {
    const user = userEvent.setup()
    renderHome()

    await user.click(await screen.findByRole('button', { name: 'Adjustments' }))

    expect(
      screen.queryByRole('slider', { name: 'Exposure' }),
    ).not.toBeInTheDocument()
  })

  it('switches to another tool panel when a different tool is selected', async () => {
    const user = userEvent.setup()
    renderHome()

    await user.click(await screen.findByRole('button', { name: 'Export' }))

    expect(
      await screen.findByRole('slider', { name: 'Quality' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('slider', { name: 'Exposure' }),
    ).not.toBeInTheDocument()
  })
})
