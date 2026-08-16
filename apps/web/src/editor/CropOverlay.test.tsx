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
    cropOrientation: 'landscape' as 'landscape' | 'portrait',
    view: { scale: 1, offsetX: 0, offsetY: 0 },
  },
}))

vi.mock('./editorContext', () => ({
  useEditor: () => ({
    image: state.image,
    cropRegion: state.cropRegion,
    cropRatio: state.cropRatio,
    cropOrientation: state.cropOrientation,
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
    state.cropOrientation = 'landscape'
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

  it('re-fits the draft to the swapped ratio when the orientation changes', () => {
    // A 4000×3000 draft under 4:3 landscape, then the swap to portrait: the
    // effective aspect becomes 3:4, and the draft shrinks toward its center.
    state.cropRatio = '4:3'
    state.cropOrientation = 'landscape'
    state.cropRegion = { x: 0, y: 0, width: 4000, height: 3000 }
    const { rerender, unmount } = render(<CropOverlay onDone={() => {}} />)

    state.cropOrientation = 'portrait'
    rerender(<CropOverlay onDone={() => {}} />)

    // Leaving the tool commits the re-fitted draft: 2250×3000 = 3:4, centered.
    unmount()
    expect(setCrop).toHaveBeenCalledWith({ x: 875, y: 0, width: 2250, height: 3000 })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('creates a centered crop box of the selected ratio when none exists yet', () => {
    // Enter the tool with no crop; picking 16:9 must produce a visible overlay —
    // the largest 16:9 box that fits the 4000×3000 image, centered (4000×2250).
    state.cropRatio = 'Original'
    state.cropOrientation = 'landscape'
    state.cropRegion = null
    const { rerender, unmount } = render(<CropOverlay onDone={() => {}} />)

    state.cropRatio = '16:9'
    rerender(<CropOverlay onDone={() => {}} />)

    unmount()
    expect(setCrop).toHaveBeenCalledWith({ x: 0, y: 375, width: 4000, height: 2250 })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('does not keep shrinking the draft on repeated orientation flips', () => {
    // 4000×3000 landscape 4:3 → portrait (2250×3000, area lost to the bounds),
    // then back to landscape: the flip keeps that area (3000×2250) instead of
    // constraining the already-fitted portrait box down to 2250×1687.5.
    state.cropRatio = '4:3'
    state.cropOrientation = 'landscape'
    state.cropRegion = { x: 0, y: 0, width: 4000, height: 3000 }
    const { rerender, unmount } = render(<CropOverlay onDone={() => {}} />)

    state.cropOrientation = 'portrait'
    rerender(<CropOverlay onDone={() => {}} />)

    state.cropOrientation = 'landscape'
    rerender(<CropOverlay onDone={() => {}} />)

    unmount()
    expect(setCrop).toHaveBeenCalledWith({ x: 500, y: 375, width: 3000, height: 2250 })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('leaves the draft alone when the ratio has no orientation (1:1)', () => {
    state.cropRatio = '1:1'
    state.cropOrientation = 'landscape'
    state.cropRegion = { x: 100, y: 100, width: 2000, height: 2000 }
    const { rerender, unmount } = render(<CropOverlay onDone={() => {}} />)

    state.cropOrientation = 'portrait'
    rerender(<CropOverlay onDone={() => {}} />)

    unmount()
    expect(setCrop).toHaveBeenCalledWith({ x: 100, y: 100, width: 2000, height: 2000 })
  })
})
