import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../test/render';

const { state, setRotationAngle, commit } = vi.hoisted(() => ({
  state: {
    image: null as { width: number; height: number } | null,
    angle: 0,
  },
  setRotationAngle: vi.fn(),
  commit: vi.fn(),
}))

vi.mock('../../../editor/editorContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../editor/editorContext')>()
  return {
    ...actual,
    useEditor: () => ({ image: state.image, angle: state.angle, setRotationAngle, commit }),
  }
})

import { RotationComponent } from './RotationComponent'

describe('RotationComponent', () => {
  beforeEach(() => {
    state.image = null
    state.angle = 0
    setRotationAngle.mockClear()
    commit.mockClear()
  })

  it('renders a rotation slider bound to the store angle', () => {
    state.image = { width: 100, height: 100 }
    state.angle = 22.5

    render(<RotationComponent />)

    expect(screen.getByText('Rotation')).toBeInTheDocument()
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuemin', '-45')
    expect(slider).toHaveAttribute('aria-valuemax', '45')
    expect(slider).toHaveAttribute('aria-valuenow', '22.5')
  })

  it('disables the slider while no image is loaded', () => {
    render(<RotationComponent />)

    expect(screen.getByRole('slider')).toHaveAttribute('aria-disabled', 'true')
  })

  it('changes the angle live while dragging and checkpoints on release', async () => {
    state.image = { width: 100, height: 100 }

    // The drag math reads the element rect: give the track a real size so a
    // pointer at x=75 lands at 75% of the range, i.e. angle 0° → 22.5°.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 20,
      right: 100,
      bottom: 20,
    } as unknown as DOMRect)

    render(<RotationComponent />)

    const track = screen.getByRole('slider').parentElement!.parentElement!
    fireEvent.mouseDown(track, { clientX: 75, clientY: 10 })
    // useMove reports the position on the next animation frame.
    await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(setRotationAngle).toHaveBeenCalledWith(22.5)
    expect(commit).not.toHaveBeenCalled()

    fireEvent.mouseUp(document, { clientX: 75, clientY: 10 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('writes and checkpoints once when the keyboard changes the angle', () => {
    state.image = { width: 100, height: 100 }

    render(<RotationComponent />)

    // Mantine maps arrow keys to onChange (live) + onChangeEnd (checkpoint),
    // so one keypress is one undo step covering the whole interaction.
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' })

    expect(setRotationAngle).toHaveBeenCalledWith(0.1)
    expect(commit).toHaveBeenCalledWith(0.1)
    expect(commit).toHaveBeenCalledTimes(1)
  })
})
