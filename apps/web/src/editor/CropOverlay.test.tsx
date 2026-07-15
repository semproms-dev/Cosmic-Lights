import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { CropRegion } from './image'

// Controlled editor store: the test drives `image`/`cropRegion`/`cropRatio` and
// spies on `setCrop`/`commit` to observe when the overlay applies and checkpoints
// the crop. `vi.hoisted` keeps the refs available to the (hoisted) `vi.mock` factory.
const { setCrop, commit, setView, state } = vi.hoisted(() => ({
  setCrop: vi.fn(),
  commit: vi.fn(),
  setView: vi.fn(),
  state: {
    image: null as { width: number; height: number } | null,
    cropRegion: null as CropRegion | null,
    cropRatio: 'Original',
    view: { scale: 1, offsetX: 0, offsetY: 0 },
  },
}))

vi.mock('./editorContext', () => ({
  useEditor: () => ({
    image: state.image,
    cropRegion: state.cropRegion,
    cropRatio: state.cropRatio,
    view: state.view,
    setCrop,
    commit,
    setView,
  }),
}))

import { CropOverlay } from './CropOverlay'

describe('CropOverlay', () => {
  beforeEach(() => {
    setCrop.mockClear()
    commit.mockClear()
    setView.mockClear()
    state.image = { width: 4000, height: 3000 }
    state.cropRegion = null
    state.cropRatio = 'Original'
    state.view = { scale: 1, offsetX: 0, offsetY: 0 }
  })

  it('fits the image on entering the tool', () => {
    // The crop frame spans the whole image: under zoom its edges fall outside
    // the viewport, leaving nothing on screen to grab — and the overlay covers
    // the canvas that listens for wheel/drag, so the zoom cannot be undone.
    state.view = { scale: 2.5, offsetX: 0.3, offsetY: 0 }

    render(<CropOverlay onDone={() => {}} />)

    expect(setView).toHaveBeenCalledWith({ scale: 1, offsetX: 0, offsetY: 0 })
  })

  it('keeps the crop local while editing, then applies it when it unmounts (leaving the tool)', () => {
    state.cropRegion = { x: 100, y: 200, width: 1600, height: 900 }
    const { unmount } = render(<CropOverlay onDone={() => {}} />)

    // The draft stays local while the tool is open — nothing committed yet.
    expect(setCrop).not.toHaveBeenCalled()

    // Leaving the tool (unmount) commits the pending crop to the store and
    // checkpoints it as one undo step.
    unmount()
    expect(setCrop).toHaveBeenCalledTimes(1)
    expect(setCrop).toHaveBeenCalledWith({ x: 100, y: 200, width: 1600, height: 900 })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('does not touch the store on unmount when there is no crop to apply', () => {
    state.cropRegion = null
    const { unmount } = render(<CropOverlay onDone={() => {}} />)

    unmount()
    expect(setCrop).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })
})
