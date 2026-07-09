import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { CropRegion } from './image'

// Controlled editor store: the test drives `image`/`cropRegion`/`cropRatio` and
// spies on `setCrop` to observe when the overlay commits. `vi.hoisted` keeps the
// refs available to the (hoisted) `vi.mock` factory.
const { setCrop, state } = vi.hoisted(() => ({
  setCrop: vi.fn(),
  state: {
    image: null as { width: number; height: number } | null,
    cropRegion: null as CropRegion | null,
    cropRatio: 'Original',
  },
}))

vi.mock('./editorContext', () => ({
  useEditor: () => ({
    image: state.image,
    cropRegion: state.cropRegion,
    cropRatio: state.cropRatio,
    setCrop,
  }),
}))

import { CropOverlay } from './CropOverlay'

describe('CropOverlay', () => {
  beforeEach(() => {
    setCrop.mockClear()
    state.image = { width: 4000, height: 3000 }
    state.cropRegion = null
    state.cropRatio = 'Original'
  })

  it('keeps the crop local while editing, then applies it when it unmounts (leaving the tool)', () => {
    state.cropRegion = { x: 100, y: 200, width: 1600, height: 900 }
    const { unmount } = render(<CropOverlay onDone={() => {}} />)

    // The draft stays local while the tool is open — nothing committed yet.
    expect(setCrop).not.toHaveBeenCalled()

    // Leaving the tool (unmount) commits the pending crop to the store.
    unmount()
    expect(setCrop).toHaveBeenCalledTimes(1)
    expect(setCrop).toHaveBeenCalledWith({ x: 100, y: 200, width: 1600, height: 900 })
  })

  it('does not touch the store on unmount when there is no crop to apply', () => {
    state.cropRegion = null
    const { unmount } = render(<CropOverlay onDone={() => {}} />)

    unmount()
    expect(setCrop).not.toHaveBeenCalled()
  })
})
