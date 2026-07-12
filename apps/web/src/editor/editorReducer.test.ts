import { describe, expect, it } from 'vitest'
import { buildDefaultCurves } from './curves'
import type { CropRegion, LoadedImage } from './image'
import {
  buildInitialAdjustments,
  editorReducer,
  type EditorStoreState,
} from './editorReducer'

/** Builds a fresh store state, letting a test override individual slices. */
const createState = (overrides: Partial<EditorStoreState> = {}): EditorStoreState => ({
  adjustments: buildInitialAdjustments(),
  curves: buildDefaultCurves(),
  image: null,
  imageStatus: 'idle',
  imageDirty: false,
  cropRegion: null,
  cropRatio: 'Original',
  resetDialogOpen: false,
  ...overrides,
})

/** A decoded-image stand-in; the reducer never touches the bitmap/metadata fields. */
const fakeImage = {
  bitmap: {},
  width: 100,
  height: 80,
  fileName: 'test.arw',
  metadata: {},
} as unknown as LoadedImage

/** A sample crop region in image pixels. */
const fakeRegion: CropRegion = { x: 10, y: 20, width: 40, height: 30 }

describe('editorReducer — image slice', () => {
  it('SET_IMAGE_STATUS updates the status and leaves the image untouched', () => {
    const state = createState()

    const next = editorReducer(state, { type: 'SET_IMAGE_STATUS', status: 'loading' })

    expect(next.imageStatus).toBe('loading')
    expect(next.image).toBeNull()
  })

  it('SET_IMAGE stores the image, forces the status back to idle and clears the dirty flag', () => {
    const state = createState({ imageStatus: 'loading', imageDirty: true })

    const next = editorReducer(state, { type: 'SET_IMAGE', image: fakeImage })

    expect(next.image).toBe(fakeImage)
    expect(next.imageStatus).toBe('idle')
    expect(next.imageDirty).toBe(false)
  })

  it('SET marks the image dirty; RESET_ADJUSTEMENTS clears it again', () => {
    const dirtied = editorReducer(createState(), { type: 'SET', key: 'exposure', value: 1 })
    expect(dirtied.imageDirty).toBe(true)

    const reset = editorReducer(dirtied, { type: 'RESET_ADJUSTEMENTS' })
    expect(reset.imageDirty).toBe(false)
  })

  it('CLEAR_IMAGE drops the image', () => {
    const state = createState({ image: fakeImage })

    const next = editorReducer(state, { type: 'CLEAR_IMAGE' })

    expect(next.image).toBeNull()
  })

  it('does not mutate the previous state', () => {
    const state = createState()

    editorReducer(state, { type: 'SET_IMAGE', image: fakeImage })

    expect(state.image).toBeNull()
    expect(state.imageStatus).toBe('idle')
  })

  it('SET_IMAGE resets adjustments and curves to their defaults', () => {
    const state = createState({
      adjustments: { ...buildInitialAdjustments(), exposure: 5 },
      curves: {
        ...buildDefaultCurves(),
        rgb: [
          { x: 0, y: 0 },
          { x: 128, y: 200 },
          { x: 255, y: 255 },
        ],
      },
    })

    const next = editorReducer(state, { type: 'SET_IMAGE', image: fakeImage })

    expect(next.adjustments).toEqual(buildInitialAdjustments())
    expect(next.curves).toEqual(buildDefaultCurves())
  })
})

describe('editorReducer — crop slice', () => {
  it('SET_CROP stores the region and marks the image dirty', () => {
    const state = createState()

    const next = editorReducer(state, { type: 'SET_CROP', cropRegion: fakeRegion })

    expect(next.cropRegion).toEqual(fakeRegion)
    expect(next.imageDirty).toBe(true)
  })

  it('CLEAR_CROP resets the crop region to null', () => {
    const state = createState({ cropRegion: fakeRegion })

    const next = editorReducer(state, { type: 'CLEAR_CROP' })

    expect(next.cropRegion).toBeNull()
  })

  it('SET_IMAGE discards any active crop', () => {
    const state = createState({ cropRegion: fakeRegion })

    const next = editorReducer(state, { type: 'SET_IMAGE', image: fakeImage })

    expect(next.cropRegion).toBeNull()
  })

  it('does not mutate the previous state on SET_CROP', () => {
    const state = createState()

    editorReducer(state, { type: 'SET_CROP', cropRegion: fakeRegion })

    expect(state.cropRegion).toBeNull()
  })

  it('SET_CROP_RATIO stores the label without marking the image dirty', () => {
    const state = createState()

    const next = editorReducer(state, { type: 'SET_CROP_RATIO', ratio: '16:9' })

    expect(next.cropRatio).toBe('16:9')
    expect(next.imageDirty).toBe(false)
  })

  it('SET_IMAGE resets the crop ratio to Original', () => {
    const state = createState({ cropRatio: '3:2' })

    const next = editorReducer(state, { type: 'SET_IMAGE', image: fakeImage })

    expect(next.cropRatio).toBe('Original')
  })
})

describe('editorReducer — reset dialog slice', () => {
  it('OPEN_RESET_DIALOG marks the dialog open', () => {
    const state = createState()

    const next = editorReducer(state, { type: 'OPEN_RESET_DIALOG' })

    expect(next.resetDialogOpen).toBe(true)
  })

  it('CLOSE_RESET_DIALOG marks the dialog closed', () => {
    const state = createState({ resetDialogOpen: true })

    const next = editorReducer(state, { type: 'CLOSE_RESET_DIALOG' })

    expect(next.resetDialogOpen).toBe(false)
  })
})
