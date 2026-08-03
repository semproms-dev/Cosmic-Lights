import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../test/render';

// Only `image` matters here: it gates whether the slider is editable.
const { state } = vi.hoisted(() => ({
  state: { image: null as { width: number; height: number } | null },
}))

vi.mock('../../../editor/editorContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../editor/editorContext')>()
  return {
    ...actual,
    useEditor: () => ({ image: state.image }),
  }
})

import { RotationComponent } from './RotationComponent'

describe('RotationComponent', () => {
  beforeEach(() => {
    state.image = null
  })

  it('renders the rotation slider starting at 0', () => {
    render(<RotationComponent />)

    expect(screen.getByText('Rotation')).toBeInTheDocument()
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuemin', '0')
    expect(slider).toHaveAttribute('aria-valuemax', '100')
    expect(slider).toHaveAttribute('aria-valuenow', '0')
  })

  it('disables the slider while no image is loaded', () => {
    render(<RotationComponent />)

    expect(screen.getByRole('slider')).toHaveAttribute('aria-disabled', 'true')
  })

  it('lets the user change the angle once an image is loaded', () => {
    state.image = { width: 100, height: 100 }
    render(<RotationComponent />)

    const slider = screen.getByRole('slider')
    fireEvent.keyDown(slider, { key: 'ArrowRight' })

    expect(slider).toHaveAttribute('aria-valuenow', '1')
  })
})
