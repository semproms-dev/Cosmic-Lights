import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../test/render';

// Controlled editor store: the test drives `image` and spies on the orientation
// actions, so each click can be asserted to turn/flip and checkpoint one step.
const { rotateCcw, rotateCw, flipH, flipV, commit, state } = vi.hoisted(() => ({
  rotateCcw: vi.fn(),
  rotateCw: vi.fn(),
  flipH: vi.fn(),
  flipV: vi.fn(),
  commit: vi.fn(),
  state: { image: null as { width: number; height: number } | null },
}))

vi.mock('../../../editor/editorContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../editor/editorContext')>()
  return {
    ...actual,
    useEditor: () => ({
      image: state.image,
      rotateCcw,
      rotateCw,
      flipH,
      flipV,
      commit,
    }),
  }
})

import { OrientationComponent } from './OrientationComponent'

describe('OrientationComponent', () => {
  beforeEach(() => {
    rotateCcw.mockClear()
    rotateCw.mockClear()
    flipH.mockClear()
    flipV.mockClear()
    commit.mockClear()
    state.image = null
  })

  it('renders a button per orientation action', () => {
    render(<OrientationComponent />)

    expect(screen.getByText('Orientation')).toBeInTheDocument()
    expect(screen.getByText('Rotate and flip')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(4)
  })

  it('disables every button while no image is loaded', () => {
    render(<OrientationComponent />)

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
  })

  it('turns and flips on click, checkpointing each action as one undo step', () => {
    state.image = { width: 100, height: 100 }
    render(<OrientationComponent />)

    const [rotateLeft, rotateRight, flipRight, flipDown] = screen.getAllByRole('button')

    fireEvent.click(rotateLeft)
    expect(rotateCcw).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledTimes(1)

    fireEvent.click(rotateRight)
    expect(rotateCw).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledTimes(2)

    fireEvent.click(flipRight)
    expect(flipH).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledTimes(3)

    fireEvent.click(flipDown)
    expect(flipV).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledTimes(4)
  })
})
